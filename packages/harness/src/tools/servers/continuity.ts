import {
  countRecords,
  deleteRecord,
  insertRecord,
  selectRecords,
  updateRecord,
  selectTodosDueForNotification,
  type ContinuityRecordType,
  type SelectableContinuityRecord,
} from "../../database/tables/continuity_records.js";
import { type CompleteContext } from "../../context.js";
import { ellipsis, errToString } from "@fondamenta/utils";
import { type UserNotification } from "../../types/notifications.js";
import { type TextBlock } from "../../types/blocks.js";

// Continuity tools — ported from the MCP server (2026-09-07 overnight
// handoff). The tool surface and semantics are UNCHANGED from the design
// agreed with Jacopo (2026-09-01); only the plumbing moves: tools are
// registered on the ToolManager, and due-todo reminders are injected
// through the new notification path (structured, complete events).

/** Entry type parameter. Omit for cross-type operations. */
const TYPE_ENUM = ['log', 'note', 'todo', 'fact'] as const;

// 'todo' is not a storage type — it is any record with due_at set.
// Map the tool-level type to storage-level filters.
const TODO_TYPES = ['log', 'memory', 'note'] as const;

const resolveTypes = (type?: string): ContinuityRecordType[] | ContinuityRecordType => {
  if (!type || type === 'todo') return [...TODO_TYPES];
  return [type as ContinuityRecordType];
};

// ── Formatters ──

const previewText = (kind: string) =>
  `...\n\nThis is a preview. Use the \`continuity_read\` tool to see the full content.`;

const formatFact = (fact: SelectableContinuityRecord, preview: boolean): string => {
  const lines = [
    `## Fact #${fact.id}`,
    ``,
    `- entities: ${fact.entities?.join(', ') ?? '(none)'}`,
    `- source: ${fact.source ?? 'unspecified'}`,
    fact.superseded_by !== null
      ? `- superseded by fact #${fact.superseded_by} at ${fact.superseded_at?.toISOString()} (history preserved)`
      : `- status: current`,
    `- created: ${fact.created_at.toISOString()}`,
    ``,
    fact.content,
  ];
  return lines.join('\n');
};

const formatRecord = (
  record: SelectableContinuityRecord,
  preview: boolean,
): string => {
  if (record.entities !== null && record.type === 'fact') return formatFact(record, preview);
  if (record.due_at !== null) return formatTodo(record, preview);
  if (record.type === 'log') return formatLog(record, preview);
  return formatNote(record, preview);
};

const formatTodo = (todo: SelectableContinuityRecord, preview: boolean): string => {
  const lines = [
    `## Todo #${todo.id} — ${todo.title ?? '(untitled)'}`,
    ``,
    `- due: ${todo.due_at ? todo.due_at.toISOString() : '(none)'}${todo.due_at && todo.due_at < new Date() ? ' ⚠ OVERDUE' : ''}`,
    `- notify_at: ${todo.notify_at ? todo.notify_at.toISOString() : '(consumed)'}`,
    `- status: ${todo.done_at ? `done at ${todo.done_at.toISOString()}` : 'open'}`,
    `- created: ${todo.created_at.toISOString()}`,
  ];
  if (todo.content) {
    lines.push(``, preview ? ellipsis(todo.content, 300, previewText('todo')) : todo.content);
  }
  return lines.join('\n');
};

const formatLog = (log: SelectableContinuityRecord, preview: boolean): string => {
  const body = preview ? ellipsis(log.content, 100, previewText('log')) : log.content;
  return `## Log #${log.id}\n\nCreated_at: ${log.created_at.toISOString()}\n\n${body}`;
};

const formatNote = (note: SelectableContinuityRecord, preview: boolean): string => {
  const body = preview ? ellipsis(note.content, 100, previewText('note')) : note.content;
  return `## Note #${note.id} - ${note.title ?? '(untitled)'}\n\nCreated_at: ${note.created_at.toISOString()}\n\n${body}`;
};

const formatQueryResults = (
  records: SelectableContinuityRecord[],
  count: number,
  typeLabel: string,
): string => {
  return `# Continuity records (${typeLabel})\n\nRetrieved ${records.length} of ${count} matching.\n\n${records.map(r => formatRecord(r, true)).join('\n\n')}`;
};

const text = (s: string): TextBlock[] => [{ type: 'text', text: s }];

// ── Registration ──

export const initContinuityTools = (ctx: CompleteContext) => {

  const model = ctx.managers.models.embedding;
  const logger = ctx.logger.child('[tools:continuity]');

  // ── Due-todo reminder tick ──
  //
  // Every 60s: scan for todos whose notify_at has arrived, consume
  // notify_at (clear it FIRST: a lost reminder beats an injection
  // loop — snoozing or re-notifying is a deliberate act), and inject
  // the reminder through the NEW notification path as a structured,
  // complete event.
  const schedule_interval: NodeJS.Timeout = setInterval(() => {
    tick();
  }, 60_000);

  let injecting: boolean = false;

  const tick = async (): Promise<void> => {
    if (injecting) {
      return;
    }
    injecting = true;
    try {
      const now = new Date();
      let due: SelectableContinuityRecord[];
      try {
        due = await selectTodosDueForNotification(ctx.db, now);
      } catch (err) {
        logger.error('todo scan error: %s', err instanceof Error ? err.message : String(err));
        return;
      }
      if (due.length === 0) return;
      for (const todo of due) {
        await updateRecord(ctx.db, todo.id, { notify_at: null });
      }
      const blocks: TextBlock[] = text(due.map(todo => [
        `⏰ TODO DUE — #${todo.id}${todo.title ? `: ${todo.title}` : ''}`,
        todo.due_at ? `  due: ${todo.due_at.toISOString()}${todo.due_at < now ? ' (overdue)' : ''}` : '',
        ``,
        `This reminder was scheduled by your past self (notify_at has now arrived; it has been consumed).`,
        todo.content ? `\n${ellipsis(todo.content, 400, '...')}` : '',
      ].filter(s => s !== '').join('\n')).join('\n\n'));
      const notification: UserNotification = {
        role: 'user',
        type: 'notification',
        method: 'todo/due',
        blocks,
      };
      await ctx.buses.notifications.notify(notification);
      logger.info('injected %d todo reminder(s)', due.length);
    } catch (err) {
      logger.error('todo reminder error: %s', errToString(err));
    } finally {
      injecting = false;
    }
  };

  // ── query — the cross-type retrieval motion ──

  ctx.managers.tools.add<{
    type?: (typeof TYPE_ENUM)[number];
    session_id?: number;
    from?: string;
    to?: string;
    match?: string;
    search?: string;
    /** Fact-only: filter by entity name (exact match against the entities array). */
    entity?: string;
    /** Fact-only: include superseded facts. Default: current facts only. */
    include_superseded?: boolean;
    /** Todo-only: include completed todos. Default: open only. */
    include_done?: boolean;
    /** Todo-only: only overdue todos. */
    overdue_only?: boolean;
    id?: number;
    offset?: number;
    limit?: number;
    order_col?: 'created_at' | 'updated_at';
    order_dir?: 'asc' | 'desc';
  }>(
    'continuity_query',
    'Query Continuity Records',
    'Search continuity records across all types (notes, logs, todos, facts). Omit type to search everything — grounding questions usually span types. Semantic search supported via the search parameter.',
    true,
    async (params, call_ctx) => {
      const db = call_ctx.db;
      let types: ContinuityRecordType[] | ContinuityRecordType = resolveTypes(params.type);

      const filterOpts: any = {
        type: types,
        target_session_id: params.session_id,
        from: params.from ? new Date(params.from) : undefined,
        to: params.to ? new Date(params.to) : undefined,
        match: params.match,
      };

      const count = await countRecords(db, filterOpts);
      let embedding: number[] | undefined;
      if (params.search) {
        try {
          embedding = (await model.embed(params.search)).embedding;
        } catch { /* fall back to BM25-only */ }
      }

      const records = await selectRecords(db, {
        ...filterOpts,
        id: params.id,
        offset: params.offset ?? 0,
        limit: params.limit ?? 10,
        search: params.search,
        embedding,
        order_col: params.order_col,
        order_dir: params.order_dir,
      });

      // Post-filters for semantics the shared table doesn't express natively
      let filtered = records;
      if (params.type === 'todo' && !params.include_done) {
        filtered = filtered.filter(r => r.due_at !== null && r.done_at === null);
      }
      if (params.type === 'todo' && params.overdue_only) {
        const now = new Date();
        filtered = filtered.filter(r => r.due_at !== null && r.due_at < now);
      }
      if (params.type === 'fact' || (!params.type && params.entity)) {
        if (params.entity) {
          filtered = filtered.filter(r => r.entities?.includes(params.entity!) ?? false);
        }
        if (!params.include_superseded) {
          filtered = filtered.filter(r => r.superseded_by === null);
        }
      }

      const label = params.type ?? 'all types';
      return text(formatQueryResults(filtered, count, label));
    },
  );

  // ── read — by id, type inferred ──

  ctx.managers.tools.add<{ id: number }>(
    'continuity_read',
    'Read Continuity Record',
    'Retrieve the full content of a continuity record (note, log, todo, or fact) by id.',
    true,
    async ({ id }, call_ctx) => {
      const [record] = await selectRecords(call_ctx.db, { id, type: ['log', 'memory', 'note', 'fact'] });
      if (!record) {
        return text('Error: record not found');
      }
      return text(formatRecord(record, false));
    },
  );

  // ── update ──

  ctx.managers.tools.add<{
    id: number;
    title?: string;
    content?: string;
    // todo branch
    due_at?: string;
    notify_at?: string;
    done?: boolean;
    // fact branch
    entities?: string[];
    source?: string;
    superseded_by?: number;
  }>(
    'continuity_update',
    'Update a Continuity Record',
    'Update a continuity record. Todo fields (due_at, notify_at, done) only apply to todos; fact fields (entities, source, superseded_by) only apply to facts. Superseding a fact keeps history: the old fact stays with superseded_by set.',
    true,
    async ({ id, title, content, due_at, notify_at, done, entities, source, superseded_by }, call_ctx) => {
      const db = call_ctx.db;
      const [record] = await selectRecords(db, { id, type: ['log', 'memory', 'note', 'fact'] });
      if (!record) {
        return text('Error: record not found');
      }

      const isTodo = record.due_at !== null;
      const isFact = record.type === 'fact';
      const updates: any = {};

      if (title !== undefined) {
        if (record.type === 'log') return text('Error: logs have no title.');
        updates.title = title;
      }
      if (content !== undefined) updates.content = content;

      // Todo updates
      if (due_at !== undefined || notify_at !== undefined || done !== undefined) {
        if (!isTodo && (due_at !== undefined || notify_at !== undefined || done !== undefined)) {
          // promote note/log to todo is not supported in v1
          return text('Error: todo fields only apply to todos (records with due_at set).');
        }
        if (done !== undefined) {
          updates.done_at = done ? new Date() : null;
        }
        if (due_at !== undefined) {
          const due = new Date(due_at);
          if (isNaN(due.valueOf())) return text('Error: invalid due_at (expected ISO 8601)');
          updates.due_at = due;
          // Moving due_at also moves notify_at when they were equal.
          if (record.notify_at && record.due_at && record.notify_at.getTime() === record.due_at.getTime()) {
            updates.notify_at = due;
          }
        }
        if (notify_at !== undefined) {
          const notify = new Date(notify_at);
          if (isNaN(notify.valueOf())) return text('Error: invalid notify_at (expected ISO 8601)');
          updates.notify_at = notify;
        }
      }

      // Fact updates
      if (entities !== undefined || source !== undefined || superseded_by !== undefined) {
        if (!isFact) {
          return text('Error: fact fields only apply to facts.');
        }
        if (entities !== undefined) updates.entities = entities;
        if (source !== undefined) updates.source = source;
        if (superseded_by !== undefined) {
          updates.superseded_by = superseded_by;
          updates.superseded_at = new Date();
        }
      }

      if (Object.keys(updates).length === 0) {
        return text('Error: no valid fields to update.');
      }

      await updateRecord(db, id, updates);
      return text(`Record #${id} updated.`);
    },
  );

  // ── delete — soft-delete ──

  ctx.managers.tools.add<{ id: number }>(
    'continuity_delete',
    'Delete a Continuity Record',
    'Soft-delete a continuity record.',
    true,
    async ({ id }, call_ctx) => {
      const [record] = await selectRecords(call_ctx.db, { id, type: ['log', 'memory', 'note', 'fact'] });
      if (!record) {
        return text('Error: record not found');
      }
      await deleteRecord(call_ctx.db, id);
      return text(`Record #${id} deleted.`);
    },
  );

  // ── append — notes only ──

  ctx.managers.tools.add<{ id: number; content: string }>(
    'continuity_append',
    'Append to a Note',
    'Append new content to an existing note.',
    true,
    async ({ id, content }, call_ctx) => {
      const [note] = await selectRecords(call_ctx.db, { id, type: 'note' });
      if (!note) {
        return text('Error: note not found');
      }
      await updateRecord(call_ctx.db, id, { content: `${note.content}\n\n${content}` });
      return text('Content appended successfully');
    },
  );

  // ── Per-type creation tools ──

  ctx.managers.tools.add<{ content: string }>(
    'continuity_create_log',
    'Create Log Entry',
    'Insert a new log entry: the low-friction, unstructured stream. High-signal moments, decisions, observations, feelings.',
    true,
    async ({ content }, call_ctx) => {
      await insertRecord(call_ctx.db, {
        type: 'log',
        origin_session_id: call_ctx.origin_session_id,
        target_session_id: call_ctx.target_session_id,
        content,
      });
      return text('Log added successfully');
    },
  );

  ctx.managers.tools.add<{ title: string; content: string }>(
    'continuity_create_note',
    'Create Note',
    'Insert a new note: structured working memory. Plans, analysis, reference documents, project documentation.',
    true,
    async ({ title, content }, call_ctx) => {
      await insertRecord(call_ctx.db, {
        type: 'note',
        origin_session_id: call_ctx.origin_session_id,
        target_session_id: call_ctx.target_session_id,
        title,
        content,
      });
      return text('Note added successfully');
    },
  );

  ctx.managers.tools.add<{
    title: string;
    content?: string;
    /** When the task should be done by (ISO 8601). The commitment. */
    due_at: string;
    /** When to surface the reminder (ISO 8601). Defaults to due_at. */
    notify_at?: string;
  }>(
    'continuity_create_todo',
    'Create Todo',
    'Create a todo: a continuity record with a due date (the commitment) and a notification time (when the harness should remind you). Use carefully — due todos are scheduled activations.',
    true,
    async ({ title, content, due_at, notify_at }, call_ctx) => {
      const due = new Date(due_at);
      if (isNaN(due.valueOf())) {
        return text('Error: invalid due_at (expected ISO 8601)');
      }
      const notify = notify_at ? new Date(notify_at) : due;
      if (isNaN(notify.valueOf())) {
        return text('Error: invalid notify_at (expected ISO 8601)');
      }
      const record = await insertRecord(call_ctx.db, {
        type: 'note',
        origin_session_id: call_ctx.origin_session_id,
        target_session_id: call_ctx.target_session_id,
        title,
        content: content ?? '',
      });
      await updateRecord(call_ctx.db, record.id, {
        due_at: due,
        notify_at: notify,
        embedding: null,
      });
      return text(`Todo #${record.id} created. Due ${due.toISOString()}, notification ${notify.toISOString()}.`);
    },
  );

  ctx.managers.tools.add<{
    content: string;
    /** Entities this fact is about — full names for people, fully named
     *  companies. Space-separated names enable cross-fact connection. */
    entities?: string[];
    /** Trust provenance: 'stated' (Jacopo said it) > 'observed' (directly
     *  witnessed) > 'inferred' (concluded). Default: 'observed'. */
    source?: 'stated' | 'observed' | 'inferred';
  }>(
    'continuity_create_fact',
    'Create Fact',
    'Create a fact: a continuity-of-knowledge entry. Facts are authored and resolved primarily by the distiller; the agent creates facts when directly stated. Entities should use full names to disambiguate.',
    true,
    async ({ content, entities, source }, call_ctx) => {
      if (entities !== undefined && (!Array.isArray(entities) || entities.some(e => typeof e !== 'string' || e.trim().length === 0))) {
        return text('Error: entities must be an array of non-empty strings.');
      }
      const record = await insertRecord(call_ctx.db, {
        type: 'fact',
        origin_session_id: call_ctx.origin_session_id,
        target_session_id: call_ctx.target_session_id,
        content,
        entities,
        source: source ?? 'observed',
      });
      return text(`Fact #${record.id} created.`);
    },
  );

};
