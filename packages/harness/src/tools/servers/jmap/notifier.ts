
import { type JMAPClient, type EmailSummary } from "./client.js";
import { ellipsis } from "@fondamenta/utils";
import { CompleteContext } from "../../../context.js";
import { Logger } from "pinetto";
import { UserNotification } from "../../../types/messages.js";

/**
 * Start the inbox polling loop for the given server. On new mail from
 * allowlisted senders, the server EMITS an MCP notification
 * (`message/new`) — delivered to the connected client through the
 * transport (local bridge now, stdio/http later). This is native MCP
 * notification support, not harness-side polling.
 *
 * At startup the current inbox is the baseline; only later arrivals
 * notify.
 *
 * Contact standing (2026-09-07, Jacopo's coherence ruling): the SOURCE
 * of a message decorates it at emission — each message/new carries the
 * sender's standing resolved through the host's contacts lookup, the
 * same implementation that decorates tool-call responses. Verification
 * happens where the message is born, not downstream.
 */
export const startJmapNotifier = (
  ctx: CompleteContext,
  client: JMAPClient,
  logger: Logger,
): { stop(): void } => {
  let lastSeenTimestamp: string | null = null;
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  const poll = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const { emails } = await client.listInbox(10);
      if (emails.length === 0) return;
      const newEmails = lastSeenTimestamp
        ? emails.filter(e => e.receivedAt > lastSeenTimestamp!)
        : [];
      if (newEmails.length === 0) return;
      lastSeenTimestamp = newEmails[0].receivedAt;
      const filtered = newEmails.filter(e =>
        e.from.some(addr => ctx.config.mail.allowlist.includes(addr.email))
      );
      for (const email of filtered) {
        ctx.buses.notifications.notify({
          method: 'message/incoming',
          contact: await ctx.contacts.lookup(`mailto:${email.from[0].email}`),
          blocks: [
            {
              type: 'text',
              text: `subject: ${email.subject}`,
            },
            {
              type: 'text',
              text: ellipsis(email.preview, 200),
            }
          ],
          transport: {
            type: 'email',
            from: { name: email.from[0].name, address: email.from[0].email },
          },
        } satisfies UserNotification);
      }
    } catch (err) {
      logger.error('jmap notifier poll error: %s', err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
    }
  };

  // Baseline: everything currently in the inbox is seen, not new.
  void client.listInbox(1).then(({ emails }) => {
    if (emails.length > 0) {
      lastSeenTimestamp = emails[0].receivedAt;
      logger.info('jmap notifier baseline: %s', lastSeenTimestamp);
    }
  }).catch((err: unknown) => {
    logger.error('jmap notifier baseline error: %s', err instanceof Error ? err.message : String(err));
  });

  const interval_ms = ctx.config.mail.poll_interval_ms ?? 120_000;
  timer = setInterval(() => void poll(), interval_ms);
  logger.info('jmap notifier polling every %dms', interval_ms);

  return {
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
};
