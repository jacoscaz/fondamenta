import { ellipsis } from "@fondamenta/utils";
import {
  countRecords,
  deleteRecord,
  insertRecord,
  selectRecords,
  type SelectableContinuityRecord,
} from "../database/tables/continuity_records.js";
import { type HarnessMcpToolCallContext } from "./types.js";
import { type CompleteContext } from "../context.js";
import { McpLocalServer } from "@fondamenta/mcp-local";

// ── Param interfaces ──

interface CountLogsParams {
  session_id?: number;
  from?: string;
  to?: string;
  match?: string;
}

interface ListLogsParams extends CountLogsParams {
  id?: number;
  offset?: number;
  limit?: number;
  search?: string;
  order_col?: 'created_at';
  order_dir?: 'asc' | 'desc';
}

interface ReadLogParams {
  id: number;
}

interface InsertLogParams {
  message: string;
}

// ── Formatters ──

const formatLog = (
  log: SelectableContinuityRecord,
  preview: boolean,
): string => {
  const body = preview
    ? ellipsis(log.content, 100, '...\n\nThis is a preview. Use the `mcp_continuity_logs_read` tool to see the full content.')
    : log.content;
  return `## Log #${log.id}\n\nCreated_at: ${log.created_at.toISOString()}\n\n${body}`;
};

const formatLogs = (
  logs: SelectableContinuityRecord[],
  count: number,
): string => {
  return `# Logs\n\nRetrieved ${logs.length} of ${count} matching logs.\n\n${logs.map(l => formatLog(l, true)).join('\n\n')}`;
};

// ── Tool registration ──

const TYPE = 'log' as const;

export const initLogsMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp = new McpLocalServer<HarnessMcpToolCallContext>();
  const model = ctx.managers.models.embedding;

  mcp.addTool<CountLogsParams>(
    'count',
    'Count Logs',
    'Retrieve the number of logs matching the specified parameters.',
    async ({ session_id, from, to, match }, { db }) => {
      const count = await countRecords(db, {
        type: TYPE,
        target_session_id: session_id,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        match,
      });
      return [{ type: 'text', text: `Found ${count} logs.` }];
    },
  );

  mcp.addTool<ListLogsParams>(
    'list',
    'List and Search Logs',
    'List previews of logs matching the specified parameters.',
    async (params, { db }) => {
      const filterOpts = {
        type: TYPE,
        session_id: params.session_id,
        from: params.from ? new Date(params.from) : undefined,
        to: params.to ? new Date(params.to) : undefined,
        match: params.match,
      };
      const count = await countRecords(db, filterOpts);
      let hybrid_embedding: number[] | undefined;
      if (params.search) {
        try {
          hybrid_embedding = (await model.embed(params.search)).embedding;
        } catch { /* fall back to BM25-only */ }
      }
      const logs = await selectRecords(db, {
        ...filterOpts,
        id: params.id,
        offset: params.offset ?? 0,
        limit: params.limit ?? 10,
        search: params.search,
        embedding: hybrid_embedding,
        order_col: params.order_col,
        order_dir: params.order_dir,
      });
      return [{ type: 'text', text: formatLogs(logs, count) }];
    },
  );

  mcp.addTool<ReadLogParams>(
    'read',
    'Read a Log',
    'Retrieve the message of a log.',
    async ({ id }, { db }) => {
      const [log] = await selectRecords(db, { type: TYPE, id });
      if (!log) {
        return [{ type: 'text', text: 'Error: log not found' }];
      }
      return [{ type: 'text', text: formatLog(log, false) }];
    },
  );

  mcp.addTool<InsertLogParams>(
    'insert',
    'Insert New Log',
    'Insert a new log.',
    async ({ message }, { origin_session_id, target_session_id, db }) => {
      await insertRecord(db, {
        type: TYPE,
        origin_session_id,
        target_session_id,
        content: message,
      });
      return [{ type: 'text', text: 'Log added successfully' }];
    },
  );

  interface DeleteLogParams { id: number; }

  mcp.addTool<DeleteLogParams>(
    'delete',
    'Delete a log',
    'Delete a log.',
    async ({ id }, { db }) => {
      await deleteRecord(db, id);
      return [{ type: 'text', text: 'Log deleted successfully' }];
    },
  );

  return mcp;
};
