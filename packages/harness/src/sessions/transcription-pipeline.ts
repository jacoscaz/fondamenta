import { WithContext, type InitContext } from "../context.js";
import { unlink } from "node:fs/promises";
import {
  NOTIFICATION_KINDS,
  type AudioAvailablePayload,
  type TranscriptReadyPayload,
  type ProcessingErrorPayload,
} from "./notification-kinds.js";

/**
 * The transcription pipeline: subscribes to `audio/available`
 * notifications, runs the file through the configured transcription
 * model, and emits either `transcript/ready` (ingestible — reaches
 * the weave as a completed event) or `processing/error` (ingestible —
 * reaches the weave with the original payload preserved, so the agent
 * can fall back to manual transcription).
 *
 * This subsystem is the ONLY consumer of `audio/available`. Raw audio
 * notifications never reach the agent's context — by construction,
 * via the bus's kind whitelist.
 *
 * Policy (ruled 2026-09-02): no automatic retries. Failure produces
 * an error event; the agent decides what to do. The pipeline is not
 * critical-path.
 */
export class TranscriptionPipeline extends WithContext {

  #logger: any;
  /** Files already enqueued (dedup across duplicate notifications). */
  #inFlight = new Set<string>();

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[transcription]');
  }

  async handleAudioAvailable(payload: AudioAvailablePayload): Promise<void> {
    const model = this._ctx.managers.models.transcription;
    if (!model) {
      // No transcription model configured: emit error so the artifact
      // is not silently lost (monotonic information principle).
      this.#emitError('transcription', 'no transcription model configured', payload as unknown as Record<string, unknown>);
      return;
    }
    if (this.#inFlight.has(payload.path)) {
      this.#logger.debug('duplicate audio/available for %s, ignoring', payload.path);
      return;
    }
    this.#inFlight.add(payload.path);
    try {
      this.#logger.info('transcribing %s (%ss, from %s)', payload.path, payload.duration_seconds ?? '?', payload.sender);
      const result = await model.transcribe(payload.path);
      const ready: TranscriptReadyPayload = {
        ...payload,
        text: result.text,
        language: result.language,
        transcription_ms: result.duration_ms,
        transcribed_by: `${this._ctx.config.models.transcription?.options.model ?? 'transcription-model'}@${this._ctx.config.models.transcription?.options.base_url ?? 'local'}`,
      };
      this._ctx.notifiers.bus.emitPipelineEvent('transcript/ready', ready);
      this.#logger.info('transcript ready for %s (%d ms): %d chars', payload.path, result.duration_ms, result.text.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#logger.error('transcription failed for %s: %s', payload.path, message);
      this.#emitError('transcription', message, payload as unknown as Record<string, unknown>);
    } finally {
      // Cleanup: the transcript now carries everything worth keeping;
      // the raw audio has served its purpose. Best-effort — deletion
      // failure is logged, never thrown.
      unlink(payload.path).catch((e: unknown) => {
        this.#logger.debug('could not delete %s: %s', payload.path, e instanceof Error ? e.message : String(e));
      }).finally(() => this.#inFlight.delete(payload.path));
    }
  }

  #emitError(step: string, error: string, original: Record<string, unknown>): void {
    const payload: ProcessingErrorPayload = { step, error, original };
    this._ctx.notifiers.bus.emitPipelineEvent('processing/error', payload);
  }
}
