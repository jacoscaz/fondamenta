import { ellipsis, errToString } from "@fondamenta/utils";
import { type DB, ensureTrx } from "../database/client.js";
import { selectSessionById, updateSessionTokens } from "../database/tables/sessions.js";
import { type ASelectableDBMessage, selectMessagesForActivation, type AInsertableDBMessage, updateMessageRaw, insertMessage, selectMessages } from "../database/tables/messages.js";
import { type ToolUseErrorBlock, type ToolUseRequestBlock, type ToolUseResultBlock } from "../models/session/types/blocks.js";
import { type Message, type UserMessage } from "../models/session/types/messages.js";
import { type InitContext, WithContext } from "../context.js";
import { type Logger } from 'pinetto';
import { type HarnessMcpToolCallContext } from "../mcp-servers/types.js";
import { type McpManager } from "../mcp-manager/manager.js";
import { type InjectionContext } from "../emygdala/emygdala.js";
import assert from "node:assert";


export interface SessionRunnerEvents extends Record<string, any[]> {
  [key: `session-${number}-message`]: [message: Message];
}

export class SessionRunner extends WithContext<SessionRunnerEvents> {

  #logger: Logger;
  #running: boolean;
  #origin_session_id: number;
  #target_session_id: number;

  constructor(ctx: InitContext, origin_session_id: number, target_session_id: number) {
    super(ctx);
    this.#logger = ctx.logger.child(`[session:${origin_session_id}]`);
    this.#running = false;
    this.#origin_session_id = origin_session_id;
    this.#target_session_id = target_session_id;
  }

  get session_id() {
    return this.#origin_session_id;
  }

  /**
   * Insert a user message into the session and trigger the activation loop.
   * Absorbed from SessionManager.
   */
  async addMessage(message: UserMessage): Promise<void> {
    await ensureTrx(this._ctx.db, async (trx) => {
      const model = this._ctx.managers.models.session;
      await insertMessage(trx, {
        session_id: this.#origin_session_id,
        data: message,
        raw: model.format(message),
        created_at: new Date(),
        processed_at: null,
        role: 'user',
      });
    });
    this.run();
  }

  /**
   * Retrieve processed message history for this session.
   * Used by IOManager to resume WebSocket connections.
   */
  async getHistory(): Promise<Message[]> {
    const messages = await selectMessages(this._ctx.db, {
      session_id: this.#origin_session_id,
      unprocessed: 'exclude',
    });
    this.#logger.debug('retrieved %s messages from history', messages.length);
    return messages.map(m => m.data);
  }

  async run(db?: DB, mcp_manager?: McpManager): Promise<void> {
    if (this.#running) {
      return;
    }
    this.#running = true;
    db = db ?? this._ctx.db;
    mcp_manager = mcp_manager ?? this._ctx.managers.mcp;
    this.#logger.debug('running');
    try {
      // Keep processing while there are unprocessed messages
      let has_more = true;
      while (has_more) {
        has_more = await selectMessagesForActivation(db, this.#origin_session_id, async (messages, _db: DB) => {
          return await this.#query(messages, _db, mcp_manager);
        });
      }
    } catch (err) {
      this.#logger.error('run error: %s', errToString(err));
    } finally {
      this.#running = false;
      this.#logger.debug('idle');
    }
  }

  async #query(req_messages: ASelectableDBMessage[], db: DB, mcp_manager: McpManager): Promise<AInsertableDBMessage[]> {
    const session = await selectSessionById(db, this.#origin_session_id);
    const model = this._ctx.managers.models.session;
    const raw_req_messages = (await Promise.all(req_messages.map(async (message) => {
      let { raw, processed_at } = message;
      if (!processed_at) {
        this.emit(`session-${this.session_id}-message`, message.data);
      }
      if (!raw) {
        assert(message.data.role === 'user', 'message must be a user message');
        raw = await model.format(message.data);
        await updateMessageRaw(db, message.id, message.raw);
      }
      return raw;
    }))).flat(1);
    // Inject synthetic messages via emygdala — single injection point
    const injection_ctx: InjectionContext = { session, db };
    const injected_texts = await this._ctx.emygdala.getInjectedMessages(injection_ctx);
    const synthetic_messages: any[] = [];
    for (const text of injected_texts) {
      synthetic_messages.push(...model.format({
        role: 'user',
        blocks: [{ type: 'text', text }],
      }));
    }
    const { messages: raw_res_messages, input_size, output_size } = await model.query({
      messages: [...synthetic_messages, ...raw_req_messages],
      tools: await this.#listTools(mcp_manager),
      session_id: `fondamenta-${this.#origin_session_id}`,
      system_prompt: session.system_prompt,
    });
    await updateSessionTokens(db, this.#origin_session_id, {
      prompt_size: input_size,
      input_tokens_delta: input_size,
      output_tokens_delta: output_size,
    });
    const tool_use_reqs: ToolUseRequestBlock[] = [];

    const res_db_messages: AInsertableDBMessage[] = [];
    const created_at = new Date();

    for (const raw_res_message of raw_res_messages) {
      res_db_messages.push({
        role: 'agent',
        raw: raw_res_message,
        data: model.parse(raw_res_message, tool_use_reqs),
        session_id: this.#origin_session_id,
        created_at,
        processed_at: created_at,
      });
    }

    if (tool_use_reqs.length > 0) {
      const tool_use_context: HarnessMcpToolCallContext = {
        db,
        origin_session_id: this.#origin_session_id,
        target_session_id: this.#target_session_id,
      };
      await Promise.all(tool_use_reqs.map(async (call) => {
        const res = await this.#callTool(mcp_manager, call, tool_use_context);
        res_db_messages.push({
          role: 'user',
          raw: model.format({ role: 'user', blocks: [res] }),
          data: { role: 'user', blocks: [res] },
          session_id: this.#origin_session_id,
          created_at,
          processed_at: null,
        });
      }));
    }
    for (const message of res_db_messages) {
      this.emit(`session-${this.session_id}-message`, message.data);
    }
    return res_db_messages;
  }

  async #listTools(mcp_manager: McpManager) {
    return (await mcp_manager.list()).tools;
  }

  async #callTool(mcp_manager: McpManager, block: ToolUseRequestBlock, call_ctx: HarnessMcpToolCallContext): Promise<ToolUseErrorBlock | ToolUseResultBlock> {
    try {
      const result = await mcp_manager.call(block.tool, block.params, call_ctx);
      this.#logger.debug('Tool call success: %s %s', block.tool, () => ellipsis(JSON.stringify(block.params), 128));
      return {
        type: 'tool_use_res',
        req_id: block.req_id,
        result,
        tool: block.tool,
        params: block.params,
      };
    } catch (err) {
      const text = errToString(err, true);
      this.#logger.warn('Tool call error: %s %s', block.tool, () => ellipsis(JSON.stringify(block.params), 128));
      this.#logger.debug('Tool call error: %s %s', block.tool, text);
      return {
        type: 'tool_use_err',
        req_id: block.req_id,
        error: [{ type: 'text', text }],
        tool: block.tool,
        params: block.params,
      };
    }
  }

}
