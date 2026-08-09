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
  getInjectedMessages(ctx: InjectionContext): Promise<string[]>;
}
