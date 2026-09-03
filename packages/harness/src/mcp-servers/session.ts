import { McpLocalServer } from "@fondamenta/mcp-local";
import { type CompleteContext } from "../context.js";
import { type HarnessMcpToolCallContext } from "../types.js";
import { REASONING_EFFORTS } from "../config/config.js";

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

  interface SwitchSubstrateParams {
    /** Index into config.models.session (0-based). Omit to keep the current model. */
    model?: number;
    /** Requested reasoning effort. Omit to keep the current effort. */
    reasoning_effort?: string;
  }

  mcp_server.addTool<SwitchSubstrateParams>(
    'switch_substrate',
    'Switch Substrate',
    'Switch this session\'s substrate at runtime: select a different session model (by index into the configured session-model array; entry 0 is the default) and/or request a different reasoning effort (none/minimal/low/medium/high/xhigh). Both parameters are optional; provide at least one. Reasoning-effort requests are no-ops (never errors) on models that do not support them. Model switches are session-scoped and reset to the default model on harness restart.',
    (async ({ model, reasoning_effort }, { db, origin_session_id: session_id }) => {
      if (model === undefined && reasoning_effort === undefined) {
        return [{ type: 'text', text: 'Error: provide model (index), reasoning_effort, or both.' }];
      }
      const results: string[] = [];
      if (model !== undefined) {
        try {
          const name = ctx.managers.sessions.switchSessionModel(session_id, model);
          results.push(`model switched to: ${name} (index ${model})`);
        } catch (err) {
          const count = ctx.managers.models.sessionModelCount;
          return [{ type: 'text', text: `Error: invalid model index ${model} (valid range: 0-${count - 1}).` }];
        }
      }
      if (reasoning_effort !== undefined) {
        if (!(REASONING_EFFORTS as readonly string[]).includes(reasoning_effort)) {
          return [{ type: 'text', text: `Error: invalid reasoning_effort '${reasoning_effort}'. Valid values: ${REASONING_EFFORTS.join(', ')}.` }];
        }
        const applied = ctx.managers.sessions.setSessionReasoningEffort(session_id, reasoning_effort);
        results.push(applied
          ? `reasoning effort set to: ${reasoning_effort}`
          : `reasoning effort '${reasoning_effort}' not supported by the active model — request ignored (no error)`);
      }
      return [{ type: 'text', text: results.join('\n') }];
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

      const max_context_size = ctx.managers.models.defaultSession.max_context_size;
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
