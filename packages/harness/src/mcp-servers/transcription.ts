// Transcription MCP server.
//
// Speech-to-text as MCP coordination (design: Jacopo, 2026-09-02,
// voice): instead of a dedicated preprocessing pipeline class, the
// transcription capability is an MCP server that participates in the
// notification bus like every other server. Two faces, one service:
//
// - TOOLS: `transcribe` takes a path to an audio file and returns
//   text. Manual, on-demand, whatever content — always wired to the
//   service configured in config.models.transcription. The agent
//   never configures the service itself.
//
// - SUBSCRIPTION: the server subscribes to `audio/available`
//   (non-ingestible kind — never reaches the weave), transcribes the
//   file, and emits `transcript/ready` (ingestible) or
//   `processing/error` through the normal server→client notification
//   path, which the manager routes to the bus. Indirect coordination
//   with the telegram server, by means of the bus only.
//
// Monotonic information principle: the transcript/error payload
// preserves every field the audio/available notification carried and
// adds the transcript (or the error + original payload).
//
// Policy (ruled 2026-09-02): no automatic retries. Failure produces
// a processing/error event carrying the original file path so the
// agent can fall back to manual transcription. The pipeline is not
// critical-path.

import { unlink } from "node:fs/promises";
import { McpLocalServer } from "@fondamenta/mcp-local";
import { type CompleteContext } from "../context.js";
import { type HarnessMcpToolCallContext } from "../types.js";
import { type JsonRpcParams } from "@fondamenta/mcp-core";
import { NOTIFICATION_KINDS, type AudioAvailablePayload, type TranscriptReadyPayload, type ProcessingErrorPayload } from "../sessions/notification-kinds.js";

interface TranscribeParams {
  /** Absolute path to the audio file on disk. */
  path: string;
  /** ISO-639-1 language hint; omit to auto-detect. */
  language?: string;
}

const asAudioAvailable = (params: JsonRpcParams | undefined): AudioAvailablePayload => {
  const spec = NOTIFICATION_KINDS['audio/available'];
  return spec.validate(params) as AudioAvailablePayload;
};

class TranscriptionMcpServer extends McpLocalServer<HarnessMcpToolCallContext> {

  #ctx: CompleteContext;
  #logger: any;
  /** Files being transcribed (dedup across duplicate notifications). */
  #inFlight = new Set<string>();

  constructor(ctx: CompleteContext) {
    super();
    this.#ctx = ctx;
    this.#logger = ctx.logger.child('[transcription]');
  }

  /**
   * Client→server notification channel: the bus delivers
   * audio/available notifications here. This is the subscription face
   * of the server — the automatic path.
   */
  override async onNotification(method: string, params: JsonRpcParams | undefined, _ctx: HarnessMcpToolCallContext): Promise<void> {
    if (method === 'audio/available') {
      let payload: AudioAvailablePayload;
      try {
        payload = asAudioAvailable(params);
      } catch (err) {
        // Malformed: discarded at the bus already (the bus validates
        // before routing); reaching here means a direct delivery.
        this.#logger.warn('discarding malformed audio/available: %s', err instanceof Error ? err.message : String(err));
        return;
      }
      await this.#transcribeAndEmit(payload);
      return;
    }
    // Protocol notifications (notifications/initialized etc.):
    // accepted and ignored, per base-class behavior.
  }

  async #transcribeAndEmit(payload: AudioAvailablePayload): Promise<void> {
    const model = this.#ctx.managers.models.transcription;
    if (!model) {
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
      const cfg = this.#ctx.config.models.transcription?.options;
      const ready: TranscriptReadyPayload = {
        ...payload,
        text: result.text,
        language: result.language,
        transcription_ms: result.duration_ms,
        transcribed_by: `${cfg?.model ?? 'transcription-model'}@${cfg?.base_url ?? 'local'}`,
      };
      // Emission through the normal server→client notification path:
      // the manager routes it to the bus, the bus validates and
      // injects. Same road every other server travels.
      this.notify('transcript/ready', ready as unknown as Record<string, unknown>);
      this.#logger.info('transcript ready for %s (%d ms): %d chars', payload.path, result.duration_ms, result.text.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#logger.error('transcription failed for %s: %s', payload.path, message);
      this.#emitError('transcription', message, payload as unknown as Record<string, unknown>);
    } finally {
      // The transcript (or error carrying the path) now preserves
      // everything worth keeping; the raw audio has served its
      // purpose. Best-effort deletion.
      unlink(payload.path).catch((e: unknown) => {
        this.#logger.debug('could not delete %s: %s', payload.path, e instanceof Error ? e.message : String(e));
      }).finally(() => this.#inFlight.delete(payload.path));
    }
  }

  #emitError(step: string, error: string, original: Record<string, unknown>): void {
    const payload: ProcessingErrorPayload = { step, error, original };
    this.notify('processing/error', payload as unknown as Record<string, unknown>);
  }
}

export const initTranscriptionMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp = new TranscriptionMcpServer(ctx);

  // ── Tool face: manual, on-demand transcription ──

  mcp.addTool<TranscribeParams>(
    'transcribe',
    'Transcribe Audio File',
    'Transcribe an audio file (any format: OGG/Opus voice notes, WAV, MP3, ...) to text using the configured transcription service. Takes an absolute filesystem path — e.g. a voice note downloaded by the telegram server. Returns the transcribed text. Use when you need transcription on demand; incoming voice notes are transcribed automatically.',
    async ({ path, language }) => {
      const model = ctx.managers.models.transcription;
      if (!model) {
        return [{ type: 'text', text: 'Error: no transcription model is configured (config.models.transcription missing).' }];
      }
      try {
        const result = await model.transcribe(path);
        const meta = result.language ? ` (language: ${result.language}, ${result.duration_ms}ms)` : ` (${result.duration_ms}ms)`;
        return [{ type: 'text', text: `${result.text.trim()}${meta}` }];
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return [{ type: 'text', text: `Transcription failed: ${message}` }];
      }
    },
  );

  return mcp;
};
