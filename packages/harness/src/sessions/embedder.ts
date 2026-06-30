import { type InitContext, WithContext } from "../context.js";
import { type Logger } from "pinetto";
import { errToString } from "@fondamenta/utils";
import { type DB } from "../database/client.js";
import { selectRecords, updateRecord } from "../database/tables/continuity_records.js";

export class Embedder extends WithContext {

  #timer: NodeJS.Timeout | null = null;
  #running = false;
  #logger: Logger;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[embedder]');
  }

  async initialize(intervalMs: number = 60_000) {
    this.#timer = setInterval(() => this.run(), intervalMs);
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async run(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    this.#logger.info('run started');
    try {
      const embeddingsModel = this._ctx.managers.models.embedding;
      const db = this._ctx.db;

      // Process in batches of 20
      while (true) {
        const records = await selectRecords(db, { type: ['log', 'memory', 'note'], limit: 20, embedding: null });
        if (records.length === 0) break;

        this.#logger.debug('found %d records without embedding', records.length);

        // Build text to embed: use title + content for notes, content for logs
        const texts = records.map(r => {
          if (r.title) return `${r.title}\n\n${r.content}`;
          return r.content;
        });

        const results = await embeddingsModel.embedBatch(texts);

        for (let i = 0; i < records.length; i++) {
          await updateRecord(db, records[i].id, { embedding: results[i].embedding });
        }

        this.#logger.debug('embedded %d records', records.length);
      }
    } catch (err: any) {
      this.#logger.error('run error: %s', errToString(err));
    } finally {
      this.#running = false;
      this.#logger.info('run ended');
    }
  }
}
