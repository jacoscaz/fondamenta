import { createWriteStream, mkdirSync, statSync, type WriteStream } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ellipsis } from "@fondamenta/utils";
import { Message } from "../types/messages.js";
import { ContentBlock, MessageBlock } from "../types/blocks.js";
import { PROJECT_MONOLOGUE_LOGGING_OPTS, projectMessage } from "../projection.js";
import { SERIALIZE_MONOLOGUE_LOGGING_OPTS, serializeMessage } from "../serialization.js";

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
    const projected = projectMessage(message, PROJECT_MONOLOGUE_LOGGING_OPTS);
    if (projected === null) return; // unreachable under the monologue profile; type-required
    const serialized = serializeMessage(projected, SERIALIZE_MONOLOGUE_LOGGING_OPTS);
    this.#write(''.padEnd(80, '-') + '\n\n' + serialized + '\n\n' + ''.padEnd(80, '-') + '\n');
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
}
