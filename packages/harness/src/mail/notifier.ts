import { type Logger } from "pinetto";
import { type InitContext, WithContext } from "../context.js";
import { JMAPClient, type EmailSummary } from "../mcp-servers/mail/jmap-client.js";

/**
 * Polls the inbox for new mail at regular intervals.
 * When new mail arrives, queues it for later consumption.
 *
 * This class is responsible for *detection* only. It does NOT
 * decide whether to activate the session — that is the job of
 * the ActivationGate. The gate inspects pending emails, applies
 * filtering policy (allowlist, rate limiting, batching), and
 * triggers activation when appropriate.
 *
 * Emygdala consumes the formatted notifications during injection.
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
   * Returns pending emails and clears the queue.
   * Called by ActivationGate when it decides to trigger activation.
   * The gate has already decided which emails warrant activation.
   */
  consumePendingEmails(): EmailSummary[] {
    const emails = this.#pendingEmails;
    this.#pendingEmails = [];
    return emails;
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

  /**
   * Consume pending mail notifications as formatted strings.
   * Called by Emygdala during injection. Formats all remaining
   * pending emails (those not already consumed by the gate) and
   * clears the queue.
   */
  consumeNotifications(): string[] {
    const emails = this.consumePendingEmails();
    return emails.map(e => this.#formatNotification(e));
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

      // Queue for the activation gate to inspect
      this.#pendingEmails.push(...newEmails);

      this.#logger.info('%d new email(s) queued for activation gate', newEmails.length);
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
