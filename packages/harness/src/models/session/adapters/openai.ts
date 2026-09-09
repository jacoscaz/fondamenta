
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
import { parseMessage } from "./parsers.js";


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

  async _query(opts: ModelQueryOpts, signal?: AbortSignal, on_activity?: () => void): Promise<ModelQueryResults> {
    let stream: ChatCompletionStream<null> | undefined = undefined;
    try {
      const messages: ChatCompletionMessageParam[] = opts.messages.flatMap(m => formatMessage(m, this));
      messages.unshift({
        role: 'system',
        content: opts.system_prompt,
      } satisfies ChatCompletionMessageParam);
      stream = this.#client.chat.completions.stream({
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
      // Every received chunk re-arms the stall timeout: the model may think
      // server-side (reasoning, slow generation) for long stretches, and
      // that is health — silence is what indicates a hang.
      if (on_activity) {
        stream.on('chunk', (chunk) => {
          on_activity();
        });
      }
      const response = await stream.finalMessage();
      const usage = await stream.totalUsage();
      return {
        messages: parseMessage(response),
        input_size: usage.prompt_tokens,
        cached_size: usage.prompt_tokens_details?.cached_tokens ?? 0,
        output_size: usage.completion_tokens,
      };
    } catch (e) {
      throw new Error(`Failed to query OpenAI model: ${e}`);
    } finally {
      if (on_activity) {
        stream?.off('chunk', on_activity);
      }
    }
  }

}
