
import { SessionRunner } from "./runner.js";
import { type Logger } from "pinetto";
import { type InitContext, WithContext } from "../context.js";
import { insertSession, selectSessionById, selectSessions, updateSessionSystemPrompt } from "../database/tables/sessions.js";
import { type Message, type UserMessage } from "../models/types/messages.js";
import { deleteMessages, insertMessage, selectMessages } from "../database/tables/messages.js";
import { ensureTrx, type DB } from "../database/client.js";

export interface SessionManagerEvents extends Record<string, any[]> {
  [key: `session-${number}-message`]: [message: Message];
}

export class SessionManager extends WithContext<SessionManagerEvents> {

  #logger: Logger;
  #runners: Record<number, SessionRunner>;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[sessions]');
    this.#runners = Object.create(null);
  }

  async initialize(): Promise<void> {
  }

  /** Starts the session runner for the given session. Call after inserting
   * messages manually (e.g. from the distiller). */
  async runSession(session_id: number) {
    this.#ensureRunner(session_id).run();
  }

  getActiveSessionsCount(): number {
    return Object.keys(this.#runners).length;
  }

  async getSessionHistory(session_id: number): Promise<Message[]> {
    const messages = await selectMessages(this._ctx.db, {
      session_id,
      unprocessed: 'exclude',
    });
    this.#logger.debug('retrieved %s messages from history', messages.length);
    return messages.map(m => m.data);
  }

  #ensureRunner(session_id: number): SessionRunner {
    let runner = this.#runners[session_id];
    if (!runner) {
      runner = new SessionRunner(this._ctx.init, session_id, session_id);
      this.#runners[session_id] = runner;
    }
    return runner;
  }

  async addMessage(session_id: number, message: UserMessage) {
    await ensureTrx(this._ctx.db, async (trx) => {
      const session = await selectSessionById(trx, session_id);
      const model = this._ctx.model;
      await insertMessage(trx, {
        session_id,
        data: message,
        raw: model.format(message),
        created_at: new Date(),
        processed_at: null,
        role: 'user',
      });
    });
    this.#ensureRunner(session_id).run();
  }

  async createSession(model_id: string = ''): Promise<number> {
    return ensureTrx(this._ctx.db, async (trx) => {
      const { id } = await insertSession(trx, {
        initiator: 'user',
        created_at: new Date(),
        system_prompt: await this._ctx.managers.prompts.getSystemPrompt(),
      });
      return id;
    });
  }

  async compactSession(session_id: number, checkpoint: string, db?: DB) {
    await ensureTrx(db ?? this._ctx.db, async (trx) => {
      // await insertCheckpoint(trx, { session_id, data: checkpoint, created_at: new Date() });
      await deleteMessages(trx, { session_id });

      // Regenerate the system prompt so any constitutional changes (tweaked
      // prime directives, anchors, etc.) take effect after compaction.
      const new_system_prompt = await this._ctx.managers.prompts.getSystemPrompt();
      await updateSessionSystemPrompt(trx, session_id, new_system_prompt);

      await insertMessage(trx, {
        session_id,
        data: {
          role: 'user',
          blocks: [ { type: 'text', text: 'This session has been compacted. This is the checkpoint you have saved:\n\n' + checkpoint} ],
        },
        created_at: new Date(),
        processed_at: null,
        role: 'user',
        raw: null,
      });
    });
  }

  async listSessions() {
    return await selectSessions(this._ctx.db, { order_by: 'updated_at', order_dir: 'desc' });
  }

}
