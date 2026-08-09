// Injection provider interface.
//
// Any component that produces messages to be injected into the activation
// context implements this interface. The session runner loops through all
// registered providers on each activation to collect injected messages.
//
// Each provider is responsible for its own state — if it has nothing to
// inject, it returns an empty array. Calling getInjectedMessages() is
// expected to drain the provider's queue (consume semantics).

import { type InjectionContext } from "./emygdala/emygdala.js";

export interface InjectionProvider {
  /**
   * Whether this provider has consume semantics (event-driven).
   * If true, the runner drains it during the activation check and
   * stores the result — it will NOT be called again during #query().
   * If false (state-driven), it is called fresh during every #query()
   * to produce context-dependent messages (e.g. time gap, pressure).
   */
  readonly consumeOnCheck: boolean;

  getInjectedMessages(ctx: InjectionContext): Promise<string[]>;
}
