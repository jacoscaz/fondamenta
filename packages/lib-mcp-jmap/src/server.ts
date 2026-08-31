
import { McpLocalServer } from "@fondamenta/mcp-local";
import { type JmapConfig } from "./config.js";
import { JMAPClient, type EmailSummary, type EmailDetail, type Mailbox, type EmailAddress } from "./jmap-client.js";

// ── Formatters ──

const formatAddress = (addr: EmailAddress): string =>
  addr.name ? `${addr.name} <${addr.email}>` : addr.email;

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';
};

const formatEmailSummary = (email: EmailSummary): string => {
  const from = email.from.map(formatAddress).join(', ');
  const date = formatDate(email.receivedAt);
  const preview = email.preview.slice(0, 120);
  const ellipsis = email.preview.length > 120 ? '...' : '';
  return `[${email.id}] ${date}\n  From: ${from}\n  Subject: ${email.subject || '(no subject)'}\n  ${preview}${ellipsis}`;
};

const formatEmailDetail = (email: EmailDetail): string => {
  const from = email.from.map(formatAddress).join(', ');
  const to = email.to.map(formatAddress).join(', ');
  const date = formatDate(email.receivedAt);

  let body = '(no body content)';
  if (email.bodyValues && Object.keys(email.bodyValues).length > 0) {
    const partId = email.bodyStructure.partId;
    const bodyPart = email.bodyValues[partId];
    body = bodyPart ? bodyPart.value : (Object.values(email.bodyValues)[0]?.value ?? '(empty body)');
  }

  return `Subject: ${email.subject || '(no subject)'}\nFrom: ${from}\nTo: ${to}\nDate: ${date}\n\n${body}`;
};

const formatMailbox = (mb: Mailbox): string => {
  const role = mb.role ? ` (${mb.role})` : '';
  const unread = mb.unreadThreads > 0 ? ` [${mb.unreadThreads} unread]` : '';
  return `${mb.id}  ${mb.name}${role}  ${mb.totalThreads} threads${unread}`;
};

// ── Param interfaces ──

interface InboxParams {
  limit?: number;
}

interface ReadEmailParams {
  id: string;
}

interface SendEmailParams {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}

// ── Server initialization ──

/**
 * Build the JMAP mail MCP server: the four mail tools plus (via
 * startNotifier) the mail/arrived notification emission on new
 * allowlisted email.
 */
export const initJmapMcpServer = (config: JmapConfig): McpLocalServer => {

  const mcp = new McpLocalServer();

  const client = new JMAPClient({
    token: config.api_token,
    apiUrl: config.api_url,
    sessionUrl: config.session_url,
  });

  mcp.addTool<InboxParams>(
    'inbox',
    'List Inbox Emails',
    'List previews of recent emails in the inbox. Returns email ID, date, from, subject, and preview text.',
    async ({ limit }) => {
      const { total, emails } = await client.listInbox(limit ?? 10);
      const header = `Inbox — ${total} total threads, showing ${emails.length}\n`;
      const body = emails.map(formatEmailSummary).join('\n\n');
      return [{ type: 'text', text: `${header}\n${body}` }];
    },
  );

  mcp.addTool<ReadEmailParams>(
    'read',
    'Read Email',
    'Retrieve the full content of a specific email by ID.',
    async ({ id }) => {
      const email = await client.readEmail(id);
      return [{ type: 'text', text: formatEmailDetail(email) }];
    },
  );

  mcp.addTool<SendEmailParams>(
    'send',
    'Send Email',
    'Send an email to one or more recipients. Body is plain text.',
    async ({ to, cc, subject, body }) => {
      const result = await client.sendEmail({ to, cc, subject, body });
      return [{ type: 'text', text: `Sent — Email ID: ${result.emailId}, Submission ID: ${result.submissionId}, Send time: ${result.sendAt}` }];
    },
  );

  mcp.addTool<{}>(
    'mailboxes',
    'List Mailboxes',
    'List all mailboxes with thread counts and unread indicators.',
    async ({}) => {
      const mailboxes = await client.listMailboxes();
      const body = mailboxes.map(formatMailbox).join('\n');
      return [{ type: 'text', text: body }];
    },
  );

  return mcp;
};

/**
 * Convenience wrapper: build the server, wire its notifier, return both.
 * The harness (or any embedder) calls this once and passes `server` to
 * its MCP manager; `stop()` tears the polling down on shutdown.
 */
export const startMailServer = (
  config: JmapConfig,
  log: (msg: string, ...args: any[]) => void = () => {},
): { server: McpLocalServer, client: JMAPClient, stop(): void } => {
  const server = initJmapMcpServer(config);
  const client = new JMAPClient({
    token: config.api_token,
    apiUrl: config.api_url,
    sessionUrl: config.session_url,
  });
  const notifier = startJmapNotifier(server, client, config, log);
  return {
    server,
    client,
    stop: () => notifier.stop(),
  };
};

// ── Notification emission ──

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
  server: McpLocalServer,
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
        server.notify('mail/arrived', { text });
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
