import { type Logger } from "pinetto";
import { type InitContext, WithContext } from "../context.js";
import { SessionRunner } from "./runner.js";

/**
 * Manages the lifecycle of SessionRunner instances.
 * 
 * In single-session architecture, there is one persistent runner for
 * the main session. Transient runners (distiller) are created
 * on-the-fly and not registered here.
 */
export class RunnerRegistry extends WithContext {

  #logger: Logger;
  #runners: Record<number, SessionRunner> = Object.create(null);

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[runners]');
  }

  /**
   * Get or create the runner for a session.
   * The runner is subscribed to the heartbeat on creation.
   */
  ensure(session_id: number): SessionRunner {
    let runner = this.#runners[session_id];
    if (!runner) {
      runner = new SessionRunner(this._ctx.init, session_id, session_id);
      this.#runners[session_id] = runner;
      // Subscribe the runner to heartbeat events
      this._ctx.heartbeat.on('beat', () => { runner.run(); });
      this.#logger.info('runner for session %d subscribed to heartbeat', session_id);
    }
    return runner;
  }

  get(session_id: number): SessionRunner | undefined {
    return this.#runners[session_id];
  }

}
