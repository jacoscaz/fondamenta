
import {
  type McpLocalServer,
} from "./server.js";

import {
  type McpInitializeParams,
  type McpInitializeResult,
  type McpToolCallResult,
  type McpToolListResult,
  type McpClient,
  type McpNotification,
  type McpToolCallContext,
} from "@fondamenta/mcp-core";

export class McpLocalClient<C extends McpToolCallContext = {}> implements McpClient<C> {

  #server: McpLocalServer<C>;
  #notification_handlers: ((notification: McpNotification) => void)[];

  constructor(server: McpLocalServer<C>) {
    this.#server = server;
    this.#notification_handlers = [];
    // Local transport: the server emits notifications directly to us.
    server.__onServerNotification((notification) => {
      for (const handler of this.#notification_handlers) {
        try {
          handler(notification);
        } catch (err) {
          // A broken handler must not break the notification flow.
        }
      }
    });
  }

  onNotification(handler: (notification: McpNotification) => void): void {
    this.#notification_handlers.push(handler);
  }

  async initialized(): Promise<void> {
    // Local transport: delivered directly to the server.
    await this.#server.onNotification('notifications/initialized', undefined, {} as C);
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
