import { ellipsis } from "@fondamenta/utils";
import { createLogger, datetimeVoid, ProcessWriter, type Logger } from "pinetto";

/**
 * Human-facing mirror of the session stream (Phase I of the channel
 * architecture roadmap). Each entry maps to ONE message block, prefixed
 * with the container message's role and the block type. Everything that
 * is not a formatted block representation belongs on stderr (the ops
 * logger) — stdout is reserved for the monologue mirror.
 *
 * Format (one entry per block, entries separated by a blank line):
 *
 *   [agent | thinking] <text>
 *   [agent | text] <text>
 *   [agent | tool_use_req] mcp_shell_exec {"command": "...", ...}
 *   [user | tool_use_res] mcp_shell_exec <text with ellipsis, or [image]>
 *
 * Implemented as a pinetto logger: datetimeVoid drops the date (journald
 * and any orchestrator already timestamp lines) and every block entry is
 * logged at `info` level so the level tag reads `INF`. Blank-line
 * separation between messages is emitted as a raw newline via the writer,
 * since no log entry can carry it.
 */
/** Truncation limits for the mirror: params and result bodies. */
const PARAMS_LIMIT = 200;
const RESULT_LIMIT = 400;

export class MonologueLogger {
  #logger: Logger;
  #stream: NodeJS.WriteStream;

  constructor(stream: NodeJS.WriteStream = process.stdout) {
    this.#stream = stream;
    this.#logger = createLogger({
      level: 'info',
      writer: new ProcessWriter(stream),
      datetime: datetimeVoid,
    });
  }

  /** Log one message's blocks, one entry per block. */
  logMessage(role: 'user' | 'agent', blocks: readonly any[]): void {
    for (const block of blocks) {
      this.#writeEntry(role, block);
    }
    // Blank line between messages, straight to the writer: it is
    // formatting, not a log entry.
    this.#stream.write('\n');
  }

  #writeEntry(role: 'user' | 'agent', block: any): void {
    const prefix = `[${role} | ${block?.type ?? 'unknown'}]`;
    let body: string;
    switch (block?.type) {
      case 'text':
      case 'thinking':
      case 'refusal':
      case 'thinking_redacted':
      case 'unsupported':
        body = block.text ?? '';
        break;
      case 'image':
        body = `[image: ${block.mime_type ?? 'unknown'}, ${block.data?.length ?? 0} bytes base64]`;
        break;
      case 'tool_use_req':
        body = `${block.tool} ${ellipsis(JSON.stringify(block.params ?? null), PARAMS_LIMIT)}`;
        break;
      case 'tool_use_res':
        body = `${block.tool} ${this.#formatResult(block.result)}`;
        break;
      case 'tool_use_err':
        body = `${block.tool} ${this.#formatResult(block.error)}`;
        break;
      default:
        body = ellipsis(JSON.stringify(block ?? null), PARAMS_LIMIT);
    }
    this.#logger.info('%s %s', prefix, body);
  }

  #formatResult(result: readonly any[] | undefined): string {
    if (!result || result.length === 0) return '(empty)';
    return result.map((b) => {
      if (b?.type === 'text') return ellipsis(b.text ?? '', RESULT_LIMIT);
      if (b?.type === 'image') return `[image: ${b.mime_type ?? 'unknown'}]`;
      return ellipsis(JSON.stringify(b ?? null), 100);
    }).join('\n').trim();
  }
}
