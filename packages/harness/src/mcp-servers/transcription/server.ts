
import { McpLocalServer } from "@fondamenta/mcp-local";
import { type CompleteContext } from "../../context.js";
import { type HarnessMcpToolCallContext } from "../../types/tools.js";
import { errToString } from "@fondamenta/utils";

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
    if (!ctx.managers.models.transcription) {
      // TODO: notify the agent that no transcription model is configured and
      //       thus the transcription. Change to `return true` when done.
      return false;
    }
    const { method, params } = notification;
    if (method != 'message/new') {
      return false;
    }
    // Skip-if-already-processed: value-based, NOT presence-based — the
    // mcp-manager routing cast() adds optional keys with undefined values,
    // so presence checks fire on first pass (same trap as contacts; see
    // the comment in contacts/server.ts).
    if (params.transcription !== undefined) {
      return false;
    }
    notification.params.transcription = null;
    const { content, transcription } = params;
    if (content.type !== 'voice') {
      return false;
    }
    try {
      const result = await ctx.managers.models.transcription.transcribe(content.path);
      notification.params.transcription = {
        text: result.text,
        language: result.language,
        time: result.duration_ms,
        transcriber: 'transcription model', // TODO: model id or coordinates
      };
      await ctx.buses.notifications.notify(notification);
      return true;
    } catch (err) {
      notification.params.transcription = {
        error: errToString(err),
      };
      await ctx.buses.notifications.notify(notification);
      return true;
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
