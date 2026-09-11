
import {
  AbstractSessionModel,
  type ModelQueryResults,
  type ModelQueryOpts,
} from "../abstract.js";

import OpenAI from 'openai';

import { type ConfigModelOpenAI } from "../../../config/config.js";
import { type ReasoningEffort } from "../../../constants.js";
import { ChatCompletionMessageParam, ReasoningEffort as OpenAIReasoningEffort } from "openai/resources/index.mjs";
import { ChatCompletionStream } from "openai/lib/ChatCompletionStream.mjs";
import { formatMessage } from "./formatters.js";
import { parseMessage, warnOnTextualToolCalls } from "./parsers.js";


export class OpenAISessionModel extends AbstractSessionModel {
  #model: string;
  #client: OpenAI;
  #extras: Record<string, any>;
  #reasoning: OpenAIReasoningEffort;

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

  /**
   * Runtime reasoning-effort update. The harness's common vocabulary maps
   * 1:1 onto the OpenAI-native values; unsupported requests are ignored
   * (log + false) rather than erroring — the switch itself must never fail
   * because an optional knob is missing (Jacopo's ruling, 2026-09-03).
   */
  override setReasoningEffort(effort: ReasoningEffort): boolean {
    if (this.#reasoning === 'none') {
      console.warn(`[openai-model ${this.#model}] reasoning effort requested but model was configured without reasoning — ignoring`);
      return false;
    }
    this.#reasoning = effort;
    return true;
  }

  get reasoningEffort(): ReasoningEffort {
    // OpenAI's type includes null (meaning "unset"); our vocabulary does not.
    return (this.#reasoning ?? 'none') as ReasoningEffort;
  }

  async _query(opts: ModelQueryOpts, signal?: AbortSignal, on_activity: () => void = () => { }): Promise<ModelQueryResults> {
    try {
      const messages: ChatCompletionMessageParam[] = opts.messages.flatMap(m => formatMessage(m, this));
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
        reasoning_effort: this.#reasoning as OpenAIReasoningEffort,
        stream_options: { include_usage: true },
        // Aborted by the session-model timeout wrapper on expiry; the SDK
        // then errors the stream itself (covering mid-stream stalls, which
        // the SDK's own time-to-headers timeout does not).
        signal,
        tools: opts.tools.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.params_schema,
          },
        })),
      });
      const [response, usage] = await this.#consumeStream(stream, on_activity);
      const parsed_messages = parseMessage(response);
      // Loud, registry-bounded detection of tool calls the model emitted as
      // text instead of natively (2026-09-10 distiller incident: a
      // continuity_append arrived as malformed markup in a text block and
      // the write was silently lost). A warning only — never an action.
      warnOnTextualToolCalls(parsed_messages, opts.tools.map((t) => t.name), this.#model);
      return {
        messages: parsed_messages,
        input_size: usage.prompt_tokens,
        cached_size: usage.prompt_tokens_details?.cached_tokens ?? 0,
        output_size: usage.completion_tokens,
      };
    } catch (e) {
      throw new Error(`Failed to query OpenAI model: ${e}`);
    }
  }

  async #consumeStream(stream: ChatCompletionStream, on_activity: () => void): Promise<[OpenAI.ChatCompletionMessage, OpenAI.CompletionUsage]> {
    // The SDK's chunk accumulator only knows the standard Chat Completions
    // fields; provider extensions such as DeepSeek-style `reasoning_content`
    // (or OpenRouter's `reasoning`) fall through to an `Object.assign` that
    // OVERWRITES instead of concatenating, so `finalMessage()` would keep
    // only the LAST reasoning delta of the response (observed in production
    // as one-word "thinking" tails). Accumulate them ourselves and reattach
    // the full trace.
    let reasoning = '';
    let reasoning_alt = '';
    // Per-chunk handler
    const onChunk = (chunk: OpenAI.ChatCompletionChunk) => {
      // Every received chunk re-arms the stall timeout: the model may think
      // server-side (reasoning, slow generation) for long stretches, and
      // that is health — silence is what indicates a hang.
      on_activity();
      // Accumulation of reasoning deltas to work around the SDK's overwrite
      // behavior.
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta as Record<string, unknown> | undefined;
        if (typeof delta?.reasoning_content === 'string') {
          reasoning += delta.reasoning_content;
        }
        if (typeof delta?.reasoning === 'string') {
          reasoning_alt += delta.reasoning;
        }
      }
    };
    // Cleanup handlers for chunk and end/abort events.
    const onEndOrAbort = () => {
      stream.off('chunk', onChunk);
      stream.off('end', onEndOrAbort);
      stream.off('abort', onEndOrAbort);
    };
    // Attach event handlers to the stream.
    stream.on('chunk', onChunk);
    stream.on('end', onEndOrAbort);
    stream.on('abort', onEndOrAbort);
    // Wait for the stream to complete and return the response.
    const response = await stream.finalMessage();
    // Attach the accumulated reasoning to the response.
    const full_reasoning = reasoning || reasoning_alt;
    if (full_reasoning) {
      // `reasoning_content` is an unofficial extension to the OpenAI API
      // response, thus not supported by the official SDK.
      (response as unknown as Record<string, unknown>).reasoning_content = full_reasoning;
    }
    // Get the total usage from the stream.
    const usage = await stream.totalUsage();
    // Return the response and usage.
    return [response, usage];
  }

}
