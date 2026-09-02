import { ellipsis } from "@fondamenta/utils";
import { type InitContext, WithContext } from "../context.js";
import {
  NOTIFICATION_KINDS,
  type AudioAvailablePayload,
} from "./notification-kinds.js";
import { type TranscriptionPipeline } from "./transcription-pipeline.js";

/**
 * MCP notification bus — Phase II step 3, revised 2026-09-02.
 *
 * `RootMcpManager` subscribes to every server's `onNotification` and
 * routes notifications here. The bus is now KIND-AWARE:
 *
 * - Protocol-reserved notifications are handled internally.
 * - Domain notifications matching a hardcoded kind are validated
 *   strictly; non-conforming payloads are DISCARDED (fail closed).
 * - Ingestible kinds are formatted and injected into the main session.
 * - Non-ingestible kinds (e.g. audio/available) are routed to their
 *   registered subsystem handler and NEVER reach the weave.
 * - Unknown method names are DISCARDED with a warning — an MCP server
 *   cannot inject arbitrary content into the agent's context by
 *   inventing an event name (Jacopo's taxonomy ruling: hard-coded
 *   kinds, strict validation, no config escape hatch).
 *
 * Pipeline subsystems emit finished artifacts via `emitPipelineEvent`,
 * which bypasses kind validation (they construct validated payloads
 * themselves) but keeps the same injection path.
 */
export class NotificationBus extends WithContext {

  #logger: any; // pinetto Logger type
  #transcription?: TranscriptionPipeline;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[notification-bus]');
  }

  /** Wire the transcription pipeline (called during harness startup). */
  setTranscriptionPipeline(pipeline: TranscriptionPipeline): void {
    this.#transcription = pipeline;
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
      this.#logger.warn('discarding unknown notification kind %s/%s from %s (not in hardcoded registry)', serverName, notification.method, serverName);
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
      // Subsystem-targeted: route to the registered handler, never
      // inject into the weave.
      if (notification.method === 'audio/available') {
        if (!this.#transcription) {
          this.#logger.warn('audio/available from %s but no transcription pipeline registered — artifact dropped: %s', serverName, JSON.stringify(payload));
          return;
        }
        void this.#transcription.handleAudioAvailable(payload as AudioAvailablePayload);
        return;
      }
      this.#logger.warn('non-ingestible kind %s has no registered handler — discarded', notification.method);
      return;
    }
    this.#injectDomainEvent(serverName, notification.method, payload);
  }

  /**
   * Emission path for pipeline subsystems producing finished
   * artifacts. Payloads are already validated by their constructors;
   * the method exists so subsystems share the injection path (and its
   * logging/error handling) without round-tripping through the MCP
   * servers.
   */
  emitPipelineEvent(kind: 'transcript/ready' | 'processing/error', payload: unknown): void {
    this.#injectDomainEvent('pipeline', kind, payload);
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
