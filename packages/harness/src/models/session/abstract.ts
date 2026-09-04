
import { type McpToolDescriptor } from "@fondamenta/mcp-core";
import { type ConfigModelBase, type ConfigModalities } from "../../config/config.js";

import { AgentMessage, Message } from "./types/messages.js";
import { withTimeout } from "@fondamenta/utils";

export interface ModelQueryOpts {
  tools: McpToolDescriptor[];
  messages: Message[];
  session_id: string;
  system_prompt: string;
  max_output_size?: number;
}

export interface ModelQueryResults {
  messages: AgentMessage[];
  input_size: number;
  cached_size: number;
  output_size: number;
}

export abstract class AbstractSessionModel {

  readonly #id: string;
  readonly #timeout: number;
  readonly #guidance?: string;
  readonly #max_output_size: number;
  readonly #max_context_size: number;
  readonly #modalities: ConfigModalities;

  constructor(opts: ConfigModelBase) {
    this.#id = opts.id;
    this.#timeout = opts.timeout;
    this.#guidance = opts.guidance;
    this.#max_output_size = opts.max_output_size;
    this.#max_context_size = opts.max_context_size;
    this.#modalities = opts.modalities ?? {};
  }

  /** Harness-internal unique model identifier (e.g. 'z-ai/glm-5.3-flash'). */
  get id(): string {
    return this.#id;
  }

  /** Declarative selection guidance for the agent (may be undefined). */
  get guidance(): string | undefined {
    return this.#guidance;
  }

  get max_ouput_size(): number {
    return this.#max_output_size;
  }

  get max_context_size(): number {
    return this.#max_context_size
  }

  get supportsImageInput(): boolean {
    return this.#modalities.images ?? false;
  }

  async query(opts: ModelQueryOpts): Promise<ModelQueryResults> {
    // On expiry, abort the in-flight request: the timer merely rejecting
    // the race would leave the underlying stream open (and any eventual
    // orphaned error would be an unhandled rejection). Aborting makes the
    // provider request itself fail, settling the abandoned promise.
    const controller = new AbortController();
    return withTimeout(
      () => this._query(opts, controller.signal),
      this.#timeout,
      {
        subject: `model query (${this.#id})`,
        onTimeout: () => controller.abort(),
      },
    );
  }

  protected abstract _query(opts: ModelQueryOpts, signal?: AbortSignal): Promise<ModelQueryResults>;

  /**
   * Runtime reasoning-effort update, part of the dynamic substrate
   * switching design (2026-09-03): the session runner requests an effort
   * level from the harness's common vocabulary (REASONING_EFFORTS) and
   * the adapter translates to its native equivalent.
   *
   * Adapters with no notion of reasoning effort return false (no-op);
   * adapters whose config disables reasoning also return false. A switch
   * request must never ERROR because an optional knob is missing.
   */
  setReasoningEffort(_effort: string): boolean {
    return false;
  }

}
