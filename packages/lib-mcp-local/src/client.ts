
import { McpToolCallContext } from "@fondamenta/mcp-core/src/types-mcp.js";
import {
  type McpLocalServer,
} from "./server.js";

import {
  type McpInitializeParams,
  type McpInitializeResult,
  type McpToolCallResult,
  type McpToolListResult,
  type McpClient,
} from "@fondamenta/mcp-core";

export class McpLocalClient<C extends McpToolCallContext = {}> implements McpClient<C> {

  #server: McpLocalServer<C>;

  constructor(server: McpLocalServer<C>) {
    this.#server = server;
  }

  async initialize(params: McpInitializeParams): Promise<McpInitializeResult> {
    return await this.#server.onRequest('initialize', params);
  }

  async list(): Promise<McpToolListResult> {
    return await this.#server.onRequest('tools/list');
  }

  async call(tool: string, args: any, ctx: C): Promise<McpToolCallResult> {
    return await this.#server.onRequest(
      'tools/call',
      { name: tool, arguments: args },
      ctx,
    );
  }

}
