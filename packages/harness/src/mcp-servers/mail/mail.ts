
import { McpLocalServer } from "@fondamenta/mcp-local";
import { type Config } from "../../config/config.js";
import { type HarnessMcpToolCallContext } from "../../types.js";
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

export const initMailMcpServer = (config: Config): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp = new McpLocalServer<HarnessMcpToolCallContext>();

  const client = new JMAPClient({
    token: config.jmap.api_token,
    apiUrl: config.jmap.api_url,
    sessionUrl: config.jmap.session_url,
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
