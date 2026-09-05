
// ── Notification loop ──
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type McpLocalServer } from "@fondamenta/mcp-local";
import { type TelegramConfig } from "./config.js";
import { type TelegramClient } from "./client.js";
import { type TelegramUpdate } from "./types/message.js";
import { type McpNewMessageNotification } from "@fondamenta/mcp-core";
import { describeMessage } from "./helpers.js";

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
  server: McpLocalServer<{}>,
  client: TelegramClient,
  config: TelegramConfig,
  log: (msg: string, ...args: any[]) => void = () => { },
  mediaDir: string,
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
            server.notify({
              method: 'message/new',
              params: {
                content: {
                  type: 'voice',
                  path,
                },
                transport: {
                  type: 'telegram',
                  chat_id: message.chat.id,
                  from_id: from.id,
                }
              }
            } satisfies McpNewMessageNotification);
            log('voice note downloaded: %s (%ss)', path, message.voice.duration);
          } catch (err) {
            log('voice note download failed: %s', err instanceof Error ? err.message : String(err));
          }
          continue;
        }

        const body = describeMessage(message);
        if (body === null) continue;
        server.notify({
          method: 'message/new',
          params: {
            content: {
              type: 'text',
              text: body,
            },
            transport: {
              type: 'telegram',
              chat_id: message.chat.id,
              from_id: from.id,
              username: from.username,
            },
          },
        } satisfies McpNewMessageNotification);
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
