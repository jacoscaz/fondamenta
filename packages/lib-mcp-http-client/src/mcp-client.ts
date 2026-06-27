

import { McpInitializeParams, McpInitializeResult, McpToolCallResult, McpToolListResult } from "@fondamenta/mcp-core";
import { JsonRpcHttpClient } from "./jsonrpc-client.js";

export class McpHttpClient {

  #client: JsonRpcHttpClient;

  constructor(url: URL) {
    this.#client = new JsonRpcHttpClient(url);
  }

  async initialize(params: McpInitializeParams): Promise<McpInitializeResult> {
    return await this.#client.call<McpInitializeResult>('initialize', params);
  }

  async list(): Promise<McpToolListResult> {
    return await this.#client.call<McpToolListResult>('tools/list');
  }

  async call(tool: string, args: any): Promise<McpToolCallResult> {
    return await this.#client.call<McpToolCallResult>(
      'tools/call',
      { name: tool, arguments: args },
    );
  }

}
