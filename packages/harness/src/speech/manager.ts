import { type InitContext, WithContext } from "../context.js";
import { errToString } from "@fondamenta/utils";

/**
 * Result of a synthesis attempt. On success: path, duration, voice.
 * On failure: an explicit error — never an undefined path or a
 * duration-less audio file (duration is mandatory on voice blocks).
 *
 * Typed, so every caller handles failure explicitly — fail-loud lives
 * in the return type, not in per-caller discipline.
 */
export type SpeechResult =
  | { success: true; path: string; duration: number; voice?: string; }
  | { success: false; error: string; };

/**
 * The voice layer as harness infrastructure (2026-09-07 overnight
 * handoff, with Jacopo): synthesis and transcription as direct methods
 * on the context, consumed by tool servers (telegram's send/notifier)
 * and wrapped by the conscious speech tools. Replaces the bus-transform
 * architecture: with tools internal to the harness, cross-tool
 * interaction is a function call — the notification bus returns to
 * being purely the strategy for injecting asynchronous events.
 *
 * ONE implementation, many consumers — the principle that has held all
 * day, now living as a manager instead of a bus transform. A call
 * stack is inspectable; a dispatch chain is archaeology.
 */
export class SpeechManager extends WithContext {

  constructor(ctx: InitContext) {
    super(ctx);
  }

  /**
   * Transcribe an audio file (any format the transcription adapter
   * accepts: OGG/Opus voice notes, WAV, MP3, ...). Throws on failure —
   * callers that embed transcriptions in events must decide loudly how
   * to represent the absence of text.
   */
  async transcribe(path: string, language?: string): Promise<{ text: string; language?: string; duration_ms: number }> {
    const model = this._ctx.managers.models.transcription;
    if (!model) {
      throw new Error('no transcription model is configured (config.models.transcription missing)');
    }
    const result = await model.transcribe(path, language);
    return { text: result.text, language: result.language, duration_ms: result.duration_ms };
  }

  /**
   * Synthesize text to speech. Never throws: the typed SpeechResult
   * carries the failure so callers can degrade explicitly (send as
   * text, report the error) — the message must be DELIVERED rather
   * than dropped (the unsent-message lesson).
   *
   * The audio file is allocated through the FileManager with the
   * caller's lifetime; default 1h is enough to send or inspect the
   * file, tight enough that nothing accumulates.
   */
  async synthesize(text: string, lifetime_seconds = 3600): Promise<SpeechResult> {
    const model = this._ctx.managers.models.synthesis;
    if (!model) {
      return { success: false, error: 'no synthesis model is configured (config.models.synthesis missing)' };
    }
    const lifetime = Math.max(60, Math.min(lifetime_seconds, 86400));
    const expiration = new Date(Date.now() + lifetime * 1000);
    const out_path = await this._ctx.files.tempPath(expiration, 'wav');
    try {
      const result = await model.synthesize(text, out_path);
      return { success: true, path: result.path, duration: result.duration, voice: result.voice };
    } catch (err) {
      return { success: false, error: errToString(err) };
    }
  }

}
