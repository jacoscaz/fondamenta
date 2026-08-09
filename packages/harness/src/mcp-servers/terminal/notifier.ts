// Terminal notifier: collects idle events from terminal sessions and queues
// them as awareness notifications for the activation gate / Emygdala.

import { type InitContext, WithContext } from "../../context.js";
import { TerminalSession } from "./session.js";

export interface TerminalNotification {
  sessionId: number;
  command: string;
  timestamp: number;
}

export class TerminalNotifier extends WithContext {

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

  /** Consume and return all pending notifications. */
  consumeNotifications(): string[] {
    if (this.#notifications.length === 0) return [];
    const notifications = this.#notifications;
    this.#notifications = [];
    return notifications.map(n =>
      `Terminal session #${n.sessionId} (${n.command}) is waiting for input.`
    );
  }

}
