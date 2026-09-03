
import { type McpLocalServer } from "@fondamenta/mcp-local";
import { type JMAPClient, type EmailSummary } from "./client.js";
import { type JmapConfig } from "./config.js";
import { type JMAPNotification } from "./types/notifications.js";

/**
 * Start the inbox polling loop for the given server. On new mail from
 * allowlisted senders, the server EMITS an MCP notification
 * (`mail/arrived`) — delivered to the connected client through the
 * transport (local bridge now, stdio/http later). This is native MCP
 * notification support, not harness-side polling.
 *
 * At startup the current inbox is the baseline; only later arrivals
 * notify.
 */
export const startJmapNotifier = (
  server: McpLocalServer<{}>,
  client: JMAPClient,
  config: JmapConfig,
  log: (msg: string, ...args: any[]) => void = () => {},
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
        e.from.some(addr => config.allowlist.includes(addr.email))
      );
      if (filtered.length > 0) {
        const text = filtered.map(formatArrival).join('\n\n');
        server.notify({ method: 'jmap/new_email', params: { text } });
      }
    } catch (err) {
      log('jmap notifier poll error: %s', err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
    }
  };

  // Baseline: everything currently in the inbox is seen, not new.
  void client.listInbox(1).then(({ emails }) => {
    if (emails.length > 0) {
      lastSeenTimestamp = emails[0].receivedAt;
      log('jmap notifier baseline: %s', lastSeenTimestamp);
    }
  }).catch((err: unknown) => {
    log('jmap notifier baseline error: %s', err instanceof Error ? err.message : String(err));
  });

  const interval_ms = config.poll_interval_ms ?? 120_000;
  timer = setInterval(() => void poll(), interval_ms);
  log('jmap notifier polling every %dms', interval_ms);

  return {
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
};

const formatArrival = (email: EmailSummary): string => {
  const from = email.from.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', ');
  const preview = email.preview.slice(0, 200);
  const ellipsis = email.preview.length > 200 ? '...' : '';
  return `📬 New email from ${from}\n  Subject: ${email.subject || '(no subject)'}\n  Preview: ${preview}${ellipsis}\n\nUse the mail tools to read the full email.`;
};
