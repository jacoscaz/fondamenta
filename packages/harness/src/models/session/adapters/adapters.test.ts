import { test } from "node:test";
import assert from "node:assert";
import OpenAI from "openai";
import { parseMessage } from "./parsers.js";
import { formatMessage } from "./formatters.js";
import { type OpenAISessionModel } from "./openai.js";
import { type AgentInput, type Message } from "../../../types/messages.js";

/**
 * Adapter-level guarantees for unsupported blocks: whatever a provider
 * response carries that the adapter cannot represent natively is kept
 * (as an unsupported block) rather than dropped, and whatever is stored
 * as unsupported replays to the provider as loud marked text.
 */

const FAKE_ADAPTER = {
  replay_thinking: false,
  supports_image_input: false,
} as unknown as OpenAISessionModel;

test('parseMessage: annotations are captured as an unsupported block', () => {
  const response = {
    role: 'assistant',
    content: 'Here is the answer.',
    annotations: [{ type: 'url_citation', url: 'https://example.com' }],
  } as unknown as OpenAI.ChatCompletionMessage;

  const messages = parseMessage(response);
  const input = messages.find(m => m.type === 'input') as AgentInput;
  const unsupported = input.blocks.filter(b => b.type === 'unsupported');
  assert.equal(unsupported.length, 1);
  assert.ok(unsupported[0].text.includes('[annotations]'));
  assert.ok(unsupported[0].text.includes('url_citation'));
  // Normal content still parses as text alongside it.
  const text = input.blocks.find(b => b.type === 'text');
  assert.ok(text && 'text' in text && text.text === 'Here is the answer.');
});

test('parseMessage: legacy function_call is captured as an unsupported block', () => {
  const response = {
    role: 'assistant',
    content: null,
    function_call: { name: 'shell_exec', arguments: '{"command":"ls"}' },
  } as unknown as OpenAI.ChatCompletionMessage;

  const messages = parseMessage(response);
  const input = messages.find(m => m.type === 'input') as AgentInput;
  const unsupported = input.blocks.filter(b => b.type === 'unsupported');
  assert.equal(unsupported.length, 1);
  assert.ok(unsupported[0].text.includes('[legacy function_call]'));
  assert.ok(unsupported[0].text.includes('shell_exec'));
});

test('parseMessage: a plain response produces no unsupported blocks', () => {
  const response = {
    role: 'assistant',
    content: 'plain text',
  } as unknown as OpenAI.ChatCompletionMessage;

  const messages = parseMessage(response);
  const input = messages[0] as AgentInput;
  assert.ok(input.blocks.every(b => b.type === 'text'));
});

test('formatMessage: unsupported and thinking_redacted replay as loud marked text', () => {
  const message: Message = {
    role: 'agent',
    type: 'input',
    blocks: [
      { type: 'thinking_redacted', text: '' },
      { type: 'unsupported', text: '[annotations] [{"type":"url_citation"}]' },
      { type: 'text', text: 'the visible answer' },
    ],
  };

  const wire = formatMessage(message, FAKE_ADAPTER);
  assert.equal(wire.length, 1);
  const assistant = wire[0] as { role: string; content?: string; reasoning_content?: string };
  assert.equal(assistant.role, 'assistant');
  assert.ok(assistant.content?.includes('[unsupported] [annotations]'));
  assert.ok(assistant.content?.includes('[thinking redacted]'));
  assert.ok(assistant.content?.includes('the visible answer'));
  // replay_thinking is false on the fake adapter: no reasoning_content.
  assert.equal(assistant.reasoning_content, undefined);
});
