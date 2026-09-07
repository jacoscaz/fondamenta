import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { type InitContext, WithContext } from "../context.js";
import { type Logger } from "pinetto";

/**
 * FileManager — temporary-path allocation and expiration-based cleanup.
 *
 * A harness-core service, NOT an MCP server: MCP servers are citizens of
 * the bus, not elements of each other's context (2026-09-07 design ruling).
 * Servers that need temp files (speech synthesis, future exporters) receive
 * the FileManager through their CompleteContext slice.
 *
 * Policy travels with the file: the consumer declares expiration at
 * allocation time — where the knowledge lives — and the manager stays
 * policy-free. Deadlines live in the filename itself (ISO 8601 prefix),
 * so cleanup is a lexicographic scan with zero bookkeeping and survives
 * crashes and restarts: a file's deadline cannot be lost because it is
 * not stored anywhere separate from the file.
 *
 * Filename format: <ISO-8601-utc-stamp>-<random>.<ext> where the stamp has
 * all '.' and ':' replaced with '-'. Lexicographic order == chronological
 * order for same-length stamps.
 */
export class FileManager extends WithContext {

  #root: string;
  #interval: NodeJS.Timeout | undefined;
  #logger: Logger;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#root = ctx.config.files?.temp_dir ?? join(process.cwd(), 'media', 'tmp');
    this.#logger = ctx.logger.child('[file-manager]');
  }

  /**
   * Allocate a temp path that expires at the given instant. Creates the
   * root directory on first use. Returns the absolute path; the caller
   * owns writing to it.
   */
  async tempPath(expiration: Date, extension: string = ''): Promise<string> {
    await mkdir(this.#root, { recursive: true });
    const stamp = expiration.toISOString().replace(/[:.]/g, '-');
    const ext = extension ? `.${extension.replace(/^\./, '')}` : '';
    return join(this.#root, `${stamp}-${randomBytes(4).toString('hex')}${ext}`);
  }

  /** Directory root for user-visible organization of managed files. */
  get root(): string {
    return this.#root;
  }

  /**
   * Start the cleanup interval. Scans the root, deletes files whose
   * ISO-stamp prefix is already past. Malformed names are left alone —
   * the directory is shared territory and the manager only claims files
   * that speak its own naming convention.
   */
  start(cleanup_interval_ms?: number): void {
    const interval = cleanup_interval_ms ?? this._ctx.config.files?.cleanup_interval_ms ?? 60_000;
    this.#interval = setInterval(() => {
      this.#sweep().catch((err) => this.#logger.error('cleanup sweep failed: %s', err instanceof Error ? err.message : String(err)));
    }, interval);
    this.#interval.unref?.();
    this.#logger.info('cleanup interval started (%dms, root %s)', interval, this.#root);
  }

  stop(): void {
    if (this.#interval) clearInterval(this.#interval);
    this.#interval = undefined;
  }

  async #sweep(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.#root);
    } catch {
      return; // root not created yet; nothing to sweep
    }
    const now_stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const name of entries) {
      // Claim only files matching our naming convention:
      // <ISO-stamp>-<hex>.<ext> — parse the stamp from the leading segment.
      const dash = name.indexOf('-');
      if (dash < 0) continue;
      const stamp = name.slice(0, dash);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/.test(stamp)) continue;
      if (stamp >= now_stamp) continue;
      const full = join(this.#root, name);
      try {
        const s = await stat(full);
        if (!s.isFile()) continue;
        await unlink(full);
        this.#logger.info('expired temp file removed: %s', name);
      } catch (err) {
        this.#logger.warn('failed to remove expired temp file %s: %s', name, err instanceof Error ? err.message : String(err));
      }
    }
  }
}
