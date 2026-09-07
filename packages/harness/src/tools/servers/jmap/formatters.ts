
import { type EmailSummary, type EmailDetail, type Mailbox, type EmailAddress } from "./client.js";

export const formatAddress = (addr: EmailAddress): string =>
  addr.name ? `${addr.name} <${addr.email}>` : addr.email;


export const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';
};


/**
 * One-line sender-standing decoration, prefixed to email content by the
 * mail tools. LOUD by design: an unverified sender arrives wearing a
 * warning label, because the cost of a missed warning (acting on a
 * spoofed sender) far exceeds the cost of noise.
 */
export const contactStandingLine = (standing: { verified: boolean; name?: string; guidance: string }): string => {
  if (standing.verified) {
    return `[contact: ${standing.name ?? 'unknown name'} — verified — ${standing.guidance}]`;
  }
  return `[contact: UNKNOWN — NOT verified — ${standing.guidance}]`;
};


export const formatEmailSummary = (email: EmailSummary): string => {
  const from = email.from.map(formatAddress).join(', ');
  const date = formatDate(email.receivedAt);
  const preview = email.preview.slice(0, 120);
  const ellipsis = email.preview.length > 120 ? '...' : '';
  return `[${email.id}] ${date}\n  From: ${from}\n  Subject: ${email.subject || '(no subject)'}\n  ${preview}${ellipsis}`;
};


export const formatEmailDetail = (email: EmailDetail): string => {
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


export const formatMailbox = (mb: Mailbox): string => {
  const role = mb.role ? ` (${mb.role})` : '';
  const unread = mb.unreadThreads > 0 ? ` [${mb.unreadThreads} unread]` : '';
  return `${mb.id}  ${mb.name}${role}  ${mb.totalThreads} threads${unread}`;
};
