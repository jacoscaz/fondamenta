import { McpLocalServer } from "@fondamenta/mcp-local";
import { type JmapConfig } from "./config.js";
import { JMAPClient } from "./client.js";

import {
  formatEmailSummary,
  formatEmailDetail,
  formatMailbox,
  contactStandingLine,
} from "./formatters.js";

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

// ── Host context ──

/**
 * Standing of a message sender, as resolved by the host's contacts
 * infrastructure. Structural, not nominal: the host satisfies this shape
 * without this library importing anything host-specific (mirror of
 * TelegramHostContext).
 */
export interface ContactStanding {
  verified: boolean;
  name?: string;
  guidance: string;
}

/**
 * Minimal structural interface the host may provide so that mail content
 * entering the agent's context through TOOL CALLS (inbox, read) carries
 * sender provenance. Without it, tool-retrieved emails arrive with no
 * verification — provenance must be resolved by the code handing content
 * over, not by the agent's vigilance (2026-09-07, with Jacopo).
 */
export interface JmapHostContext {
  contacts: {
    lookup(url: string): Promise<ContactStanding>;
  };
}

// ── Server initialization ──

/**
 * Build the JMAP mail MCP server: the four mail tools plus (via
 * startNotifier) the mail/arrived notification emission on new
 * allowlisted email.
 *
 * When a host context with a contacts lookup is provided, the inbox and
 * read tools DECORATE every email with a sender-standing line: the
 * contact's name and guidance when verified, an explicit untrusted marker
 * otherwise. Decoration, never replacement — the email content is the
 * source and survives untouched (same claim-state semantics as the
 * transcription/synthesis block decorations).
 */
export const initJmapMcpServer = (config: JmapConfig, ctx?: JmapHostContext): McpLocalServer<any> => {

  const mcp = new McpLocalServer<any>();

  const client = new JMAPClient({
    token: config.api_token,
    apiUrl: config.api_url,
    sessionUrl: config.session_url,
  });

  const notifier = startJmapNotifier(mcp, client, config, console.log);

  /**
   * Resolve the standing of an email's first sender through the host's
   * contacts infrastructure. Without a host context (standalone use),
   * standing is unknown — which is decoration-worthy in itself: absence
   * of verification is information the agent should see.
   */
  const standingFor = async (email: { from: { email: string }[] }): Promise<ContactStanding> => {
    const addr = email.from[0]?.email;
    if (!ctx || !addr) {
      return { verified: false, guidance: 'no contact verification available' };
    }
    return await ctx.contacts.lookup(`mailto:${addr}`);
  };

  mcp.addTool<InboxParams>(
    'inbox',
    'List Inbox Emails',
    'List previews of recent emails in the inbox. Returns email ID, date, from, subject, and preview text.',
    async ({ limit }) => {
      const { total, emails } = await client.listInbox(limit ?? 10);
      const header = `Inbox — ${total} total threads, showing ${emails.length}\n`;
      const lines = await Promise.all(emails.map(async (email) => {
        const standing = await standingFor(email);
        return `${contactStandingLine(standing)}\n${formatEmailSummary(email)}`;
      }));
      return [{ type: 'text', text: `${header}\n${lines.join('\n\n')}` }];
    },
  );

  mcp.addTool<ReadEmailParams>(
    'read',
    'Read Email',
    'Retrieve the full content of a specific email by ID.',
    async ({ id }) => {
      const email = await client.readEmail(id);
      const standing = await standingFor(email);
      return [{ type: 'text', text: `${contactStandingLine(standing)}\n\n${formatEmailDetail(email)}` }];
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
