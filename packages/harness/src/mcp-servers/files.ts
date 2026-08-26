
import { Config } from "../config/config.js";
import { McpLocalServer } from "@fondamenta/mcp-local";
import { readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { HarnessMcpToolCallContext } from "../types.js";
import sharp from "sharp";

interface ReadFileParams {
  path: string;
  char_limit?: number;
  char_offset?: number;
  line_limit?: number;
  line_offset?: number;
  /**
   * For image files: maximum width/height in pixels before resizing
   * (default 1024). Ignored for text files.
   */
  max_dimension?: number;
  /** Force text decoding even if the file looks like an image. */
  force_text?: boolean;
}

interface EditFileParams {
  path: string;
  pattern: string;
  replacement: string;
}

interface WriteFileParams {
  path: string;
  content: string;
}

/** Defaults bounding the context cost of image content. */
const IMAGE_MAX_DIMENSION = 1024;
const IMAGE_MAX_BASE64_CHARS = 400_000; // ~300KB raw / ~100k+ visual tokens equivalent worst-case

/**
 * Content-type sniffing via magic bytes. Returns 'text' for UTF-8-ish text,
 * 'image' when a known image container is recognized, or null for unknown
 * binaries (which must not be silently decoded as text — their bytes would
 * contain \u0000 and invalid sequences that Postgres' jsonb rejects).
 */
export const sniffContentType = (head: Buffer): 'text' | 'image' | null => {
  if (head.length >= 12) {
    if (head[0] === 0xFF && head[1] === 0xD8) return 'image';                              // JPEG
    if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image'; // PNG
    if (head.subarray(0, 3).toString('ascii') === 'GIF') return 'image';                   // GIF
    if (head.subarray(4, 8).toString('ascii') === 'ftyp') return 'image';                  // ISOBMFF (AVIF/TIFF/HEIF)
    if (head.subarray(0, 4).toString('ascii') === 'RIFF') {
      const sub = head.subarray(8, 12).toString('ascii');
      if (sub === 'WEBP') return 'image';
      if (sub !== 'WAVE') return 'image'; // most RIFF containers with our use-cases are media
    }
    if (head[0] === 0x1F && head[1] === 0x8B) return null;                                 // gzip → binary
    if (head.subarray(0, 2).toString('ascii') === 'PK') return null;                       // zip/office/docx → binary
    if (head.subarray(0, 4).toString('ascii') === '%PDF') return null;                     // PDF → binary
    if (head[0] === 0x7F && head[1] === 0x45 && head[2] === 0x4C && head[3] === 0x46) return null;         // ELF
    if (head.subarray(0, 5).toString('ascii') === '<?xml') return 'text';
    if (head.subarray(0, 4).toString('ascii') === '{\\rtf') return 'text';
  }

  // Heuristic fallback: sample for UTF-16 BOMs, NULs and other control noise.
  const sample = head.subarray(0, Math.min(head.length, 2048));
  let suspicious = 0;
  for (let i = 1; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0 || (b < 9)) suspicious += 2;
    else if (b > 126 && b < 160) suspicious += 1;
  }
  return suspicious < 10 ? 'text' : null;
};

/**
 * Strips characters Postgres jsonb cannot represent (\u0000 and other C0
 * controls). Defensive: even correct tool outputs occasionally embed stray
 * control bytes; persistence failure would otherwise wedge the session loop.
 */
export const sanitizeForJsonb = (text: string): string =>
  text.replace(/[\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u000B\u000C\u000E-\u001F]/g, '');


/**
 * Normalizes an image for model consumption: resizes to fit within
 * `max_dimension` and recompresses as JPEG (quality 80) unless already small.
 * Returns a base64 data block plus a short provenance note.
 */
export const normalizeImage = async (
  input: Buffer,
  max_dimension: number = IMAGE_MAX_DIMENSION,
): Promise<{ mime_type: string; data: string; note: string }> => {
  const image = sharp(input, { failOn: 'error' });
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const needs_resize = Math.max(width, height) > max_dimension;
  const pipeline = needs_resize
    ? image.resize({ width: max_dimension, height: max_dimension, fit: 'inside', withoutEnlargement: true })
    : image;

  // Recompress to JPEG for predictable size, except tiny images where
  // re-encoding overhead dominates. GIFs lose animation — noted in output.
  let out_buffer: Buffer;
  const animated = meta.pages !== undefined && meta.pages > 1;
  if (!needs_resize && !animated && input.byteLength <= 150_000) {
    out_buffer = input;
  } else {
    out_buffer = await pipeline.jpeg({ quality: 80 }).toBuffer();
  }

  const data = out_buffer.toString('base64');
  if (data.length > IMAGE_MAX_BASE64_CHARS) {
    throw new Error(
      `normalized image still exceeds ${IMAGE_MAX_BASE64_CHARS} base64 chars ` +
      `(${data.length}); source is ${width}x${height}, consider larger crops or smaller dimensions`,
    );
  }

  const notes: string[] = [];
  if (needs_resize) notes.push(`resized ${width}x${height} to fit ${max_dimension}px`);
  if (animated) notes.push('animated image flattened to first frame');
  const note = notes.length > 0 ? ` (${notes.join('; ')})` : '';

  return { mime_type: 'image/jpeg', data, note };
};

const registerTools = (mcpLocalServer: McpLocalServer<HarnessMcpToolCallContext>) => {

  mcpLocalServer.addTool<ReadFileParams>(
    'read',
    'Read File',
    `Reads a file, automatically detecting its content type.

Text files return their contents as text. Image files (PNG, JPEG, GIF, WebP,
AVIF...) are detected via magic bytes and returned as visual content blocks,
automatically resized (default max 1024px) and recompressed to bound token
cost — no separate image tool needed. Unknown binary types are rejected with
a clear error rather than decoded into garbage.

If both line- and char-based offsets/limits are provided, the line-based ones
are applied first. Options \`max_dimension\` and \`force_text\` affect image
handling only.

WARNING: this tool does not enforce limits on the number of tokens that text
files may contribute to your context. ALWAYS employ token economy principles
when using it.

Usage:

  // Read the first 10 lines of a file starting from line 132
  { "path": "file.ts", "line_limit": 10, "line_offset": 132 }

  // Read an image (auto-detected), resized to fit 512px
  { "path": "photo.jpg", "max_dimension": 512 }

  // Read the entirety of a text file
  { "path": "file.ts" }`,
    async (params, ctx) => {
      const { path, char_limit, char_offset, line_limit, line_offset, max_dimension, force_text } = params;

      // Content negotiation: sniff before decoding. Images are returned as
      // visual blocks (sharp-normalized); unknown binaries are rejected with
      // a clean error rather than silently decoded into invalid UTF-8 whose
      // \u0000 bytes would wedge Postgres jsonb persistence.
      const head_buffer = await readFile(path).then((b) => b.subarray(0, 2048));
      const kind = force_text ? 'text' : sniffContentType(head_buffer);

      if (kind === 'image') {
        const { mime_type, data, note } = await normalizeImage(await readFile(path), max_dimension);
        return [
          { type: 'text', text: `Image file ${path}${note}:` },
          { type: 'image', mime_type, data },
        ];
      }
      if (kind === null) {
        throw new Error(
          `${path} appears to be a binary file of unrecognized type. ` +
          `Text readers cannot decode it safely; use a type-specific tool or convert it first.`,
        );
      }

      let content: string | string[] = await readFile(path, 'utf-8');
      if (line_offset || line_limit) {
        content = content.split('\n');
        if (line_offset) {
          content = content.slice(line_offset);
        }
        if (line_limit) {
          content = content.slice(0, line_limit);
        }
        content = content.join('\n');
      }
      if (char_offset) {
        content = content.slice(char_offset);
      }
      if (char_limit) {
        content = content.slice(0, char_limit);
      }
      return [{ type: 'text', text: sanitizeForJsonb(content) }];
    },
  );

  mcpLocalServer.addTool<WriteFileParams>(
    'write',
    'Write File',
    `Write the provided content to the specified file. If the file does not exist, it will be created.
Note that this tool will overwrite the file if it already exists.`,
    async (args) => {
      const { path, content } = args;
      await writeFile(path, content, 'utf-8');
      return [{ type: 'text', text: `Wrote ${content.length} characters to ${path}` }];
    }
  );

  mcpLocalServer.addTool<EditFileParams>(
    'edit',
    'Edit File',
    `Applies a targeted edit to a file by finding and replacing text.

Finds the specified pattern in the file and replaces it with the replacement text.
The pattern must match exactly (including whitespace) and must be unique in the file.

Usage:
  { "path": "file.ts", "pattern": "old text", "replacement": "new text" }

The pattern must be unique - if it appears multiple times, the edit will fail
with a count of occurrences, asking you to be more specific.`,
    async (args) => {
      const { path, pattern, replacement } = args;

      // Handle file creation case
      if (!existsSync(path)) {
        throw new Error(`File ${path} does not exist. Use the write tool to create it.`);
      }

      const content = await readFile(path, 'utf-8');

      // Count occurrences
      let count = 0;
      let searchPos = 0;
      while (true) {
        const pos = content.indexOf(pattern, searchPos);
        if (pos === -1) break;
        count++;
        searchPos = pos + 1;
      }

      if (count === 0) {
        throw new Error(`Pattern not found in ${path}. Make sure the pattern matches exactly (including whitespace and newlines).`);
      }

      if (count > 1) {
        throw new Error(`Pattern appears ${count} times in ${path}. Please make the pattern more specific so it matches exactly once.`);
      }

      // Single occurrence - perform replacement
      const newContent = content.replace(pattern, replacement);
      await writeFile(path, newContent, 'utf-8');

      return [{ type: 'text', text: `Replaced pattern in ${path}` }];
    },
  );

};

export const initFilesMcpServer = (config: Config): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp_server = new McpLocalServer<HarnessMcpToolCallContext>();

  registerTools(mcp_server);

  return mcp_server;

};
