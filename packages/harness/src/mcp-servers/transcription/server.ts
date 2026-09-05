
import { McpLocalServer } from "@fondamenta/mcp-local";
import { type CompleteContext } from "../../context.js";
import { type HarnessMcpToolCallContext } from "../../types/tools.js";

interface TranscribeParams {
  /** Absolute path to the audio file on disk. */
  path: string;
  /** ISO-639-1 language hint; omit to auto-detect. */
  language?: string;
}

const SUPPORTED_MIME_TYPES = ['audio/ogg', 'audio/wav', 'audio/mp3'];

export const initTranscriptionMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp = new McpLocalServer <HarnessMcpToolCallContext>();
  const logger = ctx.logger.child('[mcp:transcription]');

  ctx.buses.notifications.subscribe('mcp-transcription', async (notification) => {
    if (notification.method != 'message/new') {
      return false;
    }
    if (notification.params.content.type !== 'voice') {
      return false;
    }
    if (!ctx.managers.models.transcription) {
      // TODO: notify the agent that no transcription model is configured and
      //       thus the transcription. Change to `return true` when done.
      return false;
    }
    if ('transcription' in notification.params) {
      return false;
    }
    notification.params.transcription = null;
    try {
      const result = await ctx.managers.models.transcription.transcribe(notification.params.content.path);
      notification.params.transcription = {
        text: result.text,
        language: result.language,
        time: result.duration_ms,
        transcriber: 'transcription model', // TODO: model id or coordinates
      };
      await ctx.buses.notifications.notify(notification);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return false;
    }
  });

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
