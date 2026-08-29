
import {
  type AgentMessage,
  type Message,
  type UserBlock,
} from "../types/messages.js";

import {
  type ToolUseErrorBlock,
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
      const messages: ChatCompletionMessageParam[] = opts.messages.flatMap(m => this.#format(m));
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

  /**
   * One provider response maps to ONE canonical message whose `blocks` array
   * preserves the response's grouping (content + tool_calls together, etc.).
   * Thinking/reasoning content is captured as a thinking block for continuity
   * purposes but is filtered out at replay time (see #format), mirroring the
   * common harness behavior of storing-but-not-replaying reasoning.
   */
  #parse(message: OpenAI.ChatCompletionMessage): AgentMessage[] {
    const parsed: AgentMessage = { role: 'agent', blocks: [] };
    if (message.content) {
      parsed.blocks.push({ type: 'text', text: message.content });
    }
    if (message.tool_calls) {
      for (const call of message.tool_calls) {
        if (call.type === 'function') {
          const params = this.parseFunctionCallArgs(call);
          parsed.blocks.push({
            type: 'tool_use_req',
            req_id: call.id,
            tool: call.function.name,
            params,
          });
        }
      }
    }
    if (message.refusal) {
      parsed.blocks.push({ type: 'text', text: message.refusal });
    }
    return parsed.blocks.length > 0 ? [parsed] : [];
  }

  /**
   * Formats one canonical message into ZERO OR MORE provider messages:
   * - agent messages become one assistant message carrying text, tool_calls
   *   and refusal together — preserving the grouping the provider originally
   *   produced;
   * - user messages with tool results/errors expand to one tool message per
   *   block (the wire format requires one tool_call_id per message), while
   *   user messages with any other block type become one user message;
   * - thinking blocks are NOT replayed (stored for continuity only).
   * The canonical store models the conversation; provider wire quirks live
   * here, in the adapter.
   */
  #format(message: Message): OpenAI.ChatCompletionMessageParam[] {
    if (message.role === 'user') {
      const tool_blocks = message.blocks.filter(
        (b): b is ToolUseErrorBlock | ToolUseResultBlock => b.type === 'tool_use_err' || b.type === 'tool_use_res',
      );
      if (tool_blocks.length > 0) {
        return tool_blocks.map((block) => {
          switch (block.type) {
            case 'tool_use_err':
              return {
                role: 'tool',
                tool_call_id: block.req_id,
                content: formatTextOnly(block.error),
              } as OpenAI.ChatCompletionToolMessageParam;
            case 'tool_use_res':
              return {
                role: 'tool',
                tool_call_id: block.req_id,
                content: formatToolUseResultContent(block.result),
              } as OpenAI.ChatCompletionToolMessageParam;
          }
        });
      }
      return [{
        role: 'user',
        content: formatUserBlocks(message.blocks),
      }];
    }

    let text: string | null = null;
    let refusal: string | null = null;
    const tool_calls: OpenAI.ChatCompletionMessageToolCall[] = [];
    for (const block of message.blocks) {
      switch (block.type) {
        case 'text':
          text = (text ?? '') + block.text;
          break;
        case 'tool_use_req':
          tool_calls.push({
            id: block.req_id,
            type: 'function',
            function: {
              name: block.tool,
              arguments: JSON.stringify(block.params),
            },
          });
          break;
        case 'refusal':
          refusal = (refusal ?? '') + block.text;
          break;
        case 'unsupported':
          text = (text ?? '') + block.text;
          break;
        case 'thinking':
        case 'thinking_redacted':
          break;
      }
    }
    return [{
      role: 'assistant',
      content: text,
      refusal,
      tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
    }];
  }

}

/**
 * Formats user text blocks into a plain string content value.
 */
const formatUserBlocks = (blocks: { type: string; text?: string }[]): string => {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
};

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
