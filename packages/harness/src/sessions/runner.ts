import { ellipsis, errToString } from "@fondamenta/utils";
import { type DB, ensureTrx } from "../database/client.js";
import { selectSessionById, updateSessionTokens } from "../database/tables/sessions.js";
import { type ASelectableDBMessage, selectMessagesForActivation, type AInsertableDBMessage, updateMessageRaw, insertMessage, selectMessages } from "../database/tables/messages.js";
import { type ToolUseErrorBlock, type ToolUseRequestBlock, type ToolUseResultBlock } from "../models/session/types/blocks.js";
import { AgentBlock, type Message, type UserMessage } from "../models/session/types/messages.js";
import { type InitContext, WithContext } from "../context.js";
import { type Logger } from 'pinetto';
import { type HarnessMcpToolCallContext } from "../types.js";
import { type McpManager } from "../mcp-manager/manager.js";
import assert from "node:assert";
import { type AbstractSessionModel } from "../models/session/abstract.js";
import { getMonotonicDate } from "../monotonic.js";


export interface SessionRunnerEvents extends Record<string, any[]> {
  message: [message: Message];
  idle: [prompt_size?: number];
}

export class SessionRunner extends WithContext<SessionRunnerEvents> {

  #model: AbstractSessionModel<any, any>;
  #logger: Logger;
  #running: boolean;
  #prompt_size?: number;
  #origin_session_id: number;
  #target_session_id: number;
  #pre_query_listeners: ((db: DB, session_id: number) => Promise<void>)[] = [];
  #post_query_listeners: ((db: DB, session_id: number) => Promise<void>)[] = [];

  constructor(ctx: InitContext, origin_session_id: number, target_session_id: number, model: AbstractSessionModel<any, any>) {
    super(ctx);
    this.#model = model;
    this.#logger = ctx.logger.child(`[session:${origin_session_id}]`);
    this.#running = false;
    this.#origin_session_id = origin_session_id;
    this.#target_session_id = target_session_id;
    this.#pre_query_listeners = [];
    this.#post_query_listeners = [];
  }

  addPreQueryListener(listener: (db: DB, session_id: number) => Promise<void>) {
    this.#pre_query_listeners.push(listener);
  }

  async #runPreQueryListeners(db: DB) {
    for (const listener of this.#pre_query_listeners) {
      await listener(db, this.session_id);
    }
  }

  addPostQueryListener(listener: (db: DB, session_id: number) => Promise<void>) {
    this.#post_query_listeners.push(listener);
  }

  async #runPostQueryListeners(db: DB) {
    for (const listener of this.#post_query_listeners) {
      await listener(db, this.session_id);
    }
  }

  get session_id() {
    return this.#origin_session_id;
  }

  /**
   * Insert a user message into the session and trigger the activation loop.
   * Absorbed from SessionManager.
   */
  async addMessage(message: UserMessage, db?: DB): Promise<void> {
    await ensureTrx(db ?? this._ctx.db, async (trx) => {
      await insertMessage(trx, {
        session_id: this.#origin_session_id,
        data: message,
        raw: this.#model.format(message),
        created_at: getMonotonicDate(),
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
      this.emit('idle', this.#prompt_size);
    }
  }

  async #query(req_messages: ASelectableDBMessage[], db: DB, mcp_manager: McpManager): Promise<AInsertableDBMessage[]> {
    const session = await selectSessionById(db, this.#origin_session_id);
    await this.#runPreQueryListeners(db);
    const raw_req_messages = (await Promise.all(req_messages.map(async (message) => {
      let { raw, processed_at } = message;
      if (!processed_at) {
        this.emit(`message`, message.data);
      }
      if (!raw) {
        assert(message.data.role === 'user', 'message must be a user message');
        raw = await this.#model.format(message.data);
        await updateMessageRaw(db, message.id, message.raw);
      }
      return raw;
    }))).flat(1);
    const { messages: raw_res_messages, input_size, output_size } = await this.#model.query({
      messages: raw_req_messages,
      tools: await this.#listTools(mcp_manager),
      session_id: `fondamenta-${this.#origin_session_id}`,
      system_prompt: session.system_prompt,
    });
    await updateSessionTokens(db, this.#origin_session_id, {
      prompt_size: input_size,
      input_tokens_delta: input_size,
      output_tokens_delta: output_size,
    });
    this.#prompt_size = input_size;

    const res_db_messages: AInsertableDBMessage[] = [];
    const tool_use_context: HarnessMcpToolCallContext = {
      db,
      runner: this,
      origin_session_id: this.#origin_session_id,
      target_session_id: this.#target_session_id,
    };
    for (const raw_res_message of raw_res_messages) {
      const parsed = this.#model.parse(raw_res_message);
      for (const [raw, msg] of parsed) {
        if (msg.block.type === 'tool_use_req') {
          const req_created_at = getMonotonicDate();
          res_db_messages.push({
            role: 'agent',
            raw,
            data: msg,
            session_id: this.#origin_session_id,
            created_at: req_created_at,
            processed_at: req_created_at,
          });
          const res = await this.#callTool(mcp_manager, msg.block, tool_use_context);
          const res_created_at = getMonotonicDate();
          res_db_messages.push({
            role: 'user',
            raw: this.#model.format({ role: 'user', block: res }),
            data: { role: 'user', block: res },
            session_id: this.#origin_session_id,
            created_at: res_created_at,
            processed_at: null,
          });
        } else {
          const created_at = getMonotonicDate();
          res_db_messages.push({
            role: 'agent',
            raw,
            data: msg,
            session_id: this.#origin_session_id,
            created_at,
            processed_at: created_at,
          });
        }
      }
    }

    for (const message of res_db_messages) {
      this.emit(`message`, message.data);
    }
    await this.#runPostQueryListeners(db);
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
