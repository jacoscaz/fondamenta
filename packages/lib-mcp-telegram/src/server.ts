import { McpLocalServer } from "@fondamenta/mcp-local";
import { type TelegramConfig } from "./config.js";
import { TelegramClient, type TelegramUpdate, type TelegramMessage } from "./client.js";

// ── Formatters ──

const describeMessage = (message: TelegramMessage): string | null => {
  const parts: string[] = [];
  if (message.text) {
    parts.push(message.text);
  } else if (message.voice) {
    parts.push(`[voice message, ${message.voice.duration}s — transcription not yet supported]`);
  } else if (message.photo) {
    parts.push(`[photo, ${message.photo.length} size(s)]`);
  } else if (message.document) {
    parts.push(`[document: ${message.document.file_name ?? message.document.file_id}]`);
  } else if (message.caption) {
    parts.push(`[media] ${message.caption}`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
};

// ── Server ──

export const initTelegramMcpServer = (client: TelegramClient): McpLocalServer => {

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
        const body = describeMessage(message);
        if (body === null) continue;
        const sender = from.username ? `@${from.username}` : from.first_name;
        const edited = update.edited_message ? ' (edited)' : '';
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
  const server = initTelegramMcpServer(client);
  const notifier = startTelegramNotifier(server, client, config, log);
  return {
    server,
    client,
    stop: () => notifier.stop(),
  };
};
