import { ellipsis } from "@fondamenta/utils";
import { type InitContext, WithContext } from "../context.js";
import {
  INGESTIBLE_METHODS,
  parseDomainNotification,
  type DomainNotification,
  type DomainMethod,
} from "./notification-kinds.js";

/**
 * MCP notification bus — Phase II step 3, revised 2026-09-02 (thrice).
 *
 * `RootMcpManager` subscribes to every server's `onNotification` and
 * routes notifications here. The bus is KIND-AWARE, and kinds are a
 * discriminated union (method + params in one object — Jacopo's
 * modeling fix):
 *
 * - Protocol-reserved notifications are handled internally.
 * - Domain notifications are parsed ONCE via parseDomainNotification
 *   into fully-validated DomainNotification objects. Non-conforming
 *   input is DISCARDED (fail closed); unknown methods likewise.
 * - Ingestible kinds are injected into the main session as-is.
 * - Non-ingestible kinds (e.g. audio/available) are delivered to
 *   REGISTERED SUBSCRIBERS — MCP servers that asked for the kind via
 *   `subscribe()`. Subscribers receive the fully-typed notification
 *   and switch on `.method` without casting. Their results flow back
 *   as new notifications through the normal server→client path.
 *   Coordination between servers happens BY MEANS OF the bus only.
 *
 * Subscriber registration is code-side, NOT config-side: kinds are
 * hardcoded, so the legitimate subscriber set for each kind is known
 * at review time.
 */
export class NotificationBus extends WithContext {

  #logger: any; // pinetto Logger type
  /** kind → subscribers (registration order). */
  #subscribers = new Map<DomainMethod, { name: string, onNotification: (notification: DomainNotification) => Promise<void> | void }[]>();

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[notification-bus]');
  }

  /**
   * Register a subscriber for a non-ingestible kind. Subscribers
   * receive fully-validated notifications; they emit their results as
   * new notifications through their own server→client path.
   */
  subscribe<K extends DomainMethod>(kind: K, subscriber: { name: string, onNotification: (notification: Extract<DomainNotification, { method: K }>) => Promise<void> | void }): void {
    if (INGESTIBLE_METHODS[kind]) {
      throw new Error(`kind ${kind} is ingestible — only non-ingestible kinds accept subscribers`);
    }
    if (!this.#subscribers.has(kind)) {
      this.#subscribers.set(kind, []);
    }
    this.#subscribers.get(kind)!.push(subscriber as { name: string, onNotification: (notification: DomainNotification) => Promise<void> | void });
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

  #routeDomainEvent(serverName: string, input: { method: string, params?: any }): void {
    let notification: DomainNotification;
    try {
      // Parse ONCE: unknown methods and malformed payloads throw here.
      notification = parseDomainNotification(input);
    } catch (err) {
      // Discarded. Strict validation, no quarantine — emitting servers
      // must speak the schema exactly. A server cannot inject arbitrary
      // content into the weave by inventing an event name.
      this.#logger.warn('discarding notification %s from %s: %s', input.method, serverName, err instanceof Error ? err.message : String(err));
      return;
    }
    if (INGESTIBLE_METHODS[notification.method]) {
      this.#injectDomainEvent(serverName, notification);
      return;
    }
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
        const result = sub.onNotification(notification);
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            this.#logger.error('subscriber %s failed for %s: %s', sub.name, notification.method, err instanceof Error ? err.message : String(err));
          });
        }
      } catch (err) {
        this.#logger.error('subscriber %s failed for %s: %s', sub.name, notification.method, err instanceof Error ? err.message : String(err));
      }
    }
  }

  #injectDomainEvent(serverName: string, notification: DomainNotification): void {
    const session_id = this._ctx.managers.sessions.main_session_id;
    const body = this.#formatEventBody(notification.params);
    this.#logger.info('injecting event from %s: %s', serverName, notification.method);
    this._ctx.managers.sessions.injectEventMessage(session_id, notification.method, body, true).catch((err: unknown) => {
      this.#logger.error('event injection failed (%s): %s', notification.method, err instanceof Error ? err.message : String(err));
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
