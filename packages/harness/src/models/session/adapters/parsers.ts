
import OpenAI from 'openai';

import {
  type AgentInput,
  type AgentToolRequest,
  type AgentMessage,
} from "../../../types/messages.js";

/**
  * One provider response maps to ONE canonical message whose `blocks` array
  * preserves the response's grouping (content + tool_calls together, etc.).
  * Thinking/reasoning content is captured as a thinking block for continuity
  * purposes but is filtered out at replay time (see #format), mirroring the
  * common harness behavior of storing-but-not-replaying reasoning.
  */
export const parseMessage = (message: OpenAI.ChatCompletionMessage): AgentMessage[] => {
  const input: AgentInput = {
    role: 'agent',
    type: 'input',
    blocks: [],
  };
  const tools: AgentToolRequest = {
    role: 'agent',
    type: 'tool_req',
    requests: [],
  };
  if (message.content) {
    input.blocks.push({
      type: 'text',
      text: message.content,
    });
  }
  if ('reasoning_content' in message && typeof message.reasoning_content === 'string') {
    input.blocks.push({
      type: 'thinking',
      text: message.reasoning_content,
    });
  }
  if (message.refusal) {
    input.blocks.push({
      type: 'text',
      text: message.refusal,
    });
  }
  if (message.tool_calls) {
    for (const call of message.tool_calls) {
      if (call.type === 'function') {
        const params = parseFunctionCallArgs(call);
        tools.requests.push({
          req_id: call.id,
          tool: call.function.name,
          params,
        });
      }
    }
  }
  const parsed = [];
  if (input.blocks.length > 0) parsed.push(input);
  if (tools.requests.length > 0) parsed.push(tools);
  return parsed.length > 0 ? parsed : [];
};

/**
 * Sometimes model return invalid JSON for function call arguments.
 *
 * Examples seen while using this harness:
 * - DeepSeek V4 Pro (Tensorix) returned `{}""` for no params
 */
const parseFunctionCallArgs = (call: OpenAI.ChatCompletionMessageFunctionToolCall): Record <string, unknown> => {
  try {
    return JSON.parse(call.function.arguments);
  } catch {
    return {};
  }
};
