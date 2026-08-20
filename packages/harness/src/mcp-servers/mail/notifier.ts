
import { type Logger } from "pinetto";
import { type InitContext, WithContext } from "../../context.js";
import { JMAPClient, type EmailSummary } from "./jmap-client.js";

/**
 * Polls the inbox for new mail at regular intervals.
 * When new mail arrives, queues it for later injection.
 *
 * Implements InjectionProvider — the runner drains queued emails
 * during activation and injects them as synthetic messages.
 * Allowlist filtering is applied in getInjectedMessages().
 *
 * At startup, establishes a baseline by polling once — everything
 * currently in the inbox is considered "seen". Only emails received
 * after startup are queued.
 */
export class MailNotifier extends WithContext {

  #logger: Logger;
  #client: JMAPClient;
  #timer: NodeJS.Timeout | null = null;
  #running = false;

  /** Highest receivedAt timestamp we've seen. New mail is anything after this. */
  #lastSeenTimestamp: string | null = null;

  /** Pending emails waiting to be consumed. */
  #pendingEmails: EmailSummary[] = [];

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[mail-notifier]');
    this.#client = new JMAPClient({
      apiUrl: ctx.config.mail.api_url,
      sessionUrl: ctx.config.mail.session_url,
      token: ctx.config.mail.api_token,
    });
  }

  /**
   * Start polling. The first poll establishes the baseline
   * (marks current inbox as seen). Subsequent polls detect new mail.
   */
  async initialize(pollIntervalMs: number = 120_000): Promise<void> {
    // Establish baseline — don't notify about existing mail
    try {
      const { emails } = await this.#client.listInbox(1);
      if (emails.length > 0) {
        this.#lastSeenTimestamp = emails[0].receivedAt;
        this.#logger.info('baseline established — last seen: %s', this.#lastSeenTimestamp);
      }
    } catch (err) {
      this.#logger.error('failed to establish baseline: %s', err instanceof Error ? err.message : String(err));
    }

    this.#timer = setInterval(() => this.#poll(), pollIntervalMs);
    this.#logger.info('polling every %dms', pollIntervalMs);
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * Returns pending emails without clearing the queue.
   * Called by ActivationGate to inspect and apply filtering.
   */
  peekPendingEmails(): EmailSummary[] {
    return this.#pendingEmails;
  }

  /**
   * Check if there are pending emails.
   */
  hasPendingEmails(): boolean {
    return this.#pendingEmails.length > 0;
  }

  async #poll(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      const { emails } = await this.#client.listInbox(10);

      if (emails.length === 0) return;

      // Filter for emails newer than our last-seen timestamp
      const newEmails = this.#lastSeenTimestamp
        ? emails.filter(e => e.receivedAt > this.#lastSeenTimestamp!)
        : [];

      if (newEmails.length === 0) return;

      // Update baseline to newest email
      this.#lastSeenTimestamp = newEmails[0].receivedAt;

      const allowlist = this._ctx.config.heartbeat?.mail_allowlist ?? [];
      const filtered = newEmails.filter(e =>
        e.from.some(addr => allowlist.includes(addr.email))
      );
      if (filtered.length > 0) {
        await this._ctx.managers.sessions.addHarnessMessage(this._ctx.managers.sessions.main_session_id, {
          role: 'user',
          block: { type: 'text', text: filtered.map(e => (this.#formatNotification(e))).join('\n\n') },
        });
      }
      // this.#logger.info('%d new email(s) queued for activation gate', newEmails.length);
    } catch (err) {
      this.#logger.error('poll error: %s', err instanceof Error ? err.message : String(err));
    } finally {
      this.#running = false;
    }
  }

  #formatNotification(email: EmailSummary): string {
    const from = email.from.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', ');
    const preview = email.preview.slice(0, 200);
    const ellipsis = email.preview.length > 200 ? '...' : '';
    return `📬 New email from ${from}\n  Subject: ${email.subject || '(no subject)'}\n  Preview: ${preview}${ellipsis}\n\nUse the mail tools to read the full email.`;
  }

}
