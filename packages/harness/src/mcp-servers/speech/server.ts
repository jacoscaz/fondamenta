import { McpLocalServer } from "@fondamenta/mcp-local";
import { type CompleteContext } from "../../context.js";
import { type HarnessMcpToolCallContext } from "../../types/tools.js";
import { errToString } from "@fondamenta/utils";
import { VoiceContent, type McpOutgoingMessageNotification } from "@fondamenta/mcp-core";
import type { AbstractSynthesisModel } from "../../models/synthesis/abstract.js";

interface TranscribeParams {
  /** Absolute path to the audio file on disk. */
  path: string;
  /** ISO-639-1 language hint; omit to auto-detect. */
  language?: string;
}

interface TextToSpeechParams {
  /** Text to synthesize. Length limits are endpoint-specific. */
  text: string;
  /**
   * Lifetime of the produced audio file, in seconds. The FileManager
   * expires it at now + lifetime. Default 3600 (1 hour) — enough for
   * the agent to send or inspect the file, tight enough that nothing
   * accumulates.
   */
  lifetime_seconds?: number;
}

const SUPPORTED_MIME_TYPES = ['audio/ogg', 'audio/wav', 'audio/mp3'];

/**
 * Synthesize one text block into a voice block in place. Shared by the
 * conscious tool path (textToSpeech tool) and the automatic bus path
 * (OutgoingMessage transform) — one implementation, two entries, so the
 * two paths cannot drift apart.
 */
const synthesizeBlocks = async (
  model: AbstractSynthesisModel,
  ctx: CompleteContext,
  text: string,
  lifetime_seconds: number,
): Promise<{ path: string; duration: number } | { error: string }> => {
  const expiration = new Date(Date.now() + lifetime_seconds * 1000);
  const out_path = await ctx.files.tempPath(expiration, 'wav');
  try {
    const result = await model.synthesize(text, out_path);
    return { path: result.path, duration: result.duration };
  } catch (err) {
    return { error: errToString(err) };
  }
};

export const initSpeechMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp = new McpLocalServer<HarnessMcpToolCallContext>();
  const logger = ctx.logger.child('[mcp:speech]');

  // ── Automatic transcription (inbound voice notes) ──
  //
  // SUBSCRIPTION ORDER IS LOAD-BEARING. The chain for message/new must be:
  //   contacts → speech → session-manager (terminal, injects and stops).
  //
  // The bus runs handlers first-true-wins; 'high' priority unshifts.
  // Among high-priority subscribers, the LAST registered runs FIRST —
  // unshift order is the reverse of registration order. Registration in
  // server.ts is: telegram → speech → contacts, so the runtime chain is
  // contacts → speech → telegram → session-manager (low). Speech sits
  // before session-manager, which is the whole point: before this fix
  // (2026-09-07) the transcription subscriber ran at default priority,
  // landed AFTER session-manager, and NEVER saw a message/new —
  // auto-transcription was silently dead, masked by the agent's manual
  // transcribe habit. A guarantee died in the periphery of the chain.
  //
  // Contacts decorates the envelope (standing); speech decorates voice
  // blocks (transcription); session-manager injects. Each transforms and
  // re-emits; null-vs-set field semantics carry the claim state.
  ctx.buses.notifications.subscribe('mcp-speech', async (notification) => {
    if (notification.method !== 'message/new') {
      return false;
    }
    const { content } = notification.params;
    const pending_blocks: VoiceContent[] = content.filter(b => b.type === 'voice' && !b.transcription) as VoiceContent[];
    if (pending_blocks.length === 0) {
      // Voice blocks may legitimately be absent: nothing to do, but the
      // notification IS ours to handle — return true so later subscribers
      // (session-manager) still see it via our re-emit below. Actually:
      // with nothing pending we are a pass-through; return false and let
      // the next subscriber act.
      return false;
    }
    if (!ctx.managers.models.transcription) {
      // No transcription model configured. Mark each pending block with an
      // explicit error — loud absence, never silent drop (finding #6):
      // the session must SEE that a voice note arrived and could not be
      // transcribed, not merely receive a transcription-less block.
      for (const block of pending_blocks) {
        block.transcription = {
          success: false,
          error: 'no transcription model is configured (config.models.transcription missing)',
        };
      }
      await ctx.buses.notifications.notify(notification);
      return true;
    }
    for (const block of pending_blocks) {
      try {
        const result = await ctx.managers.models.transcription.transcribe(block.path);
        block.transcription = {
          success: true,
          text: result.text,
          language: result.language,
          time: result.duration_ms,
          transcriber: 'transcription model', // TODO: model id or coordinates
        };
      } catch (err) {
        block.transcription = {
          success: false,
          error: errToString(err),
        };
      }
    }
    await ctx.buses.notifications.notify(notification);
    return true;
  }, 'high');

  // ── Automatic synthesis (outgoing messages, synthesize: true) ──
  //
  // Consumes message/outgoing notifications whose synthesize flag is set,
  // converts text blocks to voice blocks in place, clears the flag, and
  // re-emits for the transport subscriber (telegram) to dispatch. If
  // synthesis fails, the notification is re-emitted UNCHANGED except the
  // flag is cleared and the text block carries an error prefix — the
  // message must still be DELIVERED (as text) rather than dropped:
  // outbound silence is the failure mode this architecture exists to
  // prevent (the unsent-message lesson, anchor #49).
  ctx.buses.notifications.subscribe('mcp-speech-outgoing', async (notification) => {
    if (notification.method !== 'message/outgoing') {
      return false;
    }
    if (!notification.params.synthesize) {
      return false; // text-only dispatch: not ours; telegram consumes it
    }
    if (!ctx.managers.models.synthesis) {
      logger.error('synthesize requested but no synthesis model is configured — delivering as text');
      notification.params.synthesize = false;
      for (const block of notification.params.content) {
        if (block.type === 'text') {
          block.text = `[voice synthesis unavailable — delivered as text]\n${block.text}`;
        }
      }
      await ctx.buses.notifications.notify(notification);
      return true;
    }
    let all_succeeded = true;
    for (const block of notification.params.content) {
      if (block.type !== 'text') continue;
      const result = await synthesizeBlocks(ctx.managers.models.synthesis, ctx, block.text, 3600);
      if ('error' in result) {
        all_succeeded = false;
        logger.error('synthesis failed for outgoing message: %s', result.error);
        block.text = `[voice synthesis failed — delivered as text: ${result.error}]\n${block.text}`;
        continue;
      }
      // Replace the text block with a voice block, preserving subject.
      const index = notification.params.content.indexOf(block);
      notification.params.content[index] = {
        type: 'voice',
        subject: block.subject ?? null,
        path: result.path,
        duration: result.duration,
      };
    }
    notification.params.synthesize = false; // satisfied (or degraded to text)
    logger.info('outgoing message transformed (%s)', all_succeeded ? 'voice' : 'degraded to text');
    await ctx.buses.notifications.notify(notification);
    return true;
  }, 'high');

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
        const result = await model.transcribe(path, language);
        const meta = result.language ? ` (language: ${result.language}, ${result.duration_ms}ms)` : ` (${result.duration_ms}ms)`;
        return [{ type: 'text', text: `${result.text.trim()}${meta}` }];
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return [{ type: 'text', text: `Transcription failed: ${message}` }];
      }
    },
  );

  mcp.addTool<TextToSpeechParams>(
    'speak',
    'Synthesize Speech',
    'Synthesize text to speech using the configured synthesis model. Writes an audio file (WAV) to the managed temp directory and returns its path, duration, and expiration. Use for producing voice messages to send via mcp_telegram_sendVoiceMessage, or any audio artifact. The file self-expires (default 1h) via the FileManager.',
    async ({ text, lifetime_seconds }) => {
      const model = ctx.managers.models.synthesis;
      if (!model) {
        return [{ type: 'text', text: 'Error: no synthesis model is configured (config.models.synthesis missing).' }];
      }
      const lifetime = Math.max(60, Math.min(lifetime_seconds ?? 3600, 86400));
      const result = await synthesizeBlocks(model, ctx, text, lifetime);
      if ('error' in result) {
        return [{ type: 'text', text: `Synthesis failed: ${result.error}` }];
      }
      const expires_at = new Date(Date.now() + lifetime * 1000).toISOString();
      return [{ type: 'text', text: `Audio written: ${result.path}\nDuration: ${result.duration.toFixed(1)}s\nExpires: ${expires_at}` }];
    },
  );

  return mcp;
};
