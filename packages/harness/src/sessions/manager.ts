
import { type Logger } from "pinetto";
import { type InitContext, WithContext } from "../context.js";
import { SessionRunner } from "./runner.js";
import { insertSession, selectSessionById } from "../database/tables/sessions.js";
import { type UserMessage, type Message } from "../models/session/types/messages.js";
import { type AbstractSessionModel } from "../models/session/abstract.js";
import assert from "node:assert";
import { type HarnessNotification } from "../notifications/types.js";
import { formatNotification } from "../notifications/formatters.js";


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
    const runner = this.#ensureRunner(session_id);
    // Activation-limit configuration: the main session gets a generous
    // cap (a runaway there costs minutes of tokens, not hours — and the
    // limit-reached notification in the weave lets the next heartbeat
    // resume informed). Ephemeral runners (distiller, compactor) call
    // runner.run() directly with their own tighter limits.
    const main_limit = this._ctx.config.session?.max_activations_per_run ?? SessionRunner.DEFAULT_MAX_QUERIES_PER_RUN;
    if (session_id === this.main_session_id) {
      return runner.run(undefined, undefined, main_limit);
    }
    return runner.run(undefined, undefined, 30);
  }

  /**
   * Whether the runner has any unprocessed message pending. Does not
   * trigger an activation loop.
   */
  async hasPendingMessages(session_id: number): Promise<boolean> {
    const pending = await this._ctx.db.selectFrom('messages')
      .where('session_id', '=', session_id)
      .where('processed_at', 'is', null)
      .select('id')
      .limit(1)
      .executeTakeFirst();
    return pending !== undefined;
  }

  #ensureRunner(session_id: number): SessionRunner {
    let runner = this.#runners[session_id];
    if (!runner) {
      // The ONLY position-based lookup in the codebase (Jacopo's review,
      // PR #27): the first config entry is what sessions start on. After
      // creation, identity is always by id.
      const first_model_id = this._ctx.config.models.session[0].id;
      runner = new SessionRunner(this._ctx.init, session_id, session_id, this._ctx.managers.models.session(first_model_id));
      this.#runners[session_id] = runner;
      // The main session runner owns its own heartbeat cadence and is
      // the only session whose stream is mirrored to the monologue log.
      if (session_id === this.main_session_id) {
        runner.startHeartbeat();
        runner.enableMonologue();
      }
      runner.on('message', (message) => {
        this.emit(`session-${session_id}-message`, message);
      });
      runner.on('idle', () => {
        this.emit(`session-${session_id}-idle`);
      });
      this.#logger.info('runner for session %d started', session_id);
    }
    return runner;
  }

  /**
   * Switch the model of the runner for the given session (dynamic
   * substrate switching, 2026-09-03). Called from the session MCP
   * server's switch tool — the tool call context carries the session
   * id, so the caller never needs to know their own session id.
   * Models are referenced by config id, never by index.
   */
  switchSessionModel(session_id: number, model_id: string): string {
    return this.#ensureRunner(session_id).switchModel(model_id);
  }

  /** The model currently active for the given session (instance — `.id`, `.guidance`, `.max_context_size` available). */
  getSessionModel(session_id: number): AbstractSessionModel {
    return this.#ensureRunner(session_id).getModel();
  }

  /**
   * All configured session model INSTANCES (relay to the model manager —
   * the session layer is where consumers like emygdala already look).
   * Callers format id + guidance into agent-facing menus.
   */
  getAvailableSessionModels(): AbstractSessionModel[] {
    return this._ctx.managers.models.sessionModels;
  }

  /**
   * Request a reasoning-effort change on the given session's active
   * model. Returns false when the model doesn't support it (never throws).
   */
  setSessionReasoningEffort(session_id: number, effort: string): boolean {
    return this.#ensureRunner(session_id).setReasoningEffort(effort);
  }

  async injectMessage(session_id: number, message: UserMessage, run: boolean): Promise<void> {
    const runner = this.#ensureRunner(session_id);
    await runner.injectMessage(message, run);
  }

  async injectEventMessage(session_id: number, event: string, text: string, run: boolean): Promise<void> {
    const runner = this.#ensureRunner(session_id);
    await runner.injectEventMessage(event, text, run);
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
    this._ctx.buses.notifications.subscribe('session-manager', this.#onNotification);
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

  #injectNotification = async (notification: HarnessNotification): Promise<void> => {
    const { main_session_id } = this._ctx.managers.sessions;
    const body = formatNotification(notification);
    this.#logger.info('injecting event %s', notification.method);
    this.injectEventMessage(main_session_id, notification.method, body, true).catch((err: unknown) => {
      this.#logger.error('event injection failed (%s): %s', notification.method, err instanceof Error ? err.message : String(err));
    });
  };

  #onNotification = async (notification: HarnessNotification): Promise<boolean> => {
    switch (notification.method) {
      case 'message/new':
        await this.#injectNotification(notification);
        return true;
      case 'todo/due':
        await this.#injectNotification(notification);
        return true;
      default:
        return false;
    }
  }



}
