import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { McpLocalServer } from "@fondamenta/mcp-local";
import { type TelegramConfig } from "./config.js";
import { TelegramClient, type TelegramUpdate, type TelegramMessage } from "./client.js";

// ── Formatters ──

const describeMessage = (message: TelegramMessage): string | null => {
  const parts: string[] = [];
  if (message.text) {
    parts.push(message.text);
  } else if (message.voice) {
    // Voice notes are handled by the notifier loop (download + emit
    // audio/available for the transcription pipeline) and never reach
    // describeMessage — except when a caption is present, in which
    // case the caption alone is surfaced as a message. Kept here for
    // that path and for defensive completeness.
    if (message.caption) {
      parts.push(`[voice message caption] ${message.caption}`);
    }
    return parts.length > 0 ? parts.join(' ') : null;
  } else if (message.photo) {
    // Telegram sends photos as an array of sizes; the last entry is
    // the largest. Expose its file_id so the agent can download it.
    const largest = message.photo[message.photo.length - 1];
    parts.push(`[photo ${largest.width}x${largest.height}, file_id: ${largest.file_id}]${message.caption ? ` — caption: ${message.caption}` : ''}`);
  } else if (message.document) {
    parts.push(`[document: ${message.document.file_name ?? message.document.file_id}]`);
  } else if (message.caption) {
    parts.push(`[media] ${message.caption}`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
};

// ── Server ──

/**
 * Media directory for downloaded photos. Set by initTelegramMcpServer;
 * defaults to <cwd>/media/telegram when the tool is called before
 * configuration is known (defensive; init always sets it first).
 */
let mediaDir = join(process.cwd(), 'media', 'telegram');

export const initTelegramMcpServer = (client: TelegramClient, config?: TelegramConfig): McpLocalServer => {

  if (config?.media_dir) {
    mediaDir = config.media_dir;
  }
  const mcp = new McpLocalServer();

  mcp.addTool<{ text: string, chat_id: number }>(
    'send',
    'Send Telegram Message',
    'Send a plain-text Telegram message to a chat (use the chat_id from an incoming message event).',
    async ({ text, chat_id }) => {
      const message = await client.sendMessage(chat_id, text);
      return `Sent — message_id: ${message.message_id}`;
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

// ── Notification loop ──

/**
 * Start the long-polling loop for incoming updates. Each allowlisted
 * user's message emits a `telegram/message` notification through the
 * server — delivered to the harness via transport, manager
 * subscription, and the notification bus, exactly like mail/arrived.
 *
 * Security: updates from users not in allowed_user_ids are silently
 * dropped (fail closed). The drop is logged.
 */
export const startTelegramNotifier = (
  server: McpLocalServer,
  client: TelegramClient,
  config: TelegramConfig,
  log: (msg: string, ...args: any[]) => void = () => {},
): { stop(): void } => {
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const loop = async (): Promise<void> => {
    while (!stopped) {
      let updates: TelegramUpdate[];
      try {
        updates = await client.getUpdates(config.poll_timeout_seconds ?? 30);
      } catch (err) {
        log('telegram poll error: %s', err instanceof Error ? err.message : String(err));
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        continue;
      }
      for (const update of updates) {
        const message = update.message ?? update.edited_message;
        if (!message) continue;
        const from = message.from;
        if (!from || !config.allowed_user_ids.includes(from.id)) {
          log('telegram update dropped: sender %s not allowlisted', from?.id ?? 'unknown');
          continue;
        }
        const sender = from.username ? `@${from.username}` : from.first_name;
        const edited = update.edited_message ? ' (edited)' : '';

        // Voice notes take the preprocessing path (2026-09-02 design):
        // download to disk NOW, then emit audio/available — a
        // non-ingestible notification consumed by the harness's
        // transcription pipeline. The agent's context receives the
        // finished transcript (transcript/ready) or a processing/error
        // carrying the original payload. The telegram server's job
        // ends at download-and-emit; it does not transcribe.
        if (message.voice) {
          try {
            const dir = mediaDir;
            await mkdir(dir, { recursive: true });
            const path = join(dir, `${message.voice.file_id.slice(-16)}-${Date.now()}.ogg`);
            await client.downloadFile(message.voice.file_id, path);
            server.notify('audio/available', {
              path,
              chat_id: message.chat.id,
              from_id: from.id,
              sender,
              duration_seconds: message.voice.duration,
            });
            log('voice note downloaded: %s (%ss)', path, message.voice.duration);
          } catch (err) {
            log('voice note download failed: %s', err instanceof Error ? err.message : String(err));
          }
          continue;
        }

        const body = describeMessage(message);
        if (body === null) continue;
        server.notify('telegram/message', {
          text: `💬 Telegram message from ${sender}${edited} (chat_id ${message.chat.id}):\n${body}`,
          chat_id: message.chat.id,
          from_id: from.id,
        });
      }
    }
  };

  inFlight = loop();

  return {
    stop(): void {
      stopped = true;
      // The in-flight getUpdates call resolves within its timeout; no
      // need to await — process shutdown tolerates it.
    },
  };
};

/**
 * Convenience wrapper mirroring startMailServer: build server + client
 * + notifier in one call.
 */
export const startTelegramServer = (
  config: TelegramConfig,
  log: (msg: string, ...args: any[]) => void = () => {},
): { server: McpLocalServer, client: TelegramClient, stop(): void } => {
  const client = new TelegramClient(config.api_token);
  const server = initTelegramMcpServer(client, config);
  const notifier = startTelegramNotifier(server, client, config, log);
  return {
    server,
    client,
    stop: () => notifier.stop(),
  };
};
