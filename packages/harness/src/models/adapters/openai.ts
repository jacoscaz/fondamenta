
import {
  type AgentBlock,
  type UserBlock,
  type Message,
  type AgentMessage,
  UserMessage,
} from "../types/messages.js";

import {
  ToolUseRequestBlock,
  type ToolUseResultBlock,
} from '../types/blocks.js';

import {
  AbstractModel,
  ModelQueryResults,
  type ModelQueryOpts,
} from "../abstract.js";

import OpenAI from 'openai';

import { ConfigModelOpenAI } from "../../config/config.js";
import { ChatCompletionMessageFunctionToolCall, ChatCompletionMessageParam, ReasoningEffort } from "openai/resources/index.mjs";

export class OpenAIModel extends AbstractModel<OpenAI.ChatCompletionMessageParam, OpenAI.ChatCompletionMessage> {

  #model: string;
  #client: OpenAI;
  #extras: Record<string, any>;
  #reasoning: ReasoningEffort;

  constructor(opts: ConfigModelOpenAI) {
    super(opts);
    this.#model = opts.options.model;
    this.#extras = opts.options.extras ?? {};
    this.#client = new OpenAI({
      apiKey: opts.options.api_key,
      baseURL: opts.options.base_url,
    });
    this.#reasoning = opts.options.reasoning?.effort ?? 'none';
  }

  async query(opts: ModelQueryOpts<OpenAI.ChatCompletionMessage>): Promise<ModelQueryResults<OpenAI.ChatCompletionMessage>> {
    const messages: ChatCompletionMessageParam[] = [...opts.messages];
    messages.unshift({
      role: 'system',
      content: opts.system_prompt,
    } satisfies ChatCompletionMessageParam);
    const stream = this.#client.chat.completions.stream({
      ...this.#extras,
      messages,
      max_tokens: opts.max_output_size ?? this.max_ouput_size,
      session_id: opts.session_id,
      model: this.#model,
      reasoning_effort: this.#reasoning,
      stream_options: { include_usage: true },
      tools: opts.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      })),
    });
    const response = await stream.finalMessage();
    const usage = await stream.totalUsage();
    return {
      messages: [response],
      input_size: usage.prompt_tokens,
      cached_size: usage.prompt_tokens_details?.cached_tokens ?? 0,
      output_size: usage.completion_tokens,
    };
  }

  /**
   * Sometimes model return invalid JSON for function call arguments.
   *
   * Examples seen while using this harness:
   * - DeepSeek V4 Pro (Tensorix) returned `{}""` for no params
   */
   parseFunctionCallArgs(call: ChatCompletionMessageFunctionToolCall): Record<string, unknown> {
    try {
      return JSON.parse(call.function.arguments);
    } catch {
      return {};
    }
  }

  parse(message: OpenAI.ChatCompletionMessage, tool_calls: ToolUseRequestBlock[]): AgentMessage {
    const parsed: AgentMessage = { role: 'agent', blocks: [] };
    if (message.content) {
      parsed.blocks.push({ type: 'text', text: message.content });
    }
    if (message.tool_calls) {
      for (const call of message.tool_calls) {
        if (call.type === 'function') {
          const params = this.parseFunctionCallArgs(call);
          const tool_call: ToolUseRequestBlock = {
            type: 'tool_use_req',
            req_id: call.id,
            tool: call.function.name,
            params,
          };
          call.function.arguments = JSON.stringify(params);
          tool_calls.push(tool_call);
          parsed.blocks.push(tool_call);
        }
      }
    }
    if (message.refusal) {
      parsed.blocks.push({ type: 'refusal', text: message.refusal });
    }
    return parsed;
  }

  format(message: UserMessage): OpenAI.ChatCompletionMessageParam[] {
    return message.blocks.map((block): OpenAI.ChatCompletionMessageParam => {
      switch (block.type) {
        case 'text':
          return {
            role: 'user',
            content: block.text,
          };
        case 'tool_use_err':
          return {
            role: 'tool',
            tool_call_id: block.req_id,
            content: `error: ${formatToolUseResultBlocks(block.error)}`,
          };
        case 'tool_use_res':
        return {
          role: 'tool',
          tool_call_id: block.req_id,
          content: formatToolUseResultBlocks(block.result),
        };
      }
    });
  }

}

const formatToolUseResultBlocks = (blocks: ToolUseResultBlock['result']): string => {
  return blocks.map((block) => {
    switch (block.type) {
      case 'text':
        return block.text;
      default:
        return `unsupported content type: ${block.type}`;
    }
  }).join('\n');
};
