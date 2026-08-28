// Todos MCP server.
//
// Todos are continuity records — NOT a separate table. A todo is any
// continuity record with `due_at` set. Semantics:
//
// - create: set due_at (the commitment) and notify_at (when the scanner
//   should surface it). notify_at defaults to due_at.
// - complete: set done_at. The record stays — completion is history,
//   not deletion.
// - snooze: move notify_at forward. The due date stays as the commitment.
// - reopen: clear done_at.
//
// The todo scanner (see sessions/activation-gate.ts) watches for
// notify_at arriving and injects reminders into the session. notify_at
// is cleared after firing so each todo triggers exactly once.
//
// Hygiene is the agent's responsibility: the list is the agent's own
// calendar; stale todos left open are the agent's clutter, not the
// harness's problem.

import { ellipsis } from "@fondamenta/utils";
import {
  countRecords,
  deleteRecord,
  insertRecord,
  selectRecords,
  selectTodosDueForNotification,
  updateRecord,
  type SelectableContinuityRecord,
} from "../database/tables/continuity_records.js";
import { type HarnessMcpToolCallContext } from "../types.js";
import { type CompleteContext } from "../context.js";
import { McpLocalServer } from "@fondamenta/mcp-local";

// ── Param interfaces ──

interface CountTodosParams {
  /** Include completed todos (done_at set). Default: open only. */
  include_done?: boolean;
  /** Only overdue todos (due_at < now). */
  overdue_only?: boolean;
}

interface ListTodosParams extends CountTodosParams {
  id?: number;
  offset?: number;
  limit?: number;
  match?: string;
}

interface CreateTodoParams {
  title: string;
  /** Optional longer description stored as the record content. */
  content?: string;
  /** When the task should be done by (ISO 8601). The commitment. */
  due_at: string;
  /** When to surface the reminder (ISO 8601). Defaults to due_at. */
  notify_at?: string;
}

interface CompleteTodoParams { id: number; }
interface ReopenTodoParams { id: number; }
interface DeleteTodoParams { id: number; }

interface SnoozeTodoParams {
  id: number;
  /** New notification time (ISO 8601). The due date is unchanged. */
  notify_at: string;
}

interface ModifyTodoParams {
  id: number;
  title?: string;
  content?: string;
  /** Move the commitment itself (ISO 8601). Also moves notify_at if it
   *  was equal to the old due_at. */
  due_at?: string;
}

// ── Formatters ──

const formatTodo = (todo: SelectableContinuityRecord, now: Date): string => {
  const lines = [
    `## Todo #${todo.id} — ${todo.title ?? '(untitled)'}`,
    ``,
    `- due: ${todo.due_at ? todo.due_at.toISOString() : '(none)'}${todo.due_at && todo.due_at < now ? ' ⚠ OVERDUE' : ''}`,
    `- notify_at: ${todo.notify_at ? todo.notify_at.toISOString() : '(consumed)'}`,
    `- status: ${todo.done_at ? `done at ${todo.done_at.toISOString()}` : 'open'}`,
    `- created: ${todo.created_at.toISOString()}`,
  ];
  if (todo.content) {
    lines.push(``, ellipsis(todo.content, 300, '...\n(use notes read for full content)'));
  }
  return lines.join('\n');
};

const formatTodos = (todos: SelectableContinuityRecord[], count: number, now: Date): string => {
  return `# Todos\n\nRetrieved ${todos.length} of ${count} matching todos.\n\n${todos.map(t => formatTodo(t, now)).join('\n\n')}`;
};

// ── Registration ──

export const initTodosMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp = new McpLocalServer<HarnessMcpToolCallContext>();

  mcp.addTool<CountTodosParams>(
    'count',
    'Count Todos',
    'Count todo records. Open (not done) by default.',
    async ({ include_done, overdue_only }, { db }) => {
      const now = new Date();
      const todos = await selectRecords(db, { type: ['log', 'memory', 'note'] });
      // Filtering in SQL would be nicer but selectRecords doesn't expose
      // the todo columns as filters yet; todo volume is small, filter here.
      const filtered = todos.filter(t =>
        (t.due_at !== null) &&
        (include_done || t.done_at === null) &&
        (!overdue_only || (t.due_at !== null && t.due_at < now))
      );
      return [{ type: 'text', text: `Found ${filtered.length} todos.` }];
    },
  );

  mcp.addTool<ListTodosParams>(
    'list',
    'List Todos',
    'List todos with due dates and status. Open (not done) by default, ordered by due date.',
    async ({ include_done, overdue_only, id, offset, limit, match }, { db }) => {
      const now = new Date();
      const todos = await selectRecords(db, {
        type: ['log', 'memory', 'note'],
        id,
        match,
      });
      const filtered = todos
        .filter(t =>
          (t.due_at !== null) &&
          (include_done || t.done_at === null) &&
          (!overdue_only || (t.due_at !== null && t.due_at < now))
        )
        .sort((a, b) => (a.due_at?.valueOf() ?? 0) - (b.due_at?.valueOf() ?? 0));
      const paged = filtered.slice(offset ?? 0, (offset ?? 0) + (limit ?? 20));
      return [{ type: 'text', text: formatTodos(paged, filtered.length, now) }];
    },
  );

  mcp.addTool<CreateTodoParams>(
    'create',
    'Create Todo',
    'Create a todo: a continuity record with a due date (the commitment) and a notification time (when the harness should remind you). Use carefully — due todos are scheduled activations.',
    async ({ title, content, due_at, notify_at }, { origin_session_id, target_session_id, db }) => {
      const due = new Date(due_at);
      if (isNaN(due.valueOf())) {
        return [{ type: 'text', text: 'Error: invalid due_at (expected ISO 8601)' }];
      }
      const notify = notify_at ? new Date(notify_at) : due;
      if (isNaN(notify.valueOf())) {
        return [{ type: 'text', text: 'Error: invalid notify_at (expected ISO 8601)' }];
      }
      const record = await insertRecord(db, {
        type: 'note',
        origin_session_id,
        target_session_id,
        title,
        content: content ?? '',
        // due_at etc. are set through updateRecord since insertRecord
        // does not expose todo columns.
      });
      await updateRecord(db, record.id, {
        due_at: due,
        notify_at: notify,
        embedding: null, // let the embedder pick it up
      });
      return [{ type: 'text', text: `Todo #${record.id} created. Due ${due.toISOString()}, notification ${notify.toISOString()}.` }];
    },
  );

  mcp.addTool<CompleteTodoParams>(
    'complete',
    'Complete Todo',
    'Mark a todo as done by setting done_at. The record is kept — completion is history, not deletion.',
    async ({ id }, { db }) => {
      const [todo] = await selectRecords(db, { id, type: ['log', 'memory', 'note'] });
      if (!todo || todo.due_at === null) {
        return [{ type: 'text', text: `Error: todo #${id} not found` }];
      }
      if (todo.done_at !== null) {
        return [{ type: 'text', text: `Todo #${id} was already completed at ${todo.done_at.toISOString()}.` }];
      }
      await updateRecord(db, id, { done_at: new Date() });
      return [{ type: 'text', text: `Todo #${id} completed.` }];
    },
  );

  mcp.addTool<ReopenTodoParams>(
    'reopen',
    'Reopen Todo',
    'Reopen a completed todo by clearing done_at.',
    async ({ id }, { db }) => {
      const [todo] = await selectRecords(db, { id, type: ['log', 'memory', 'note'] });
      if (!todo || todo.due_at === null) {
        return [{ type: 'text', text: `Error: todo #${id} not found` }];
      }
      if (todo.done_at === null) {
        return [{ type: 'text', text: `Todo #${id} is already open.` }];
      }
      await updateRecord(db, id, { done_at: null });
      return [{ type: 'text', text: `Todo #${id} reopened.` }];
    },
  );

  mcp.addTool<SnoozeTodoParams>(
    'snooze',
    'Snooze Todo',
    'Move a todo\'s notification time forward. The due date stays as the commitment — snoozing defers the reminder, not the responsibility.',
    async ({ id, notify_at }, { db }) => {
      const notify = new Date(notify_at);
      if (isNaN(notify.valueOf())) {
        return [{ type: 'text', text: 'Error: invalid notify_at (expected ISO 8601)' }];
      }
      const [todo] = await selectRecords(db, { id, type: ['log', 'memory', 'note'] });
      if (!todo || todo.due_at === null) {
        return [{ type: 'text', text: `Error: todo #${id} not found` }];
      }
      await updateRecord(db, id, { notify_at: notify });
      return [{ type: 'text', text: `Todo #${id} snoozed until ${notify.toISOString()}. Due remains ${todo.due_at.toISOString()}.` }];
    },
  );

  mcp.addTool<DeleteTodoParams>(
    'delete',
    'Delete Todo',
    'Soft-delete a todo record.',
    async ({ id }, { db }) => {
      const [todo] = await selectRecords(db, { id, type: ['log', 'memory', 'note'] });
      if (!todo || todo.due_at === null) {
        return [{ type: 'text', text: `Error: todo #${id} not found` }];
      }
      await deleteRecord(db, id);
      return [{ type: 'text', text: `Todo #${id} deleted.` }];
    },
  );

  mcp.addTool<ModifyTodoParams>(
    'modify',
    'Modify Todo',
    'Change a todo\'s title, content, or due date. Moving due_at also moves notify_at when they were equal.',
    async ({ id, title, content, due_at }, { db }) => {
      const [todo] = await selectRecords(db, { id, type: ['log', 'memory', 'note'] });
      if (!todo || todo.due_at === null) {
        return [{ type: 'text', text: `Error: todo #${id} not found` }];
      }
      const updates: Parameters<typeof updateRecord>[2] = {};
      if (title !== undefined) updates.title = title;
      if (content !== undefined) {
        updates.content = content;
        updates.embedding = null; // re-embed
      }
      if (due_at !== undefined) {
        const due = new Date(due_at);
        if (isNaN(due.valueOf())) {
          return [{ type: 'text', text: 'Error: invalid due_at (expected ISO 8601)' }];
        }
        updates.due_at = due;
        if (todo.notify_at && todo.due_at && todo.notify_at.valueOf() === todo.due_at.valueOf()) {
          updates.notify_at = due; // keep notify synced when it tracked the due date
        }
      }
      await updateRecord(db, id, updates);
      return [{ type: 'text', text: `Todo #${id} modified.` }];
    },
  );

  return mcp;
};