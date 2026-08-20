
import { type McpToolDescriptor } from "@fondamenta/mcp-core";
import { type ConfigModelBase } from "../../config/config.js";

import { AgentBlock, AgentMessage, UserMessage } from "./types/messages.js";
import { ToolUseRequestBlock } from "./types/blocks.js";

export interface ModelQueryOpts<ReqMessage> {
  tools: McpToolDescriptor[];
  messages: ReqMessage[];
  session_id: string;
  system_prompt: string;
  max_output_size?: number;
}

export interface ModelQueryResults<ResMessage> {
  messages: ResMessage[];
  input_size: number;
  cached_size: number;
  output_size: number;
}

export abstract class AbstractSessionModel<ReqMessage, ResMessage = ReqMessage> {

  readonly #max_output_size: number;
  readonly #max_context_size: number;

  constructor(opts: ConfigModelBase) {
    this.#max_output_size = opts.max_output_size;
    this.#max_context_size = opts.max_context_size;
  }

  get max_ouput_size(): number {
    return this.#max_output_size;
  }

  get max_context_size(): number {
    return this.#max_context_size
  }

  abstract query(opts: ModelQueryOpts<ReqMessage>): Promise<ModelQueryResults<ResMessage>>;

  abstract parse(message: ResMessage): [raw: ResMessage, parsed: AgentMessage][];

  abstract format(message: UserMessage): ReqMessage;


}
