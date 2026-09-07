import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { McpLocalServer } from "@fondamenta/mcp-local";
import { type TelegramConfig } from "./config.js";
import { TelegramClient } from "./client.js";
import { startTelegramNotifier } from "./notifier.js";
import { TextContent, McpOutgoingMessageNotification } from "@fondamenta/mcp-core";

/**
 * Minimal structural dependency on the host's notification bus. The
 * telegram package must NOT import harness types (circular dependency:
 * the harness depends on this package). Structural typing lets the
 * harness pass its real bus; this package only needs subscribe().
 */
export interface OutgoingBusLike {
  /**
   * Subscribe to bus notifications. The handler accepts the FULL
   * notification union (the harness bus routes all notification types);
   * telegram's handler filters for message/outgoing internally.
   * Declared as `any`-parameterized here because this package cannot
   * import the harness notification union (circular dependency).
   */
  subscribe(
    name: string,
    handler: (notification: any) => Promise<boolean> | boolean,
    priority?: 'high' | 'low',
  ): void;
}

export interface OutgoingLoggerLike {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface TelegramHostContext {
  buses: { notifications: OutgoingBusLike };
  logger: { child(prefix: string): OutgoingLoggerLike };
}


// ── Server ──

/**
 * Media directory for downloaded photos. Set by initTelegramMcpServer;
 * defaults to <cwd>/media/telegram when the tool is called before
 * configuration is known (defensive; init always sets it first).
 */
let mediaDir = join(process.cwd(), 'media', 'telegram');

/**
 * Voice notes produced by Telegram are OGG/Opus; synthesis output is
 * WAV. Telegram's sendVoice requires OGG/Opus (WAV goes out as a plain
 * audio document, not a playable voice note), so outgoing synthesized
 * audio is converted here before dispatch — the transport owns format
 * details, per the adapter doctrine.
 */
const wavToOgg = async (wav_path: string): Promise<string> => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const ogg_path = `${wav_path.replace(/\.wav$/, '')}.ogg`;
  await promisify(execFile)('ffmpeg', ['-y', '-i', wav_path, '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', ogg_path]);
  return ogg_path;
};

export const initTelegramMcpServer = (config: TelegramConfig, ctx?: TelegramHostContext): McpLocalServer<any> => {

  if (config?.media_dir) {
    mediaDir = config.media_dir;
  }

  const mcp = new McpLocalServer<{}>();

  const client = new TelegramClient(config.api_token);
  const notifier = startTelegramNotifier(mcp, client, config, console.log, mediaDir);
  const logger_outgoing = ctx ? ctx.logger.child('[mcp:telegram-outgoing]') : null;

  mcp.destroy = () => {
    notifier.stop();
  };

  // ── Outgoing message dispatch ──
  //
  // The telegram server is both PRODUCER and CONSUMER on the bus: its
  // sendVoiceMessage tool emits message/outgoing; this subscriber —
  // registered at 'high' priority (see server.ts ordering block) — is the
  // FINAL leg: it receives the notification back after any intermediate
  // transforms (speech synthesis replaces text blocks with voice blocks
  // and clears the synthesize flag) and performs the actual API call.
  //
  // Servers must not depend on one another: telegram depends on the BUS,
  // not on the speech server. Whatever transforms happen between emission
  // and this handler, this code only sees the result.
  if (ctx) {
    ctx.buses.notifications.subscribe('mcp-telegram-outgoing', async (notification): Promise<boolean> => {
      const { params } = notification;
      if (params.transport.type !== 'telegram') {
        return false;
      }
      try {
        const sent_ids: number[] = [];
        for (const block of params.content) {
          if (block.type === 'text') {
            const message = await client.sendMessage(params.transport.chat_id, block.text);
            sent_ids.push(message.message_id);
          } else if (block.type === 'voice') {
            // Synthesis produces WAV; Telegram voice notes want OGG/Opus.
            let path = block.path;
            if (path.endsWith('.wav')) {
              path = await wavToOgg(path);
            }
            const message = await client.sendVoice(params.transport.chat_id, path, block.duration);
            sent_ids.push(message.message_id);
          }
        }
        logger_outgoing?.info('outgoing message dispatched: %d block(s) → message_id(s) %s', params.content.length, sent_ids.join(','));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger_outgoing?.error('outgoing dispatch FAILED: %s', message);

        // Deliver a processing/error notification — outbound failures must
        // be loud (the unsent-message lesson). The agent learns delivery
        // failed from the bus, never from silence.
        mcp.notify({
          method: 'processing/error',
          params: { error: `telegram outgoing dispatch failed: ${message}` },
        });
      }
      return true;
    }, 'high');
  }

  mcp.addTool<{ text: string, chat_id: number }>(
    'send',
    'Send Telegram Message',
    'Send a plain-text Telegram message to a chat (use the chat_id from an incoming message event).',
    async ({ text, chat_id }) => {
      const message = await client.sendMessage(chat_id, text);
      return `Sent — message_id: ${message.message_id}`;
    },
  );

  /**
   * Voice-note send. When synthesize is true, the call emits a
   * message/outgoing notification and returns immediately — the speech
   * server transforms text→voice on the bus, then this server's
   * subscriber dispatches. The returned "queued" line is NOT a delivery
   * confirmation; delivery confirmation arrives as either the message_id
   * (via the bus consumer's log) or a processing/error notification.
   */
  mcp.addTool<{ text: string, chat_id: number, synthesize?: boolean }>(
    'sendVoiceMessage',
    'Send Telegram Voice Message',
    'Send a voice note to a Telegram chat. Two modes: (1) synthesize: true — text is synthesized to speech with the configured voice and sent as a playable voice note (returns immediately with "queued"; delivery follows asynchronously); (2) synthesize: false/omitted — path must point to an existing audio file (WAV is converted to OGG/Opus automatically) and it is sent directly.',
    async ({ text, chat_id, synthesize }) => {
      if (synthesize) {
        mcp.notify({
          method: 'message/outgoing',
          params: {
            content: [{ type: 'text', text } satisfies TextContent],
            transport: { type: 'telegram', chat_id, from_id: 0 },
            synthesize: true,
          },
        });
        return `Queued for voice synthesis and delivery to chat ${chat_id}. Delivery is asynchronous: confirmation or failure arrives as a processing/error or via the outgoing log.`;
      }
      // Direct file mode: `text` carries the audio file path.
      const path = text;
      let duration = 0;
      try {
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const { stdout } = await promisify(execFile)('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
        duration = Number(stdout.trim());
      } catch {
        duration = 0;
      }
      if (!Number.isFinite(duration) || duration <= 0) {
        return 'Error: could not determine audio duration (ffprobe failed). Duration is required by the Telegram API.';
      }
      let send_path = path;
      if (path.endsWith('.wav')) {
        send_path = await wavToOgg(path);
      }
      const message = await client.sendVoice(chat_id, send_path, duration);
      return `Sent voice note — message_id: ${message.message_id}, duration: ${Math.round(duration)}s`;
    },
  );

  mcp.addTool<{}>(
    'me',
    'Bot Identity',
    'Get this bot\'s Telegram identity (id, username) — useful to share with users.',
    async ({}) => {
      const me = await client.getMe();
      return `Bot: @${me.username ?? me.id} (id ${me.id}, "${me.first_name}")`;
    },
  );

  mcp.addTool<{ file_id: string; file_name?: string }>(
    'file',
    'Download Telegram File',
    'Download any incoming Telegram media (photo, voice note, document, video note, audio) by its file_id into the media directory. Returns the saved path — view images with the file-reading tool, process other media with CLI tools.',
    async ({ file_id, file_name }) => {
      const dir = mediaDir;
      await mkdir(dir, { recursive: true });
      const ext = file_name?.includes('.') ? `.${file_name.split('.').pop()}` : '';
      const path = join(dir, `${file_id.slice(-16)}-${Date.now()}${ext}`);
      await client.downloadFile(file_id, path);
      return `File saved to ${path}`;
    },
  );

  return mcp;
};
