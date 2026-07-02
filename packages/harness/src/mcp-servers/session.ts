
import { McpLocalServer } from "@fondamenta/mcp-local";
import pinetto from 'pinetto';
import { type CompleteContext } from "../context.js";
import { type HarnessMcpToolCallContext } from "./types.js";
import { insertSession } from "../database/tables/sessions.js";
import { SessionRunner } from "../sessions/runner.js";
import { selectMessages } from "../database/tables/messages.js";
import { AgentMessage } from "../models/session/types/messages.js";

export const registerSessionTools = (ctx: CompleteContext, mcp_server: McpLocalServer<HarnessMcpToolCallContext>) => {

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

  // interface ForkParams {
  //   prompt: string;
  //   // model_id?: string;
  // }

  // mcp_server.addTool<ForkParams>(
  //   'fork',
  //   'Fork',
  //   'Use this tool to start a new session from the current one.',
  //   (async ({ prompt }, { db }) => {
  //     const { id: session_id } = await insertSession(db, {
  //       initiator: 'agent',
  //       created_at: new Date(),
  //       system_prompt: prompt,
  //     });
  //     const runner = new SessionRunner(ctx.init, session_id, session_id);
  //     await runner.run(db, ctx.managers.mcp.blacklist([
  //       'mcp_logs_count',
  //       'mcp_logs_list',
  //       'mcp_logs_read',
  //       'mcp_logs_insert',
  //       'mcp_notes_count',
  //       'mcp_notes_list',
  //       'mcp_notes_read',
  //       'mcp_notes_insert',
  //       'mcp_notes_update',
  //       'mcp_notes_append',
  //       'mcp_anchors_insert',
  //       'mcp_anchors_select',
  //       'mcp_anchors_update',
  //       'mcp_anchors_delete',
  //     ]));
  //     const messages = await selectMessages(db, { session_id });
  //     const result = messages.filter(m => m.role === 'agent')
  //       .flatMap(m => (m.data as AgentMessage).blocks)
  //       .filter(b => b.type === 'text')
  //       .join('\n\n');
  //     return [{ type: 'text', text: result }];
  //   }),
  // );

};


export const initSessionMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp_server = new McpLocalServer<HarnessMcpToolCallContext>();

  registerSessionTools(ctx, mcp_server);

  return mcp_server;

};
