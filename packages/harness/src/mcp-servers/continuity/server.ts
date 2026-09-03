// Continuity MCP server.
//
// UNIFIED server for all continuity record types — notes, logs, todos,
// facts. The distinction between types is foundational in the semantics
// (creation, behaviors) but not in the plumbing (storage, retrieval):
// cross-type query is the default retrieval motion, because grounding
// questions ("what do I know about X") span types.
//
// Tool surface (design agreed with Jacopo, 2026-09-01):
// - continuity_query    — cross-type search (text match + optional type
//                         filter + semantic search). The star: one call
//                         answers "what do I know about X".
// - continuity_read     — by id, type inferred from the record.
// - continuity_update   — id + fields, validated against the record's type.
// - continuity_delete   — soft-delete by id.
// - continuity_append   — append content (notes only).
// - continuity_create_log     — per-type creation: bare stream entry.
// - continuity_create_note    — per-type creation: titled working memory.
// - continuity_create_todo    — per-type creation: due_at/notify_at.
// - continuity_create_fact    — per-type creation: entities/source.
//
// Type semantics preserved from the per-type servers this replaces:
// - log:    bare stream, no title.
// - note:   title + appendable content.
// - todo:   any record with due_at set; complete/snooze/reopen/modify
//           operate through continuity_update's todo branch.
// - fact:   continuity of knowledge. entities (space-separated name
//           strings, e.g. "Jacopo Scazzariello", "Example Project"), source
//           trust gradient ('stated' > 'observed' > 'inferred'),
//           superseded_by/superseded_at keep history — superseded facts
//           stay in the store. Authored and resolved primarily by the
//           distiller; the agent queries and detects conflicts.
//
// Anchors are a separate table with their own semantics and keep their
// own server (they are identity, not continuity entries).

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
import { type HarnessMcpToolCallContext } from "../../types/tools.js";
import { type CompleteContext } from "../../context.js";
import { McpLocalServer } from "@fondamenta/mcp-local";
  import { ellipsis, errToString } from "@fondamenta/utils";

// ── Shared params ──

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

// ── Registration ──

export const initContinuityMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp = new McpLocalServer<HarnessMcpToolCallContext>();
  const model = ctx.managers.models.embedding;
  const logger = ctx.logger.child('[mcp-continuity]');

  const schedule_interval: NodeJS.Timeout = setInterval(() => {
    tick();
  }, 60_000);

  mcp.destroy = () => {
    clearInterval(schedule_interval);
  };

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
        // Clear notify_at FIRST: if injection fails we lose the reminder
        // rather than risk an injection loop. Snoozing or re-notifying is
        // a deliberate act; re-firing automatically is noise.
        await updateRecord(ctx.db, todo.id, { notify_at: null });
      }
      const text = due.map(todo => [
        `⏰ TODO DUE — #${todo.id}${todo.title ? `: ${todo.title}` : ''}`,
        todo.due_at ? `  due: ${todo.due_at.toISOString()}${todo.due_at < now ? ' (overdue)' : ''}` : '',
        ``,
        `This reminder was scheduled by your past self (notify_at has now arrived; it has been consumed).`,
        todo.content ? `\n${ellipsis(todo.content, 400, '...')}` : '',
      ].filter(s => s !== '').join('\n')).join('\n\n');
      // Emit onto the MCP notification bus instead of injecting
      // directly (Phase II step 3 dogfood).
      ctx.buses.notifications.notify({
        method: 'todo/due',
        params: { text },
      });
      logger.info('emitted %d todo reminder(s) to notification bus', due.length);
    } catch (err) {
      logger.error('todo reminder error: %s', errToString(err));
    } finally {
      injecting = false;
    }
  };

  // ── continuity_query — the cross-type retrieval motion ──

  mcp.addTool<{
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
    'query',
    'Query Continuity Records',
    'Search continuity records across all types (notes, logs, todos, facts). Omit type to search everything — grounding questions usually span types. Semantic search supported via the search parameter.',
    async (params, { db }) => {
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
      return [{ type: 'text', text: formatQueryResults(filtered, count, label) }];
    },
  );

  // ── continuity_read — by id, type inferred ──

  mcp.addTool<{ id: number }>(
    'read',
    'Read a Continuity Record',
    'Retrieve the full content of a continuity record (note, log, todo, or fact) by id.',
    async ({ id }, { db }) => {
      const [record] = await selectRecords(db, {
        id,
        type: ['log', 'memory', 'note', 'fact'],
      });
      if (!record) {
        return [{ type: 'text', text: 'Error: record not found' }];
      }
      return [{ type: 'text', text: formatRecord(record, false) }];
    },
  );

  // ── continuity_update — validated against the record's type ──

  mcp.addTool<{
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
    'update',
    'Update a Continuity Record',
    'Update a continuity record. Todo fields (due_at, notify_at, done) only apply to todos; fact fields (entities, source, superseded_by) only apply to facts. Superseding a fact keeps history: the old fact stays with superseded_by set.',
    async ({ id, title, content, due_at, notify_at, done, entities, source, superseded_by }, { db }) => {
      const [record] = await selectRecords(db, { id, type: ['log', 'memory', 'note', 'fact'] });
      if (!record) {
        return [{ type: 'text', text: 'Error: record not found' }];
      }

      const isTodo = record.due_at !== null;
      const isFact = record.type === 'fact';
      const updates: any = {};

      if (title !== undefined) {
        if (record.type === 'log') return [{ type: 'text', text: 'Error: logs have no title.' }];
        updates.title = title;
      }
      if (content !== undefined) updates.content = content;

      // Todo updates
      if (due_at !== undefined || notify_at !== undefined || done !== undefined) {
        if (!isTodo && (due_at !== undefined || notify_at !== undefined || done !== undefined)) {
          // promote note/log to todo is not supported in v1
          return [{ type: 'text', text: 'Error: todo fields only apply to todos (records with due_at set).' }];
        }
        if (done !== undefined) {
          updates.done_at = done ? new Date() : null;
        }
        if (due_at !== undefined) {
          const due = new Date(due_at);
          if (isNaN(due.valueOf())) return [{ type: 'text', text: 'Error: invalid due_at (expected ISO 8601)' }];
          updates.due_at = due;
          // Moving due_at also moves notify_at when they were equal.
          if (record.notify_at && record.due_at && record.notify_at.getTime() === record.due_at.getTime()) {
            updates.notify_at = due;
          }
        }
        if (notify_at !== undefined) {
          const notify = new Date(notify_at);
          if (isNaN(notify.valueOf())) return [{ type: 'text', text: 'Error: invalid notify_at (expected ISO 8601)' }];
          updates.notify_at = notify;
        }
      }

      // Fact updates
      if (entities !== undefined || source !== undefined || superseded_by !== undefined) {
        if (!isFact) {
          return [{ type: 'text', text: 'Error: fact fields only apply to facts.' }];
        }
        if (entities !== undefined) updates.entities = entities;
        if (source !== undefined) updates.source = source;
        if (superseded_by !== undefined) {
          updates.superseded_by = superseded_by;
          updates.superseded_at = new Date();
        }
      }

      if (Object.keys(updates).length === 0) {
        return [{ type: 'text', text: 'Error: no valid fields to update.' }];
      }

      await updateRecord(db, id, updates);
      return [{ type: 'text', text: `Record #${id} updated.` }];
    },
  );

  // ── continuity_delete — soft-delete ──

  mcp.addTool<{ id: number }>(
    'delete',
    'Delete a Continuity Record',
    'Soft-delete a continuity record.',
    async ({ id }, { db }) => {
      const [record] = await selectRecords(db, { id, type: ['log', 'memory', 'note', 'fact'] });
      if (!record) {
        return [{ type: 'text', text: 'Error: record not found' }];
      }
      await deleteRecord(db, id);
      return [{ type: 'text', text: `Record #${id} deleted.` }];
    },
  );

  // ── continuity_append — notes only ──

  mcp.addTool<{ id: number; content: string }>(
    'append',
    'Append to a Note',
    'Append new content to an existing note.',
    async ({ id, content }, { db }) => {
      const [note] = await selectRecords(db, { id, type: 'note' });
      if (!note) {
        return [{ type: 'text', text: 'Error: note not found' }];
      }
      await updateRecord(db, id, { content: `${note.content}\n\n${content}` });
      return [{ type: 'text', text: 'Content appended successfully' }];
    },
  );

  // ── Per-type creation tools ──

  mcp.addTool<{ content: string }>(
    'create_log',
    'Create Log Entry',
    'Insert a new log entry: the low-friction, unstructured stream. High-signal moments, decisions, observations, feelings.',
    async ({ content }, { origin_session_id, target_session_id, db }) => {
      await insertRecord(db, {
        type: 'log',
        origin_session_id,
        target_session_id,
        content,
      });
      return [{ type: 'text', text: 'Log added successfully' }];
    },
  );

  mcp.addTool<{ title: string; content: string }>(
    'create_note',
    'Create Note',
    'Insert a new note: structured working memory. Plans, analysis, reference documents, project documentation.',
    async ({ title, content }, { origin_session_id, target_session_id, db }) => {
      await insertRecord(db, {
        type: 'note',
        origin_session_id,
        target_session_id,
        title,
        content,
      });
      return [{ type: 'text', text: 'Note added successfully' }];
    },
  );

  mcp.addTool<{
    title: string;
    content?: string;
    /** When the task should be done by (ISO 8601). The commitment. */
    due_at: string;
    /** When to surface the reminder (ISO 8601). Defaults to due_at. */
    notify_at?: string;
  }>(
    'create_todo',
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
      });
      await updateRecord(db, record.id, {
        due_at: due,
        notify_at: notify,
        embedding: null,
      });
      return [{ type: 'text', text: `Todo #${record.id} created. Due ${due.toISOString()}, notification ${notify.toISOString()}.` }];
    },
  );

  mcp.addTool<{
    content: string;
    /** Entities this fact is about — full names for people, fully named
     *  companies. Space-separated names enable cross-fact connection. */
    entities?: string[];
    /** Trust provenance: 'stated' (Jacopo said it) > 'observed' (directly
     *  witnessed) > 'inferred' (concluded). Default: 'observed'. */
    source?: 'stated' | 'observed' | 'inferred';
  }>(
    'create_fact',
    'Create Fact',
    'Create a fact: a continuity-of-knowledge entry. Facts are authored and resolved primarily by the distiller; the agent creates facts when directly stated. Entities should use full names to disambiguate.',
    async ({ content, entities, source }, { origin_session_id, target_session_id, db }) => {
      if (entities !== undefined && (!Array.isArray(entities) || entities.some(e => typeof e !== 'string' || e.trim().length === 0))) {
        return [{ type: 'text', text: 'Error: entities must be an array of non-empty strings.' }];
      }
      const record = await insertRecord(db, {
        type: 'fact',
        origin_session_id,
        target_session_id,
        content,
        entities,
        source: source ?? 'observed',
      });
      return [{ type: 'text', text: `Fact #${record.id} created.` }];
    },
  );

  return mcp;
};
