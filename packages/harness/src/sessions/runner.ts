import { ellipsis, errToString } from "@fondamenta/utils";
import { type DB } from "../database/client.js";
import { selectSessionById, updateSessionTokens } from "../database/tables/sessions.js";
import { type ASelectableDBMessage, selectMessagesForActivation, type AInsertableDBMessage, updateMessageRaw, insertMessage, selectMessages } from "../database/tables/messages.js";
import { type TextBlock, type ToolUseErrorBlock, type ToolUseRequestBlock, type ToolUseResultBlock } from "../models/session/types/blocks.js";
import { type Message, type UserMessage } from "../models/session/types/messages.js";
import { type InitContext, WithContext } from "../context.js";
import { type Logger } from 'pinetto';
import { type HarnessMcpToolCallContext } from "../types.js";
import { type McpManager } from "../mcp-manager/manager.js";
import assert from "node:assert";
import { type AbstractSessionModel } from "../models/session/abstract.js";
import { getMonotonicDate } from "../monotonic.js";
import { detectInjections } from "./injection-guardrails.js";
import { makeActivationPrompt } from "../prompts/activation.js";
import { AUTOMATED_MESSAGE_PREFIX } from "../constants.js";


export interface SessionRunnerEvents extends Record<string, any[]> {
  message: [message: Message];
  idle: [prompt_size?: number];
}

export class SessionRunner extends WithContext<SessionRunnerEvents> {

  #model: AbstractSessionModel<any, any>;
  #logger: Logger;
  #running: boolean;
  #injected: AInsertableDBMessage[] = [];
  #prompt_size?: number;
  #origin_session_id: number;
  #target_session_id: number;
  #pre_query_listeners: (() => Promise<void>)[] = [];
  #post_query_listeners: (() => Promise<void>)[] = [];
  #heartbeat_timer: NodeJS.Timeout | null = null;
  #last_heartbeat_activation_at?: Date;

  constructor(ctx: InitContext, origin_session_id: number, target_session_id: number, model: AbstractSessionModel<any, any>) {
    super(ctx);
    this.#model = model;
    this.#logger = ctx.logger.child(`[session:${origin_session_id}]`);
    this.#running = false;
    this.#injected = [];
    this.#origin_session_id = origin_session_id;
    this.#target_session_id = target_session_id;
    this.#pre_query_listeners = [];
    this.#post_query_listeners = [];
  }

  /**
   * Start the internal heartbeat. Only called for the main session
   * runner; transient runners (distiller) have no heartbeat.
   */
  startHeartbeat(): void {
    if (this.#heartbeat_timer) return;
    const interval_ms = this._ctx.config.heartbeat?.interval ?? 30_000;
    this.#heartbeat_timer = setInterval(() => this.#onHeartbeatTick(), interval_ms);
    const activation_ms = this._ctx.config.heartbeat?.activation_interval_ms ?? 0;
    this.#logger.info('heartbeat every %dms (activation interval: %dms)', interval_ms, activation_ms);
  }

  stopHeartbeat(): void {
    if (this.#heartbeat_timer) {
      clearInterval(this.#heartbeat_timer);
      this.#heartbeat_timer = null;
    }
  }

  /**
   * Heartbeat tick: drain pending messages. If the minimum activation
   * interval has elapsed since the last heartbeat-driven activation,
   * inject the honest activation message first — the injection itself
   * is the work that run() then processes.
   */
  #onHeartbeatTick(): void {
    if (this.#running) {
      this.#logger.debug('heartbeat tick skipped: already running');
      return;
    }
    const activation_interval_ms = this._ctx.config.heartbeat?.activation_interval_ms ?? 0;
    if (activation_interval_ms > 0) {
      const now = new Date();
      const last = this.#last_heartbeat_activation_at;
      if (!last || (now.valueOf() - last.valueOf()) >= activation_interval_ms) {
        const elapsed = last ? Math.round((now.valueOf() - last.valueOf()) / 60_000) : null;
        this.#last_heartbeat_activation_at = now;
        this.#logger.info('heartbeat activation triggered (last activation %s)', elapsed !== null ? `${elapsed}m ago` : 'at boot');
        this.injectAutomatedTextMessage(makeActivationPrompt(now, elapsed), false).catch(err => {
          this.#logger.error('heartbeat activation injection error: %s', errToString(err));
        });
      }
    }
    this.run();
  }

  /** Whether the runner is currently processing an activation loop. */
  get running(): boolean {
    return this.#running;
  }

  /** Timestamp of the moment the runner last became idle (undefined if never ran). */
  #last_idle_at?: Date;

  get lastIdleAt(): Date | undefined {
    return this.#last_idle_at;
  }

  addPreQueryListener(listener: () => Promise<void>) {
    this.#pre_query_listeners.push(listener);
  }

  async #runPreQueryListeners(db: DB) {
    for (const listener of this.#pre_query_listeners) {
      await listener();
    }
  }

  addPostQueryListener(listener: () => Promise<void>) {
    this.#post_query_listeners.push(listener);
  }

  async #runPostQueryListeners(db: DB) {
    for (const listener of this.#post_query_listeners) {
      await listener();
    }
  }

  get session_id() {
    return this.#origin_session_id;
  }

  /**
   * Insert a user message into the session and trigger the activation loop.
   * Absorbed from SessionManager.
   */
  async injectMessage(data: UserMessage, run: boolean): Promise<void> {
    await insertMessage(this._ctx.db, {
      role: data.role,
      session_id: this.#target_session_id,
      data,
      raw: this._ctx.managers.models.session.format(data),
      created_at: getMonotonicDate(),
    });
    if (run) {
      this.run();
    }
  }

  async injectAutomatedTextMessage(text: string, run: boolean): Promise<void> {
    const message: UserMessage<TextBlock> = {
      role: 'user',
      block: { type: 'text', text: `${AUTOMATED_MESSAGE_PREFIX} ${text}` },
    };
    await this.injectMessage(message, run);
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
        has_more = await selectMessagesForActivation(db, this.#origin_session_id, async (messages) => {
          return await this.#query(messages, db, mcp_manager);
        });
      }
    } catch (err) {
      this.#logger.error('run error: %s', errToString(err));
    } finally {
      this.#running = false;
      this.#last_idle_at = new Date();
      this.#logger.debug('idle');
      this.emit('idle', this.#prompt_size);
    }
  }

  /**
   * Filters content blocks unsupported by the active model's declared input
   * modalities. Unsupported blocks (e.g., images for a text-only model) are
   * replaced with placeholder text so downstream tool req/res pairing and
   * ordering remain intact.
   */
  #filterUnsupportedBlocks(message: UserMessage): UserMessage {
    const block = message.block;
    if (block.type !== 'tool_use_res') return message;

    const result = block.result.map((b) => {
      if (b.type === 'text' || this.#model.supportsImageInput) return b;
      if (b.type === 'image') {
        return {
          type: 'text' as const,
          text: `[image content withheld — model '${this.#model.constructor.name}' does not support image input]`,
        };
      }
      return b;
    });

    if (result === block.result) return message;
    return { ...message, block: { ...block, result } };
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
        const data = this.#filterUnsupportedBlocks(message.data as UserMessage);
        raw = await this.#model.format(data);
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

  /**
   * Scans a tool result for prompt injection patterns. On detection, the
   * original content is REPLACED with a redaction notice — it never enters
   * the session transcript, the database, or the model's context.
   *
   * Scanning is skipped only for tools hosted by MCP servers flagged as
   * `safe: true` in the server descriptors: those servers' outputs are
   * produced by the harness itself and are trusted by construction. All
   * other servers (mail, files, shell, terminal, ...) relay content that
   * may have been authored by third parties and is scanned unconditionally,
   * regardless of which agent or identity is running on this harness.
   */
  static #scanToolResult(mcp_manager: McpManager, tool: string, result: ToolUseResultBlock['result']): { flagged: boolean; patterns: string[] } {
    if (mcp_manager.isSafeServer(tool)) {
      return { flagged: false, patterns: [] };
    }

    const text = result.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
    const matches = detectInjections(text);
    if (matches.length === 0) {
      return { flagged: false, patterns: [] };
    }
    return {
      flagged: true,
      patterns: matches.map((m) => `${m.pattern_name}: ${m.excerpt}`),
    };
  }

  async #callTool(mcp_manager: McpManager, block: ToolUseRequestBlock, call_ctx: HarnessMcpToolCallContext): Promise<ToolUseErrorBlock | ToolUseResultBlock> {
    try {
      const result = await mcp_manager.call(block.tool, block.params, call_ctx);
      this.#logger.debug('Tool call success: %s %s', block.tool, () => ellipsis(JSON.stringify(block.params), 128));

      // Prompt injection guardrails — see `injection-guardrails.ts`.
      const scan = SessionRunner.#scanToolResult(mcp_manager, block.tool, result);
      if (scan.flagged) {
        this.#logger.warn(
          'Prompt injection pattern(s) detected in tool result [%s]: %s',
          block.tool,
          scan.patterns.map((p) => ellipsis(p, 100)).join('; '),
        );
        return {
          type: 'tool_use_res',
          req_id: block.req_id,
          tool: block.tool,
          params: block.params,
          result: [
            {
              type: 'text',
              text:
                `[GUARDED CONTENT] The original output of tool '${block.tool}' was withheld because it matched known prompt-injection patterns:\n` +
                scan.patterns.map((p) => `- ${p}`).join('\n') +
                `\n\nThe raw content was never inserted into the session transcript. If this tool's output is expected to be legitimate, review it manually outside the model context before trusting it.`,
            },
          ],
        };
      }

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
