import { createWriteStream, mkdirSync, statSync, type WriteStream } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ellipsis } from "@fondamenta/utils";
import { Message } from "../types/messages.js";
import { ContentBlock, MessageBlock } from "../types/blocks.js";

/**
 * Human-facing mirror of the session stream (Phase I of the channel
 * architecture roadmap). Each entry maps to ONE message block, prefixed
 * with the container message's role and the block type. Everything that
 * is not a formatted block representation belongs on stderr (the ops
 * logger) — the monologue has its own file.
 *
 * Entries are delimited by blank lines; messages by a horizontal rule:
 *
 *   [agent | thinking] <text>
 *   [agent | text] <text>
 *
 *   ---
 *
 *   [agent | tool_use_req] mcp_shell_exec {"command": "...", ...}
 *
 * Because this is a dedicated file (not journald), entries may span
 * multiple lines freely — full text, pretty-printed params, nothing
 * squeezed onto one line.
 *
 * Rotation: when the file exceeds `max_bytes`, it is renamed to
 * <name>.<timestamp> and a fresh file is opened. Old files are kept
 * (pruning is left to logrotate or the operator).
 */
export interface MonologueLoggerOpts {
  /** Directory that will hold the monologue log and its rotations. */
  dir: string;
  /** Base file name inside `dir`. */
  name?: string;
  /** Rotate when the current file grows beyond this many bytes. */
  max_bytes?: number;
}

/** Truncation limits for the mirror: params and result bodies. */
const PARAMS_LIMIT = 2000;
const RESULT_LIMIT = 4000;

const RULE = '\n---\n';
const ENTRY_GAP = '\n\n';

export class MonologueLogger {
  #stream: WriteStream | null = null;
  #dir: string;
  #path: string;
  #max_bytes: number;
  #bytes_written: number;
  #rotating = false;

  constructor(opts: MonologueLoggerOpts) {
    this.#dir = opts.dir;
    this.#path = join(opts.dir, opts.name ?? 'monologue.log');
    this.#max_bytes = opts.max_bytes ?? 10 * 1024 * 1024;
    // Open synchronously: messages may arrive before any async open
    // would complete, and a boot-time failure to open is a hard error
    // worth surfacing rather than silently dropping the mirror.
    mkdirSync(this.#dir, { recursive: true });
    try {
      this.#bytes_written = statSync(this.#path).size;
    } catch {
      this.#bytes_written = 0;
    }
    this.#stream = createWriteStream(this.#path, { flags: 'a' });
  }

  /** Rotate the current file: close, rename with timestamp suffix, reopen. */
  async #rotate(): Promise<void> {
    if (this.#rotating) return;
    this.#rotating = true;
    try {
      const stream = this.#stream;
      this.#stream = null;
      if (stream) {
        await new Promise<void>((resolve) => stream.end(resolve));
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await mkdir(this.#dir, { recursive: true });
      await rename(this.#path, `${this.#path}.${stamp}`).catch(() => {});
      this.#bytes_written = 0;
      this.#stream = createWriteStream(this.#path, { flags: 'a' });
    } catch {
      this.#stream = null;
    } finally {
      this.#rotating = false;
    }
  }

  /** Log one message's blocks, one entry per block. */
  logMessage(message: Message): void {
    const data = this.#formatMessage(message);
    this.#write(''.padEnd(80, '-') + '\n\n' + data + '\n\n' + ''.padEnd(80, '-') + '\n');
  }

  #write(chunk: string): void {
    const stream = this.#stream;
    if (!stream) return;
    stream.write(chunk);
    this.#bytes_written += Buffer.byteLength(chunk);
    if (this.#bytes_written > this.#max_bytes) {
      void this.#rotate();
    }
  }

  #formatBlocks(blocks: MessageBlock[]): string {
    let data = '';
    for (const block of blocks) {
      data += `\n\ntype: ${block.type}`;
      switch (block.type) {
        case 'text':
          data += `\ntext: ${block.text}`;
          data += `\nsynthesis: ${block.synthesis ?? 'N/A'}`;
          break;
        case 'thinking':
          data += `\ntext: ${block.text}`;
          break;
        case 'refusal':
          data += `\ntext: ${block.text}`;
          break;
        case 'thinking_redacted':
          break;
        case 'unsupported':
          data += `\ntext: ${block.text}`;
          break;
        case 'image':
          data += `\nmimeType: ${block.mimeType}`;
          data += `\nbyte size: ${Buffer.from(block.data, 'base64').byteLength}`;
          break;
        case 'voice':
          data += `\npath: ${block.path}`;
          data += `\ntranscription: ${block.transcription ?? 'N/A'}`;
          break;
        default:
          data += `\nraw: ${ellipsis(JSON.stringify(block), 200)}`;
          break;
      }
    }
    return data;
  }

  #formatMessage(message: Message): string {
    let data = '';
    data += `role: ${message.role}\n`;
    data += `type: ${message.type}\n`;
    switch (message.type) {
      case 'input':
      case "notification":
        data += '\n' + this.#formatBlocks(message.blocks);
        break;
      case "tool_res":
        data += '\n';
        for (const result of message.results) {
          data += `\ntool: ${result.tool}`;
          data += `\ncall: ${result.req_id}`;
          data += '\n';
          data += '\n' + this.#formatBlocks(result.blocks);
        }
        break;
      case "tool_req":
        data += '\n';
        for (const request of message.requests) {
          data += `\ntool: ${request.tool}`;
          data += `\ncall: ${request.req_id}`;
          data += `\nparams: ${ellipsis(JSON.stringify(request.params), 100)}`;
        }
        break;
      default:
        data = '\n\n' + ellipsis(JSON.stringify(message ?? null), PARAMS_LIMIT);
    }
    return data;
  }

  #formatResult(result: readonly any[] | undefined): string {
    if (!result || result.length === 0) return '(empty)';
    return result.map((b) => {
      if (b?.type === 'text') return ellipsis(b.text ?? '', RESULT_LIMIT);
      if (b?.type === 'image') return `[image: ${b.mimeType ?? 'unknown'}]`;
      return ellipsis(JSON.stringify(b ?? null), 1000);
    }).join('\n\n');
  }
}

/** Pretty-printed JSON, ellipsized as a whole if very large. */
const prettyJSON = (value: unknown, limit: number): string => {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    text = String(value);
  }
  return ellipsis(text, limit);
};
