import { McpLocalServer } from "@fondamenta/mcp-local";
import { type CompleteContext } from "../context.js";
import { type HarnessMcpToolCallContext } from "./types.js";

export const registerSessionTools = (ctx: CompleteContext, mcp_server: McpLocalServer<HarnessMcpToolCallContext>) => {

  interface CompactParams {
    retain_count?: number;
  }

  mcp_server.addTool<CompactParams>(
    'compact',
    'Compact',
    'Compact the session by summarizing older messages and retaining recent ones. Uses a dedicated compactor model.',
    (async ({ retain_count }, { db, origin_session_id: session_id }) => {
      await ctx.compactor.compact(session_id, retain_count ?? 20, db);
      return [{ type: 'text', text: 'Compaction successful.' }];
    }),
  );

  mcp_server.addTool<Record<string, never>>(
    'info',
    'Session Info',
    'Returns information about the current session: token count (prompt_size), context window size, pressure ratio, and message count.',
    async (_params, { db, origin_session_id: session_id }) => {
      const session = await db
        .selectFrom('sessions')
        .where('id', '=', session_id)
        .select(['prompt_size', 'input_tokens_count', 'output_tokens_count'])
        .executeTakeFirstOrThrow();

      const max_context_size = ctx.managers.models.session.max_context_size;
      const pressure = session.prompt_size / max_context_size;

      const message_count = await db
        .selectFrom('messages')
        .where('session_id', '=', session_id)
        .select(qb => qb.fn.countAll().as('count'))
        .executeTakeFirstOrThrow();

      const info = {
        prompt_size: session.prompt_size,
        max_context_size,
        pressure: Math.round(pressure * 100) / 100,
        pressure_percent: Math.round(pressure * 100),
        input_tokens_count: session.input_tokens_count,
        output_tokens_count: session.output_tokens_count,
        message_count: Number(message_count.count),
      };

      return [{ type: 'text', text: JSON.stringify(info, null, 2) }];
    },
  );

};

export const initSessionMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp_server = new McpLocalServer<HarnessMcpToolCallContext>();

  registerSessionTools(ctx, mcp_server);

  return mcp_server;

};
