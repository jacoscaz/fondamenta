
import { type DB } from "./database/client.js";
import { type SelectableSession } from "./database/tables/sessions.js";

/**
 * Parameters passed to Emygdala for injection message generation.
 * These describe the current harness state — what the runner knows,
 * the emygdala decides what to inject based on that state.
 */
export interface InjectionContext {
  /** The session being activated */
  session: SelectableSession;
  /** Database connection (may be a transaction from the activation loop) */
  db?: DB;
  /** Timestamp of the current activation */
  now: Date;
  /** Timestamp of the most recent processed message in the session */
  lastMessageAt: Date;
}

/**
 * Injection provider interface.
 *
 * Any component that produces messages to be injected into the activation
 * context implements this interface. The session runner loops through all
 * registered providers on each activation to collect injected messages.
 *
 * Each provider is responsible for its own state — if it has nothing to
 * inject, it returns an empty array. Calling getInjectedMessages() is
 * expected to drain the provider's queue (consume semantics).
 */
export interface InjectionProvider {
  getInjectedMessages(ctx: InjectionContext): Promise<string[]>;
}
