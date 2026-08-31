import { ellipsis } from "@fondamenta/utils";
import { type InitContext, WithContext } from "../context.js";

/**
 * MCP notification bus — Phase II step 3.
 *
 * `RootMcpManager` subscribes to every server's `onNotification` and
 * routes notifications here. Domain events (method names NOT reserved
 * by the MCP spec) are formatted and injected into the main session;
 * protocol-reserved notifications are handled internally.
 *
 * This is the generic event bus: mail arrival, todo due, telegram
 * message, whatever a server chooses to emit. It replaces the bespoke
 * per-notifier injection paths.
 */
export class NotificationBus extends WithContext {

  #logger: any; // pinetto Logger type

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[notification-bus]');
  }

  /**
   * Entry point: called by the MCP manager for every notification
   * received from any server. Protocol-reserved method names are
   * consumed here; everything else is a domain event for the agent.
   */
  handleNotification(serverName: string, notification: { method: string, params?: any }): void {
    switch (notification.method) {
      case 'notifications/initialized':
        // Lifecycle bookkeeping, already sent by our own clients.
        return;
      case 'notifications/cancelled':
        this.#logger.debug('cancellation notification from %s: %s', serverName, JSON.stringify(notification.params ?? {}));
        return;
      case 'notifications/progress':
        this.#logger.debug('progress notification from %s: %s', serverName, JSON.stringify(notification.params ?? {}));
        return;
      default:
        this.#injectDomainEvent(serverName, notification);
    }
  }

  /**
   * Inject a domain event into the main session as an automated message.
   * Formatting keeps the payload bounded; structure is delegated to the
   * emitting server (its params carry whatever it wants the agent to see).
   */
  #injectDomainEvent(serverName: string, notification: { method: string, params?: any }): void {
    const session_id = this._ctx.managers.sessions.main_session_id;
    const text = this.#formatDomainEvent(serverName, notification);
    this.#logger.info('injecting event from %s: %s', serverName, notification.method);
    this._ctx.managers.sessions.injectAutomatedTextMessage(session_id, text, true).catch((err: unknown) => {
      this.#logger.error('event injection failed (%s): %s', serverName, err instanceof Error ? err.message : String(err));
    });
  }

  #formatDomainEvent(serverName: string, notification: { method: string, params?: any }): string {
    const params = notification.params;
    let body: string;
    if (params === undefined || params === null) {
      body = '';
    } else if (typeof params === 'string') {
      body = params;
    } else if (typeof params === 'object' && params !== null && params !== undefined && 'text' in params && typeof (params as any).text === 'string' && Object.keys(params).length === 1) {
      body = (params as { text: string }).text;
    } else {
      body = JSON.stringify(params, null, 2);
    }
    const header = `🔔 Event [${serverName}] ${notification.method}`;
    return body ? `${header}\n${ellipsis(body, 4_000, '…')}` : header;
  }

}
