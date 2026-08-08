import { type Logger } from "pinetto";
import { type InitContext, WithContext } from "../context.js";
import { insertSession, selectSessions, selectSessionById } from "../database/tables/sessions.js";

/**
 * Thin CRUD wrapper for session table operations.
 * Replaces SessionManager — runner lifecycle, message operations,
 * and compaction have moved to SessionRunner. What remains is
 * pure database access.
 */
export class SessionRepository extends WithContext {

  #logger: Logger;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[sessions]');
  }

  /**
   * Find the most recent non-distiller session, or create one
   * if none exists. This is the main session — the single
   * continuous conversation that persists across compactions.
   */
  async getOrCreateMain(): Promise<number> {
    const sessions = await this._ctx.db
      .selectFrom('sessions')
      .where('initiator', '!=', 'distiller')
      .orderBy('created_at', 'desc')
      .limit(1)
      .select('id')
      .executeTakeFirst();

    if (sessions) {
      return sessions.id;
    }

    return await this.create();
  }

  async getById(id: number) {
    return await selectSessionById(this._ctx.db, id);
  }

  async create(): Promise<number> {
    const { id } = await insertSession(this._ctx.db, {
      initiator: 'user',
      created_at: new Date(),
      system_prompt: await this._ctx.managers.prompts.getSystemPrompt(),
    });
    return id;
  }

  /**
   * List non-distiller sessions. Used by the web UI sidebar
   * (for now just the main session, but the query is general).
   */
  async list() {
    return await this._ctx.db
      .selectFrom('sessions')
      .where('initiator', '!=', 'distiller')
      .orderBy('updated_at', 'desc')
      .execute();
  }

}
