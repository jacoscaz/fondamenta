import { type Logger } from "pinetto";
import { type InitContext, WithContext } from "../context.js";
import { SessionRunner } from "./runner.js";
import { insertSession, selectSessionById } from "../database/tables/sessions.js";
import { type UserMessage, type Message } from "../models/session/types/messages.js";
import { type TextBlock } from "../models/session/types/blocks.js";
import assert from "node:assert";
import { type DB } from "../database/client.js";

export interface SessionManagerEvents extends Record<string, any[]> {
  [key: `session-${number}-message`]: [message: Message];
  [key: `session-${number}-idle`]: [];
}

/**
 * Manages the lifecycle of SessionRunner instances.
 *
 * In single-session architecture, there is one persistent runner for
 * the main session. Transient runners (distiller) are created
 * on-the-fly and not registered here.
 */
export class SessionManager extends WithContext {

  #logger: Logger;
  #runners: Record<number, SessionRunner> = Object.create(null);
  #main_session_id?: number;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[runners]');
  }

  addPreQueryListener(session_id: number, listener: () => Promise<void>) {
    const runner = this.#ensureRunner(session_id);
    runner.addPreQueryListener(listener);
  }

  addPostQueryListener(session_id: number, listener: () => Promise<void>) {
    const runner = this.#ensureRunner(session_id);
    runner.addPostQueryListener(listener);
  }

  get main_session_id() {
    assert(this.#main_session_id, 'main session not initialized');
    return this.#main_session_id;
  }

  run(session_id: number): Promise<void> {
    return this.#ensureRunner(session_id).run();
  }

  #ensureRunner(session_id: number): SessionRunner {
    let runner = this.#runners[session_id];
    if (!runner) {
      runner = new SessionRunner(this._ctx.init, session_id, session_id, this._ctx.managers.models.session);
      this.#runners[session_id] = runner;
      // Subscribe the runner to heartbeat events
      this._ctx.heartbeat.on('beat', () => { runner.run(); });
      runner.on('message', (message) => {
        this.emit(`session-${session_id}-message`, message);
      });
      runner.on('idle', () => {
        this.emit(`session-${session_id}-idle`);
      });
      this.#logger.info('runner for session %d subscribed to heartbeat', session_id);
    }
    return runner;
  }

  async injectUserMessage(session_id: number, message: UserMessage, run: boolean = true): Promise<void> {
    const runner = this.#ensureRunner(session_id);
    await runner.injectMessage(message);
    if (run) {
      runner.run();
    }
  }

  async injectHarnessMessage(session_id: number, message: UserMessage<TextBlock>, run: boolean = true): Promise<void> {
    message = {
      ...message,
      block: {
        ...message.block,
        text: `[automated harness message] ${message.block.text}`,
      },
    };
    await this.injectUserMessage(session_id, message, run);
  }

  async getHistory(session_id: number): Promise<Message[]> {
    return await this.#ensureRunner(session_id).getHistory();
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



  /**
   * Find the most recent non-distiller session, or create one
   * if none exists. This is the main session — the single
   * continuous conversation that persists across compactions.
   */
  async initialize() {
    const session = await this._ctx.db
      .selectFrom('sessions')
      .where('initiator', '!=', 'distiller')
      .orderBy('created_at', 'desc')
      .limit(1)
      .select('id')
      .executeTakeFirst();
    this.#main_session_id = session?.id ?? await this.create();
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



}
