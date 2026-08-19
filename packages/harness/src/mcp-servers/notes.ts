
import { ellipsis } from "@fondamenta/utils";
import {
  countRecords,
  deleteRecord,
  insertRecord,
  selectRecords,
  updateRecord,
  type SelectableContinuityRecord,
} from "../database/tables/continuity_records.js";
import { type HarnessMcpToolCallContext } from "../types.js";
import { type CompleteContext } from "../context.js";
import { McpLocalServer } from "@fondamenta/mcp-local";

// ── Param interfaces ──

interface CountNotesParams {
  session_id?: number;
  from?: string;
  to?: string;
  match?: string;
}

interface ListNotesParams extends CountNotesParams {
  id?: number;
  offset?: number;
  limit?: number;
  search?: string;
  order_col?: 'created_at' | 'updated_at';
  order_dir?: 'asc' | 'desc';
}

interface ReadNoteParams { id: number; }
interface DeleteNoteParams { id: number; }

interface InsertNoteParams {
  title: string;
  content: string;
}

interface UpdateNoteParams {
  id: number;
  title: string;
  content: string;
}

interface AppendNoteParams {
  id: number;
  content: string;
}

// ── Formatters ──

const formatNote = (
  note: SelectableContinuityRecord,
  preview: boolean,
): string => {
  const body = preview
    ? ellipsis(note.content, 100, '...\n\nThis is a preview. Use the `mcp_continuity_notes_read` tool to see the full content.')
    : note.content;
  return `## Note #${note.id} - ${note.title ?? '(untitled)'}\n\nCreated_at: ${note.created_at.toISOString()}\n\n${body}`;
};

const formatNotes = (
  notes: SelectableContinuityRecord[],
  count: number,
): string => {
  return `# Notes\n\nRetrieved ${notes.length} of ${count} matching notes.\n\n${notes.map(n => formatNote(n, true)).join('\n\n')}`;
};

// ── Tool registration ──

const TYPE = 'note' as const;

export const initNotesMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp = new McpLocalServer<HarnessMcpToolCallContext>();
  const model = ctx.managers.models.embedding;

  mcp.addTool<CountNotesParams>(
    'count',
    'Count Notes',
    'Retrieve the number of notes matching the specified parameters.',
    async ({ session_id, from, to, match }, { db }) => {
      const count = await countRecords(db, {
        type: TYPE,
        target_session_id: session_id,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        match,
      });
      return [{ type: 'text', text: `Found ${count} notes.` }];
    },
  );

  mcp.addTool<ListNotesParams>(
    'list',
    'List and Search Notes',
    'List previews of notes matching the specified criteria.',
    async (params, { db }) => {
      const filterOpts = {
        type: TYPE,
        session_id: params.session_id,
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
      const notes = await selectRecords(db, {
        ...filterOpts,
        id: params.id,
        offset: params.offset ?? 0,
        limit: params.limit ?? 10,
        search: params.search,
        embedding: embedding,
        order_col: params.order_col,
        order_dir: params.order_dir,
      });
      return [{ type: 'text', text: formatNotes(notes, count) }];
    },
  );

  mcp.addTool<ReadNoteParams>(
    'read',
    'Read a Note',
    'Retrieve the content of a note.',
    async ({ id }, { db }) => {
      const [note] = await selectRecords(db, { type: TYPE, id });
      if (!note) {
        return [{ type: 'text', text: 'Error: note not found' }];
      }
      return [{ type: 'text', text: formatNote(note, false) }];
    },
  );

  mcp.addTool<InsertNoteParams>(
    'insert',
    'Insert New Note',
    'Insert a new note.',
    async ({ title, content }, { origin_session_id, target_session_id, db }) => {
      await insertRecord(db, {
        type: TYPE,
        origin_session_id,
        target_session_id,
        title,
        content,
      });
      return [{ type: 'text', text: 'Note added successfully' }];
    },
  );

  mcp.addTool<UpdateNoteParams>(
    'update',
    'Update Note',
    'Updates the title and content of an existing note.',
    async ({ id, title, content }, { db }) => {
      await updateRecord(db, id, { title, content, embedding: null });
      return [{ type: 'text', text: 'Note updated successfully' }];
    },
  );

  mcp.addTool<AppendNoteParams>(
    'append',
    'Append to Note',
    'Append new content to an existing note.',
    async ({ id, content }, { db }) => {
      const [note] = await selectRecords(db, { type: TYPE, id });
      if (!note) {
        return [{ type: 'text', text: 'Error: note not found' }];
      }
      await updateRecord(db, id, {
        content: note.content + '\n\n' + content,
        embedding: null,
      });
      return [{ type: 'text', text: 'Content appended successfully' }];
    },
  );

  mcp.addTool<DeleteNoteParams>(
    'delete',
    'Delete a Note',
    'Delete a note.',
    async ({ id }, { db }) => {
      await deleteRecord(db, id);
      return [{ type: 'text', text: 'Note deleted successfully' }];
    },
  );

  return mcp;
};
