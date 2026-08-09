// Terminal notifier: collects idle events from terminal sessions and queues
// them as awareness notifications for injection into the activation context.

import { type InitContext, WithContext } from "../../context.js";
import { type InjectionProvider } from "../../injection.js";
import { type InjectionContext } from "../../emygdala/emygdala.js";
import { TerminalSession } from "./session.js";

export interface TerminalNotification {
  sessionId: number;
  command: string;
  timestamp: number;
}

export class TerminalNotifier extends WithContext implements InjectionProvider {

  readonly consumeOnCheck = true;

  #notifications: TerminalNotification[] = [];

  constructor(ctx: InitContext) {
    super(ctx);
  }

  /** Attach to a session to receive idle events. */
  attach(session: TerminalSession): void {
    session.onIdle = () => {
      this.#notifications.push({
        sessionId: session.id,
        command: session.process,
        timestamp: Date.now(),
      });
    };
  }

  /** Check if there are pending notifications. */
  hasNotifications(): boolean {
    return this.#notifications.length > 0;
  }

  /** Implementation of InjectionProvider — consumes and returns messages. */
  async getInjectedMessages(_ctx: InjectionContext): Promise<string[]> {
    if (this.#notifications.length === 0) return [];
    const notifications = this.#notifications;
    this.#notifications = [];
    return notifications.map(n =>
      `Terminal session #${n.sessionId} is idle.`
    );
  }

}
