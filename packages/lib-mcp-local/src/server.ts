

import { cast, ReceiveType, resolveReceiveType, ValidationError } from '@runtyped/type';
import { ToolRegistry, wrapTool } from "./tools.js";
import assert from "node:assert";
import { McpServer } from "@fondamenta/mcp-core";
import { type JsonRpcNotification } from "@fondamenta/mcp-core";
import { validationErrsToString } from "@fondamenta/utils";
import {
  type McpInitializeParams,
  type McpInitializeResult,
  type McpToolCallResult,
  type McpToolListResult,
  type McpToolsCallParams,
  type JsonRpcParams,
} from "@fondamenta/mcp-core";

import { McpToolCallContext } from "@fondamenta/mcp-core/src/types-mcp.js";


export class McpLocalServer<C extends McpToolCallContext = {}> implements McpServer<C> {

  #tools: ToolRegistry;
  #notification_listeners: ((notification: JsonRpcNotification) => void)[];

  constructor() {
    this.#tools = new Map();
    this.#notification_listeners = [];
  }

  /**
   * Register a listener for notifications emitted by this server
   * (server-to-client direction). The transport layer bridges these to
   * the connected client.
   */
  onServerNotification(listener: (notification: JsonRpcNotification) => void): void {
    this.#notification_listeners.push(listener);
  }

  /**
   * Emit a notification to the connected client (server-to-client).
   * Transport layers hook this via onServerNotification.
   */
  notify(method: string, params?: JsonRpcParams): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    };
    for (const listener of this.#notification_listeners) {
      try {
        listener(notification);
      } catch (err) {
        // A broken listener must not break the emitter.
      }
    }
  }

  addTool<I = {}>(name: string, title: string, description: string, fn: (params: I, ctx: C) => McpToolCallResult | Promise<McpToolCallResult>, __type_I?: ReceiveType<I>) {
    assert(!this.#tools.has(name), `Tool with name ${name} already exists`);
    __type_I = resolveReceiveType(__type_I);
    this.#tools.set(name, wrapTool(name, title, description, fn, __type_I));
  }

  async onNotification(method: string, params: JsonRpcParams | undefined, ctx: C): Promise<void> {

  }

  onRequest(method: 'initialize', params: JsonRpcParams, ctx?: any): Promise<any>;
  onRequest(method: 'tools/list', params?: JsonRpcParams | undefined, ctx?: any): Promise<any>;
  onRequest(method: 'tools/call', params: JsonRpcParams, ctx: C): Promise<any>;
  onRequest(method: string, params?: JsonRpcParams, ctx?: C): Promise<any>;
  async onRequest(method: string, params: JsonRpcParams, ctx: C): Promise<any> {
    try {
      switch (method) {
        case 'initialize':
          return this.#onInitializeRequest(params);
        case 'tools/list':
          return this.#onToolsListRequest(params);
        case 'tools/call':
          return this.#onToolsCallRequest(params, ctx);
        default:
          throw new Error(`Unknown method ${method}`);
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new Error(`Invalid parameters: ${validationErrsToString(err.errors)}`);
      }
      throw err;
    }
  }

  #onInitializeRequest = async (params?: any) => {
    const { protocolVersion } = cast<McpInitializeParams>(params);
    return {
      protocolVersion,
      capabilities: {
        tools: {
          listChanged: false,
        },
        resources: {},
      },
      serverInfo: {
        name: 'My Server',
        version: '1.0.0',
      },
    } satisfies McpInitializeResult;
  };

  #onToolsListRequest = async (params?: any) => {
    return {
      tools: Array.from(this.#tools.values())
        .map(t => t.descriptor)
    } satisfies McpToolListResult;
  };

  #onToolsCallRequest = async (params: any, ctx: C): Promise<McpToolCallResult> => {
    const { name, arguments: args } = cast<McpToolsCallParams>(params);
    const tool = this.#tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool ${name}`);
    }
    return tool.call(args, ctx);
  };


}
