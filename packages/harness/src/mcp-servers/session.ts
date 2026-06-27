
import { McpLocalServer } from "@fondamenta/mcp-local";
import pinetto from 'pinetto';
import { type CompleteContext } from "../context.js";
import { type HarnessMcpToolCallContext } from "./types.js";

export const registerSessionTools = (ctx: CompleteContext, mcp_server: McpLocalServer<HarnessMcpToolCallContext>) => {

  // interface SetModelParams {
  //   model_id: string;
  // }

  // mcp_server.addTool<SetModelParams>(
  //   'set_model',
  //   'Set Session Model',
  //   'Configure which model should be used for the specified session.',
  //   async ({ model_id }, { db, session_id }) => {
  //     await ctx.managers.sessions.setSessionModel(session_id, model_id, db);
  //     return [{ type: 'text', text: 'model correctly set' }];
  //   },
  // );

  interface CompactParams {
    summary: string;
    model_id?: string;
  }

  mcp_server.addTool<CompactParams>(
    'compact',
    'Compact',
    'Use this tool to compact the session and clear out the context.',
    (async ({ summary }, { db, origin_session_id: session_id }) => {
      await ctx.managers.sessions.compactSession(session_id, summary, db);
      return [{ type: 'text', text: 'Consolidation successful.' }];
    }),
  );

};


export const initSessionMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp_server = new McpLocalServer<HarnessMcpToolCallContext>();

  registerSessionTools(ctx, mcp_server);

  return mcp_server;

};
