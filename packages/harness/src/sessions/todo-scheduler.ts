import { type InitContext, WithContext } from "../context.js";
import { type Logger } from "pinetto";
import {
  selectTodosDueForNotification,
  updateRecord,
  type SelectableContinuityRecord,
} from "../database/tables/continuity_records.js";
import { ellipsis, errToString } from "@fondamenta/utils";

/**
 * Todo reminder scheduler: a standalone interval that queries the
 * continuity_records table for open todos whose notify_at has arrived
 * and injects their reminders into the main session with immediate
 * processing.
 *
 * Deliberately independent of heartbeat and runner: cadence is its own
 * simple NodeJS interval. Clearing notify_at after injection makes the
 * trigger fire exactly once.
 */
export class TodoNotifier extends WithContext {

  #logger: Logger;
  #timer: NodeJS.Timeout | null = null;
  #injecting = false;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[todo-scheduler]');
  }

  initialize(intervalMs: number = 60_000): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => { void this.#tick(); }, intervalMs);
    this.#logger.info('todo reminder scheduler every %dms', intervalMs);
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  #tick = async (): Promise<void> => {
    if (this.#injecting) return;
    this.#injecting = true;
    try {
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
      const text = due.map(todo => [
        `⏰ TODO DUE — #${todo.id}${todo.title ? `: ${todo.title}` : ''}`,
        todo.due_at ? `  due: ${todo.due_at.toISOString()}${todo.due_at < now ? ' (overdue)' : ''}` : '',
        ``,
        `This reminder was scheduled by your past self (notify_at has now arrived; it has been consumed).`,
        todo.content ? `\n${ellipsis(todo.content, 400, '...')}` : '',
      ].filter(s => s !== '').join('\n')).join('\n\n');
      await sessions.injectHarnessMessage(session_id, {
        role: 'user',
        block: { type: 'text', text },
      }, true);
      this.#logger.info('injected %d todo reminder(s)', due.length);
    } catch (err) {
      this.#logger.error('todo reminder error: %s', errToString(err));
    } finally {
      this.#injecting = false;
    }
  };

}
