import { McpInitializeParams, McpInitializeResult, McpToolCallResult, McpToolListResult, McpToolDescriptor } from "@fondamenta/mcp-core";
import { JsonRpcStdioClient } from "./jsonrpc-stdio-client.js";
import { type JsonRpcNotification } from "@fondamenta/mcp-core";

export class McpStdioClient {

  #client: JsonRpcStdioClient;

  constructor(command: string, args: string[] = [], env?: Record<string, string>) {
    this.#client = new JsonRpcStdioClient();
    this.#client.start(command, args, env);
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

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.#client.onNotification(handler);
  }

  async stop(): Promise<void> {
    await this.#client.stop();
  }

}
