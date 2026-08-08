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

};

export const initSessionMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp_server = new McpLocalServer<HarnessMcpToolCallContext>();

  registerSessionTools(ctx, mcp_server);

  return mcp_server;

};
