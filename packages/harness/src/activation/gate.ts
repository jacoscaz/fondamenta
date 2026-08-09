import { type Logger } from "pinetto";
import { type InitContext, WithContext } from "../context.js";
import { type EmailSummary } from "../mcp-servers/mail/jmap-client.js";

/**
 * ActivationGate inspects notification sources on a timer and decides
 * whether to trigger a session activation based on gating policy.
 *
 * This separates *detection* (MailNotifier polls inbox, queues emails)
 * from *decision* (this gate applies filtering, rate limiting, batching).
 *
 * Gating policy:
 * - Allowlist senders → activate immediately (subject to rate limit)
 * - Non-allowlist senders → batch, activate after batch_window
 * - Rate limiting: max N activations per hour
 * - Minimum gap between activations
 *
 * When the gate decides to activate, it consumes all pending emails
 * from MailNotifier (which Emygdala will then inject as notifications)
 * and inserts a blank trigger message to wake the runner.
 */
export class ActivationGate extends WithContext {

  #logger: Logger;
  #timer: NodeJS.Timeout | null = null;
  #running = false;

  /** Timestamps of recent activations (for rate limiting) */
  #recentActivations: number[] = [];

  /** When the batch timer started (oldest non-allowlist email arrival) */
  #batchStartedAt: number | null = null;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[activation-gate]');
  }

  /**
   * Start the gate's polling timer.
   */
  initialize(): void {
    const interval = this._ctx.config.activation.poll_interval_ms;
    this.#timer = setInterval(() => this.#check(), interval);
    this.#logger.info('activation gate polling every %dms', interval);
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async #check(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      const max_per_hour = this._ctx.config.activation.max_per_hour;
      const min_gap_ms = this._ctx.config.activation.min_gap_ms;
      const batch_window_ms = this._ctx.config.activation.batch_window_ms;

      const mailNotifier = this._ctx.mailNotifier;
      const terminalNotifier = this._ctx.terminalNotifier;

      // Check both notification sources
      const hasMail = mailNotifier.hasPendingEmails();
      const hasTerminalIdle = terminalNotifier.hasNotifications();

      if (!hasMail && !hasTerminalIdle) return;

      const now = Date.now();

      // Clean up old activation timestamps (older than 1 hour)
      this.#recentActivations = this.#recentActivations.filter(t => now - t < 3_600_000);

      // Check rate limit
      const rate_limited = this.#recentActivations.length >= max_per_hour;

      // Check minimum gap
      const last_activation = this.#recentActivations[this.#recentActivations.length - 1];
      const min_gap_satisfied = !last_activation || (now - last_activation) >= min_gap_ms;

      // Terminal idle events trigger activation like allowlisted mail
      if (hasTerminalIdle && !hasMail) {
        if (!rate_limited && min_gap_satisfied) {
          this.#logger.info('terminal idle — triggering activation');
          await this.#triggerActivation();
        } else {
          this.#logger.info('terminal idle but rate limited (%d/%d per hour, gap %dms)',
            this.#recentActivations.length, max_per_hour,
            last_activation ? now - last_activation : 0);
        }
        return;
      }

      // We have mail — proceed with mail-based gating
      const emails = mailNotifier.peekPendingEmails();
      const allowlist = this._ctx.config.activation.mail_allowlist ?? [];

      // Check if any email is from an allowlisted sender
      const has_allowlisted = emails.some(e =>
        e.from.some(addr => allowlist.includes(addr.email))
      );

      if (has_allowlisted) {
        // Allowlisted sender — activate immediately (if not rate limited)
        if (!rate_limited && min_gap_satisfied) {
          this.#logger.info('allowlisted email — triggering activation');
          await this.#triggerActivation();
        } else {
          this.#logger.info('allowlisted email but rate limited (%d/%d per hour, gap %dms)',
            this.#recentActivations.length, max_per_hour,
            last_activation ? now - last_activation : 0);
        }
        return;
      }

      // Non-allowlisted email — start or continue batch timer
      if (this.#batchStartedAt === null) {
        this.#batchStartedAt = now;
        this.#logger.info('non-allowlisted email — batch timer started (%dms window)', batch_window_ms);
      }

      // Check if batch window has elapsed
      const batch_elapsed = now - this.#batchStartedAt;
      if (batch_elapsed >= batch_window_ms) {
        if (!rate_limited && min_gap_satisfied) {
          this.#logger.info('batch window elapsed (%dms) — triggering activation', batch_elapsed);
          await this.#triggerActivation();
        } else {
          this.#logger.info('batch window elapsed but rate limited');
        }
      }
    } catch (err) {
      this.#logger.error('gate check error: %s', err instanceof Error ? err.message : String(err));
    } finally {
      this.#running = false;
    }
  }

  /**
   * Trigger activation of the main session runner.
   * Consumes pending emails (Emygdala will inject them as notifications)
   * and inserts a blank user message to wake the activation loop.
   */
  async #triggerActivation(): Promise<void> {
    const now = Date.now();
    this.#recentActivations.push(now);
    this.#batchStartedAt = null;

    // Find the main session
    const sessions = await this._ctx.db
      .selectFrom('sessions')
      .where('initiator', '!=', 'distiller')
      .orderBy('created_at', 'desc')
      .limit(1)
      .select('id')
      .executeTakeFirst();

    if (!sessions) {
      this.#logger.warn('no main session found — cannot trigger activation');
      return;
    }

    const runner = this._ctx.managers.runners.ensure(sessions.id);

    // Insert a blank user message to trigger the activation loop.
    // The actual notification content will be injected by Emygdala
    // when it consumes the pending emails.
    await this._ctx.db
      .insertInto('messages')
      .values({
        session_id: sessions.id,
        data: { role: 'user', blocks: [{ type: 'text', text: '' }] },
        created_at: new Date(),
        processed_at: null,
        role: 'user',
        raw: null,
      })
      .execute();

    runner.run();
    this.#logger.info('activation triggered for session %d', sessions.id);
  }
}
