import {
  AbstractSessionModel,
  type ModelQueryResults,
  type ModelQueryOpts,
} from "../../abstract.js";

import Anthropic from '@anthropic-ai/sdk';

import { type ConfigModelAnthropic } from "../../../../config/config.js";
import { type ReasoningEffort } from "../../../../constants.js";
import { formatMessages } from "./formatters.js";
import { projectMessage } from "../../../../projection.js";
import { parseMessage, warnOnTextualToolCalls } from "./parsers.js";


export class AnthropicSessionModel extends AbstractSessionModel {
  #model: string;
  #client: Anthropic;
  #extras: Record<string, any>;
  #prompt_cache_ttl: '5m' | '1h' | 'off';

  constructor(opts: ConfigModelAnthropic) {
    super(opts);
    this.#model = opts.options.model;
    this.#extras = opts.options.extras ?? {};
    this.#client = new Anthropic({
      apiKey: opts.options.api_key,
      baseURL: opts.options.base_url,
    });
    // Default 1h: the default 5m cache lifetime barely survives an active
    // exchange, while this harness's activations are minutes-to-hours
    // apart (heartbeat cadence); 1h doubles the write cost (2x vs 1.25x
    // base input) but keeps the stable prefix cacheable across the
    // common "human replies within the hour" and heartbeat patterns.
    this.#prompt_cache_ttl = opts.options.prompt_cache_ttl ?? '1h';
  }

  /** Cache breakpoint TTL for the stable prefix; consumed by the formatter. */
  get prompt_cache_ttl(): '5m' | '1h' | 'off' {
    return this.#prompt_cache_ttl;
  }

  /**
   * Runtime reasoning-effort update. v1 of this adapter does not request
   * extended thinking: thinking blocks replay requires the per-block
   * signature to have been persisted, and unsigned history would
   * hard-reject tool-use rounds. The harness's common vocabulary maps
   * poorly onto Anthropic's budget-based thinking; a future version may
   * translate. Unsupported requests are ignored (log + false) rather
   * than erroring — the switch itself must never fail because an
   * optional knob is missing (Jacopo's ruling, 2026-09-03).
   */
  override setReasoningEffort(effort: ReasoningEffort): boolean {
    console.warn(`[anthropic-model ${this.#model}] reasoning effort '${effort}' requested but extended thinking is not yet wired in the anthropic adapter — ignoring`);
    return false;
  }

  async _query(opts: ModelQueryOpts, signal?: AbortSignal, on_activity: () => void = () => { }): Promise<ModelQueryResults> {
    try {
      // Projection runs here, in request composition — content decisions
      // before serialization; formatters only map and hard-crash on any
      // block they do not support.
      const projected = opts.messages.flatMap(m => {
        const p = projectMessage(m, this.projection);
        return p === null ? [] : [p];
      });
      const messages = formatMessages(projected, this);
      // The cache prefix is tools -> system -> messages: marking the
      // system block caches tools + system together (the heavy, fully
      // stable head of every request).
      const system: Anthropic.TextBlockParam[] = [{
        type: 'text',
        text: opts.system_prompt,
        ...(this.#prompt_cache_ttl !== 'off' ? { cache_control: { type: 'ephemeral', ttl: this.#prompt_cache_ttl } } : {}),
      }];
      const stream = this.#client.messages.stream({
        ...this.#extras,
        model: this.#model,
        max_tokens: opts.max_output_size ?? this.max_ouput_size,
        system,
        messages,
        tools: opts.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.params_schema as Anthropic.Tool.InputSchema,
        })),
      }, {
        // Aborted by the session-model timeout wrapper on expiry; the
        // SDK then errors the stream itself (covering mid-stream stalls,
        // which the SDK's own time-to-headers timeout does not).
        signal,
      });
      // Every received event re-arms the stall timeout: the model may
      // think server-side for long stretches, and that is health —
      // silence is what indicates a hang.
      const on_event = () => on_activity();
      stream.on('streamEvent', on_event);
      const response = await stream.finalMessage();
      const parsed_messages = parseMessage(response);
      // Loud, registry-bounded detection of tool calls the model emitted
      // as text instead of natively (same failure class as the OpenAI
      // adapter's 2026-09-10 distiller incident). A warning only —
      // never an action.
      warnOnTextualToolCalls(parsed_messages, opts.tools.map((t) => t.name), this.#model);
      const usage = response.usage;
      // Anthropic reports cache reads/writes separately from uncached
      // input; the harness's accounting wants the FULL effective prompt
      // size (per the API's own definition: input + cache_creation +
      // cache_read), with the cached share broken out for economy.
      return {
        messages: parsed_messages,
        input_size: (usage.input_tokens ?? 0)
          + (usage.cache_creation_input_tokens ?? 0)
          + (usage.cache_read_input_tokens ?? 0),
        cached_size: usage.cache_read_input_tokens ?? 0,
        output_size: usage.output_tokens,
      };
    } catch (e) {
      throw new Error(`Failed to query Anthropic model: ${e}`);
    }
  }

}
