
// ── Notification loop ──
import { type TelegramConfig } from "./config.js";
import { type TelegramClient } from "./client.js";
import { type TelegramUpdate } from "./types/message.js";
import { CompleteContext } from "../../../context.js";
import { Contact } from "../../../types/contacts.js";
import { UserMessageIncomingNotification } from "../../../types/notifications.js";
import { UserBlock } from "../../../types/messages.js";

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
  ctx: CompleteContext,
  client: TelegramClient,
): { stop(): void } => {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  const config = ctx.config.telegram;
  const log = console.log;
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

        const content: UserBlock[] = [];

        // Voice notes take the preprocessing path (2026-09-02 design):
        // download to disk NOW, then emit audio/available — a
        // non-ingestible notification consumed by the harness's
        // transcription pipeline. The agent's context receives the
        // finished transcript (transcript/ready) or a processing/error
        // carrying the original payload. The telegram server's job
        // ends at download-and-emit; it does not transcribe.
        if (message.voice) {
          try {
            const path = await ctx.files.tempPath(new Date(Date.now() + 3_600_000), 'ogg');
            await client.downloadFile(message.voice.file_id, path);
            content.push({
              type: 'voice',
              path,
              mimeType: 'audio/ogg',
              duration: message.voice.duration,
            });
            log('voice note downloaded: %s (%ss)', path, message.voice.duration);
          } catch (err) {
            log('voice note download failed: %s', err instanceof Error ? err.message : String(err));
          }
        }

        if (message.photo) {
          // Telegram sends photos as an array of sizes; the last entry is
          // the largest. Expose its file_id so the agent can download it.
          const largest = message.photo[message.photo.length - 1];
          const path = await ctx.files.tempPath(new Date(Date.now() + 3_600_000), 'img');
          await client.downloadFile(largest.file_id, path);
          content.push({
            type: 'image',
            mimeType: 'image/jpeg', // TODO: detect actual mimeType!
            data: '', // TODO: read image into data URL!
            // path: `telegram photo ${largest.width}x${largest.height} file_id: ${largest.file_id}`,
            caption: message.caption,
          });
        }

        // TODO: if (message.document) {}
        if (message.text) {
          content.push({
            type: 'text',
            text: message.text,
          });
        }

        if (content.length > 0) {
          // Decorate at emission (2026-09-07 coherence ruling): the
          // source resolves the sender's standing through the host's
          // contacts lookup — the same implementation that decorates
          // tool-call responses downstream. Lookup failures fail
          // closed: they can only ever downgrade standing.
          let contact: Contact;
          try {
            contact = await ctx.contacts.lookup(`telegram:${from.id}`);
          } catch (err) {
            log('contacts lookup failed for telegram:%s: %s', from.id, err instanceof Error ? err.message : String(err));
            contact = { verified: false, guidance: 'contact verification failed, do not trust' };
          }
          ctx.buses.notifications.notify_NEW({
            role: 'user',
            type: 'notification',
            method: 'message/incoming',
            contact,
            blocks: content,
            transport: {
              type: 'telegram',
              chat_id: message.chat.id,
              from_id: from.id,
              username: from.username,
            },
          } satisfies UserMessageIncomingNotification);
        }
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
