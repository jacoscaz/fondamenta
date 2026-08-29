
import { type McpToolDescriptor } from "@fondamenta/mcp-core";
import { type ConfigModelBase, type ConfigModalities } from "../../config/config.js";

import { AgentMessage, Message } from "./types/messages.js";

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

  readonly #max_output_size: number;
  readonly #max_context_size: number;
  readonly #modalities: ConfigModalities;

  constructor(opts: ConfigModelBase) {
    this.#max_output_size = opts.max_output_size;
    this.#max_context_size = opts.max_context_size;
    this.#modalities = opts.modalities ?? {};
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

  abstract query(opts: ModelQueryOpts): Promise<ModelQueryResults>;

}
