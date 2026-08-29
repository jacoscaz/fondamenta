
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
  AbstractSessionModel,
  ModelQueryResults,
  type ModelQueryOpts,
} from "../abstract.js";

import OpenAI from 'openai';

import { ConfigModelOpenAI } from "../../../config/config.js";
import { ChatCompletionMessageFunctionToolCall, ChatCompletionMessageParam, ReasoningEffort } from "openai/resources/index.mjs";

export class OpenAISessionModel extends AbstractSessionModel {
  // <OpenAI.ChatCompletionMessageParam, OpenAI.ChatCompletionMessage>
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

  async query(opts: ModelQueryOpts): Promise<ModelQueryResults> {
    try {
      const messages: ChatCompletionMessageParam[] = opts.messages.map(m => this.#format(m));
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
        messages: this.#parse(response),
        input_size: usage.prompt_tokens,
        cached_size: usage.prompt_tokens_details?.cached_tokens ?? 0,
        output_size: usage.completion_tokens,
      };
    } catch (e) {
      console.error(e);
      throw new Error(`Failed to query OpenAI model: ${e}`);
    }
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

  #parse(message: OpenAI.ChatCompletionMessage): AgentMessage[] {
    const parsed: AgentMessage[] = [];
    if (message.content) {
      parsed.push({ role: 'agent', block: { type: 'text', text: message.content } });
    }
    if (message.tool_calls) {
      for (const call of message.tool_calls) {
        if (call.type === 'function') {
          const params = this.parseFunctionCallArgs(call);
          parsed.push({
            role: 'agent',
            block: {
              type: 'tool_use_req',
              req_id: call.id,
              tool: call.function.name,
              params,
            },
          });
        }
      }
    }
    if (message.refusal) {
      parsed.push({ role: 'agent', block: { type: 'text', text: message.refusal } });
    }
    return parsed;
  }

  #format(message: Message): OpenAI.ChatCompletionMessageParam {
    switch (message.block.type) {
      case 'text':
        return {
          role: message.role === 'agent' ? 'assistant' : 'user',
          content: message.block.text,
        };
      case 'thinking':
        return {
          role: 'assistant',
          content: message.block.text,
        };
      case 'tool_use_req':
        return {
          role: 'assistant',
          tool_calls: [
            {
              id: message.block.req_id,
              type: 'function',
              function: {
                name: message.block.tool,
                arguments: JSON.stringify(message.block.params),
              },
            }
          ],
        };
      case 'tool_use_err':
        return {
          role: 'tool',
          tool_call_id: message.block.req_id,
          content: formatTextOnly(message.block.error),
        } as OpenAI.ChatCompletionToolMessageParam;
      case 'tool_use_res':
        return {
          role: 'tool',
          tool_call_id: message.block.req_id,
          content: formatToolUseResultContent(message.block.result),
        } as OpenAI.ChatCompletionToolMessageParam;
      case 'refusal':
        return {
          role: 'assistant',
          refusal: message.block.text,
        };
      case 'thinking_redacted':
        return {
          role: 'assistant',
          content: '-- redacted thinking --',
        };
      case 'unsupported':
        return {
          role: message.role === 'agent' ? 'assistant' : 'user',
          content: message.block.text,
        };
    }
  }

}

/**
 * Formats tool result blocks into an OpenAI-compatible `content` value.
 * Text-only results produce a plain string; results containing image blocks
 * produce a multipart content array with text parts and data-URL image parts.
 */
const formatToolUseResultContent = (blocks: ToolUseResultBlock['result']): OpenAI.ChatCompletionContentPart[] => {
  const has_images = blocks.some((block) => block.type === 'image');
  if (!has_images) {
    return formatTextOnly(blocks);
  }
  const parts: OpenAI.ChatCompletionContentPart[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.trim().length > 0) parts.push({ type: 'text', text: block.text });
        break;
      case 'image':
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${block.mime_type};base64,${block.data}` },
        });
        break;
    }
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '(empty tool result)' }];
};

const formatTextOnly = (blocks: ToolUseResultBlock['result']): OpenAI.ChatCompletionContentPart[] => {
  return blocks.map((block) => {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'image':
        return { type: 'text', text: `[image withheld: ${block.mime_type}, ${block.data.length} base64 chars]` };
    }
  });
};
