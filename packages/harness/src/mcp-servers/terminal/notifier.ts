// Terminal notifier: collects idle events from terminal sessions and queues
// them as awareness notifications for the activation gate / Emygdala.

import { TerminalSession } from './session.js';

export interface TerminalNotification {
  sessionId: number;
  command: string;
  timestamp: number;
}

export class TerminalNotifier {

  #notifications: TerminalNotification[] = [];

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
  consumeNotifications(): TerminalNotification[] {
    const pending = this.#notifications;
    this.#notifications = [];
    return pending;
  }

  /** Format notifications as a human-readable summary for injection. */
  formatNotifications(notifications: TerminalNotification[]): string {
    if (notifications.length === 0) return '';
    const lines = notifications.map(n =>
      `Terminal session #${n.sessionId} (${n.command}) is waiting for input.`
    );
    return lines.join('\n');
  }

}
