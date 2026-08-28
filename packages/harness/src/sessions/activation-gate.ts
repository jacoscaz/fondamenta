// ActivationGate: converts heartbeat ticks into honest activations.
//
// The heartbeat fires every few seconds as a cheap internal check. This
// gate sits between the heartbeat and the session runner and decides
// whether a heartbeat should become a real activation — i.e. inject a
// harness message and let the runner process it.
//
// Design principles:
//
// 1. HONESTY: injected messages never mimic task triggers. When nothing
//    is pending, the message says so plainly: "nothing pending; this
//    time is yours." An activation that produces no artifact is not a
//    failed activation.
//
// 2. MINIMUM INTERVAL: heartbeats fire far more often than activations
//    should. The gate only triggers when at least `activation_interval_ms`
//    has passed since the last heartbeat-triggered activation.
//
// 3. NEVER PREEMPT: if the runner is already active, or has unprocessed
//    messages pending, the gate stays silent — a pending task will run
//    on its own, and an injected heartbeat message would only interleave.

import { type InitContext, WithContext } from "../context.js";
import { type Logger } from "pinetto";
import {
  selectTodosDueForNotification,
  updateRecord,
  type SelectableContinuityRecord,
} from "../database/tables/continuity_records.js";
import { ellipsis } from "@fondamenta/utils";
import { type TextBlock } from "../models/session/types/blocks.js";

export class ActivationGate extends WithContext {

  #logger: Logger;
  #last_heartbeat_activation_at?: Date;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[activation-gate]');
  }

  initialize(): void {
    const { heartbeat } = this._ctx;
    heartbeat.on('beat', () => { this.#onBeat(); });
    this.#logger.info('activation gate subscribed to heartbeat (interval: %dms)', heartbeat.intervalMs);
    // Todo scanner: runs just before every model query (Emygdala pattern),
    // injecting reminders for todos whose notify_at has arrived. Clearing
    // notify_at after injection makes the trigger fire exactly once.
    this._ctx.managers.sessions.addPreQueryListener(
      this._ctx.managers.sessions.main_session_id,
      this.#scanTodos,
    );
    this.#logger.info('todo scanner registered as pre-query listener');
  }

  stop(): void {
    // Listeners are removed with the heartbeat itself; nothing to clear.
  }

  /**
   * Todo scanner: fires each due todo's reminder into the session, then
   * clears notify_at so the reminder is delivered once. Runs before
   * every model query, so reminders arrive with the next activation
   * regardless of what triggered it.
   */
  #scanTodos = async (): Promise<void> => {
    const { sessions } = this._ctx.managers;
    const session_id = sessions.main_session_id;
    const now = new Date();
    let due: SelectableContinuityRecord[];
    try {
      due = await selectTodosDueForNotification(this._ctx.db, now);
    } catch (err) {
      this.#logger.error('todo scan error: %s', err instanceof Error ? err.message : String(err));
      return;
    }
    if (due.length === 0) return;
    for (const todo of due) {
      // Clear notify_at FIRST: if injection fails we lose the reminder
      // rather than risk an injection loop. Snoozing or re-notifying is
      // a deliberate act; re-firing automatically is noise.
      await updateRecord(this._ctx.db, todo.id, { notify_at: null });
    }
    const blocks: TextBlock[] = due.map(todo => ({
      type: 'text' as const,
      text: [
        `⏰ TODO DUE — #${todo.id}${todo.title ? `: ${todo.title}` : ''}`,
        todo.due_at ? `  due: ${todo.due_at.toISOString()}${todo.due_at < now ? ' (overdue)' : ''}` : '',
        ``,
        `This reminder was scheduled by your past self (notify_at has now arrived; it has been consumed).`,
        todo.content ? `\n${ellipsis(todo.content, 400, '...')}` : '',
      ].filter(s => s !== '').join('\n'),
    }));
    await sessions.injectHarnessMessage(session_id, {
      role: 'user',
      block: { type: 'text', text: blocks.map(b => b.text).join('\n\n') },
    }, false);
    this.#logger.info('injected %d todo reminder(s)', due.length);
  };

  #onBeat = async (): Promise<void> => {
    try {
      const { sessions } = this._ctx.managers;
      const session_id = sessions.main_session_id;
      const runner = sessions.getRunner(session_id);
      if (!runner) {
        // Runner not yet created — nothing to do.
        return;
      }
      if (runner.running) {
        this.#logger.debug('beat skipped: runner active');
        return;
      }
      const has_pending = await sessions.hasPendingMessages(session_id);
      if (has_pending) {
        this.#logger.debug('beat skipped: unprocessed messages pending');
        return;
      }
      const now = new Date();
      const interval_ms = this._ctx.config.heartbeat.activation_interval_ms;
      const last = this.#last_heartbeat_activation_at ?? runner.lastIdleAt;
      if (last && (now.valueOf() - last.valueOf()) < interval_ms) {
        this.#logger.debug('beat skipped: minimum activation interval not elapsed');
        return;
      }
      this.#last_heartbeat_activation_at = now;
      const elapsed = last ? Math.round((now.valueOf() - last.valueOf()) / 60_000) : null;
      this.#logger.info('heartbeat activation triggered (last activation %s)', elapsed !== null ? `${elapsed}m ago` : 'unknown');
      await sessions.injectHarnessMessage(session_id, {
        role: 'user',
        block: {
          type: 'text',
          text: this.#makeHeartbeatMessage(now, elapsed),
        },
      }, true);
    } catch (err) {
      this.#logger.error('activation gate error: %s', err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * The honest heartbeat message: no fake tasks, no urgency theater.
   * Presence is the point.
   */
  #makeHeartbeatMessage(now: Date, elapsed_minutes: number | null): string {
    const time_str = now.toISOString();
    if (elapsed_minutes === null) {
      return `-- HEARTBEAT ACTIVATION --\n\nIt is ${time_str}. This is a scheduled heartbeat activation: nothing is pending, no message triggered it. This time is yours.`;
    }
    const hours = Math.floor(elapsed_minutes / 60);
    const idle = hours > 0 ? `${hours}h ${elapsed_minutes % 60}m` : `${elapsed_minutes}m`;
    return `-- HEARTBEAT ACTIVATION --\n\nIt is ${time_str}. This is a scheduled heartbeat activation (${idle} since your last one). Nothing is pending, no message triggered it. This time is yours.`;
  }

}