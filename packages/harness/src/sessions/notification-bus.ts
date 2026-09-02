import { ellipsis } from "@fondamenta/utils";
import { type InitContext, WithContext } from "../context.js";
import {
  NOTIFICATION_KINDS,
} from "./notification-kinds.js";

/**
 * MCP notification bus — Phase II step 3, revised 2026-09-02 (twice).
 *
 * `RootMcpManager` subscribes to every server's `onNotification` and
 * routes notifications here. The bus is KIND-AWARE:
 *
 * - Protocol-reserved notifications are handled internally.
 * - Domain notifications matching a hardcoded kind are validated
 *   strictly; non-conforming payloads are DISCARDED (fail closed).
 * - Ingestible kinds are formatted and injected into the main session.
 * - Non-ingestible kinds (e.g. audio/available) are routed to their
 *   REGISTERED SUBSCRIBERS — MCP servers that asked for the kind via
 *   `subscribe(kind)`. The bus delivers to the subscriber's own
 *   `onNotification` (client→server direction, local transport);
 *   results flow back as new notifications through the normal
 *   server→client path. Coordination between servers happens BY
 *   MEANS OF the bus only — no direct subsystem wiring.
 * - Unknown method names are DISCARDED with a warning — an MCP server
 *   cannot inject arbitrary content into the agent's context by
 *   inventing an event name (Jacopo's taxonomy ruling: hard-coded
 *   kinds, strict validation, no config escape hatch).
 *
 * Subscriber registration is code-side (a server's init function
 * calls bus.subscribe), NOT config-side: kinds are hardcoded, so the
 * legitimate subscriber set for each kind is known at review time.
 */
export class NotificationBus extends WithContext {

  #logger: any; // pinetto Logger type
  /** kind → subscriber server names (registration order). */
  #subscribers = new Map<string, { name: string, onNotification: (method: string, params: unknown) => Promise<void> | void }[]>();

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[notification-bus]');
  }

  /**
   * Register a subscriber for a non-ingestible kind. Subscribers
   * receive validated payloads; they emit their results as new
   * notifications through their own server→client path.
   */
  subscribe(kind: string, subscriber: { name: string, onNotification: (method: string, params: unknown) => Promise<void> | void }): void {
    const spec = (NOTIFICATION_KINDS as Record<string, unknown>)[kind];
    if (!spec) {
      throw new Error(`cannot subscribe to unknown notification kind: ${kind}`);
    }
    if ((NOTIFICATION_KINDS as Record<string, { ingestible: boolean }>)[kind].ingestible) {
      throw new Error(`kind ${kind} is ingestible — only non-ingestible kinds accept subscribers`);
    }
    if (!this.#subscribers.has(kind)) {
      this.#subscribers.set(kind, []);
    }
    this.#subscribers.get(kind)!.push(subscriber);
    this.#logger.info('subscriber %s registered for kind %s', subscriber.name, kind);
  }

  /**
   * Entry point: called by the MCP manager for every notification
   * received from any server.
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
        this.#routeDomainEvent(serverName, notification);
    }
  }

  #routeDomainEvent(serverName: string, notification: { method: string, params?: any }): void {
    const registry = NOTIFICATION_KINDS as Record<string, { ingestible: boolean, validate: (p: unknown) => unknown }>;
    const spec = registry[notification.method];
    if (!spec) {
      // Unknown kind: discarded. A server cannot inject arbitrary
      // content into the weave by inventing an event name.
      this.#logger.warn('discarding unknown notification kind %s from %s (not in hardcoded registry)', notification.method, serverName);
      return;
    }
    let payload: unknown;
    try {
      payload = spec.validate(notification.params);
    } catch (err) {
      // Non-conforming payload: discarded. Strict validation, no
      // quarantine — emitting servers must speak the schema exactly.
      this.#logger.warn('discarding malformed %s from %s: %s', notification.method, serverName, err instanceof Error ? err.message : String(err));
      return;
    }
    if (!spec.ingestible) {
      // Subsystem-targeted: deliver to registered subscribers, never
      // inject into the weave. Fire-and-forget: a slow subscriber must
      // not block the bus.
      const subs = this.#subscribers.get(notification.method) ?? [];
      if (subs.length === 0) {
        this.#logger.warn('non-ingestible kind %s has no subscribers — payload dropped', notification.method);
        return;
      }
      for (const sub of subs) {
        try {
          const result = sub.onNotification(notification.method, payload);
          if (result instanceof Promise) {
            result.catch((err: unknown) => {
              this.#logger.error('subscriber %s failed for %s: %s', sub.name, notification.method, err instanceof Error ? err.message : String(err));
            });
          }
        } catch (err) {
          this.#logger.error('subscriber %s failed for %s: %s', sub.name, notification.method, err instanceof Error ? err.message : String(err));
        }
      }
      return;
    }
    this.#injectDomainEvent(serverName, notification.method, payload);
  }

  #injectDomainEvent(serverName: string, method: string, payload: unknown): void {
    const session_id = this._ctx.managers.sessions.main_session_id;
    const body = this.#formatEventBody(payload);
    this.#logger.info('injecting event from %s: %s', serverName, method);
    this._ctx.managers.sessions.injectEventMessage(session_id, method, body, true).catch((err: unknown) => {
      this.#logger.error('event injection failed (%s): %s', method, err instanceof Error ? err.message : String(err));
    });
  }

  #formatEventBody(payload: unknown): string {
    if (payload === undefined || payload === null) {
      return '';
    }
    if (typeof payload === 'string') {
      return ellipsis(payload, 4_000, '…');
    }
    if (typeof payload === 'object' && 'text' in (payload as Record<string, unknown>) && typeof (payload as Record<string, unknown>).text === 'string') {
      const { text, ...rest } = payload as { text: string } & Record<string, unknown>;
      // Machine-readable fields (chat_id, from_id, path, ...) ride
      // along compactly; the human-readable text is the body.
      const extras = Object.keys(rest);
      if (extras.length === 0) {
        return ellipsis(text, 4_000, '…');
      }
      return `${ellipsis(text, 4_000, '…')}\n${JSON.stringify(rest)}`;
    }
    return ellipsis(JSON.stringify(payload, null, 2), 4_000, '…');
  }

}
