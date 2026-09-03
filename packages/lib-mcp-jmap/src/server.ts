
import { McpLocalServer } from "@fondamenta/mcp-local";
import { type JmapConfig } from "./config.js";
import { JMAPClient } from "./client.js";

import {
  formatEmailSummary,
  formatEmailDetail,
  formatMailbox,
} from './formatters.js';

import { type JMAPNotification } from "./types/notifications.js";
import { startJmapNotifier } from "./notifier.js";

// ── Formatters ──



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
export const initJmapMcpServer = (config: JmapConfig): McpLocalServer<any> => {

  const mcp = new McpLocalServer<any>();

  const client = new JMAPClient({
    token: config.api_token,
    apiUrl: config.api_url,
    sessionUrl: config.session_url,
  });

  const notifier = startJmapNotifier(mcp, client, config, console.log);

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
