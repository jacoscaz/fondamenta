// Terminal notifier: collects idle events from terminal sessions and queues
// them as awareness notifications for injection into the activation context.

import { type InitContext, WithContext } from "../../context.js";
import { type InjectionProvider, type InjectionContext } from "../../injection.js";
import { TerminalSession } from "./session.js";

export interface TerminalNotification {
  sessionId: number;
  command: string;
  timestamp: number;
  screen: string;
}

export class TerminalNotifier extends WithContext implements InjectionProvider {

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
        screen: session.readScreen(),
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
    return notifications.map(n => {
      const screen = n.screen.trim();
      if (screen) {
        return `Terminal session #${n.sessionId} is idle.\n\n\`\`\`\n${screen}\n\`\`\``;
      }
      return `Terminal session #${n.sessionId} is idle.`;
    });
  }

}
