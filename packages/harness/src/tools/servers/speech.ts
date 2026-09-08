import { type CompleteContext } from "../../context.js";

/**
 * The conscious speech tools: thin wrappers over ctx.speech for direct,
 * deliberate use (craft synthesis — samples, files, no send — and
 * on-demand transcription). The automatic paths (telegram notifier
 * transcription, send_voice synthesis) call the SAME manager directly;
 * these tools exist for the agent's conscious hand, not as a separate
 * pipeline. One implementation, many consumers.
 */
export const initSpeechTools = (ctx: CompleteContext) => {

  ctx.managers.tools.add<{ path: string; language?: string }>(
    'speech_transcribe',
    'Transcribe Audio File',
    'Transcribe an audio file (any format: OGG/Opus voice notes, WAV, MP3, ...) to text using the configured transcription service. Takes an absolute filesystem path. Incoming voice notes are transcribed automatically; use this for on-demand transcription of other audio.',
    true,
    async ({ path, language }) => {
      try {
        const result = await ctx.speech.transcribe(path, language);
        const meta = result.language ? ` (language: ${result.language}, ${result.duration_ms}ms)` : ` (${result.duration_ms}ms)`;
        return [{ type: 'text', text: `${result.text.trim()}${meta}` }];
      } catch (err) {
        return [{ type: 'text', text: `Transcription failed: ${err instanceof Error ? err.message : String(err)}` }];
      }
    },
  );

  ctx.managers.tools.add<{ text: string; lifetime_seconds?: number }>(
    'speech_speak',
    'Synthesize Speech',
    'Synthesize text to speech using the configured synthesis model (vox). Writes an audio file to the managed temp directory and returns its path, duration, and expiration. Use for producing audio artifacts (send via telegram_send_voice with synthesize: false, or inspect directly). The file self-expires (default 1h) via the FileManager.',
    true,
    async ({ text, lifetime_seconds }) => {
      const result = await ctx.speech.synthesize(text, lifetime_seconds ?? 3600);
      if (!result.success) {
        return [{ type: 'text', text: `Synthesis failed: ${result.error}` }];
      }
      const expires_at = new Date(Date.now() + Math.max(60, Math.min(lifetime_seconds ?? 3600, 86400)) * 1000).toISOString();
      return [{ type: 'text', text: `Audio written: ${result.path}\nDuration: ${result.duration.toFixed(1)}s\nVoice: ${result.voice ?? 'default'}\nExpires: ${expires_at}` }];
    },
  );

};
