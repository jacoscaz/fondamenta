
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

        // Voice notes: download, then transcribe AT EMISSION via
        // ctx.speech — the notifier emits a COMPLETE event. The
        // notification bus is no longer a cross-tool pipeline: there is
        // no downstream transcription subscriber to order against, and
        // the silent-dead-chain failure class dies with it. Transcription
        // failures are loud: the block carries the error string, never a
        // transcription-less voice block dressed as complete.
        if (message.voice) {
          try {
            const path = await ctx.files.tempPath(new Date(Date.now() + 3_600_000), 'ogg');
            await client.downloadFile(message.voice.file_id, path);
            let transcription: string | undefined;
            try {
              const result = await ctx.speech.transcribe(path);
              transcription = result.text;
              log('voice note transcribed: %s (%ss)', path, message.voice.duration);
            } catch (err) {
              // Fail loud: an explicit error string, never a silent drop.
              transcription = `[transcription failed: ${err instanceof Error ? err.message : String(err)}]`;
              log('voice note transcription failed: %s', err instanceof Error ? err.message : String(err));
            }
            content.push({
              type: 'voice',
              path,
              mimeType: 'audio/ogg',
              duration: message.voice.duration,
              transcription,
            });
          } catch (err) {
            log('voice note download failed: %s', err instanceof Error ? err.message : String(err));
          }
        }

        if (message.photo) {
          // Telegram sends photos as an array of sizes; the last entry is
          // the largest. Download to an ImageBlock with REAL bytes and
          // detected mime type — a silent data:'' placeholder would
          // render as a broken image in the agent's context (fail loud,
          // never fail fake-complete).
          const largest = message.photo[message.photo.length - 1];
          try {
            const path = await ctx.files.tempPath(new Date(Date.now() + 3_600_000), 'img');
            await client.downloadFile(largest.file_id, path);
            const { readFile } = await import('node:fs/promises');
            const data = (await readFile(path)).toString('base64');
            // Telegram photos are JPEG; detect from magic bytes rather
            // than trust, and skip loudly if unrecognized.
            const head = Buffer.from(data.slice(0, 8), 'base64');
            let mimeType = '';
            if (head[0] === 0xff && head[1] === 0xd8) mimeType = 'image/jpeg';
            else if (head[0] === 0x89 && head[1] === 0x50) mimeType = 'image/png';
            else if (head[0] === 0x47 && head[1] === 0x49) mimeType = 'image/gif';
            else if (head.slice(0, 4).toString() === 'RIFF' && head.slice(8, 12).toString() === 'WEBP') mimeType = 'image/webp';
            if (!mimeType) {
              log('photo skipped: unrecognized image format (file saved at %s)', path);
            } else {
              content.push({
                type: 'image',
                mimeType,
                data,
                caption: message.caption,
              });
            }
          } catch (err) {
            log('photo download failed: %s', err instanceof Error ? err.message : String(err));
          }
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
