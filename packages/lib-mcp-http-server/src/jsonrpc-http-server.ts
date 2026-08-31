
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { BlankEnv, BlankInput, H } from 'hono/types';
import { cast } from '@runtyped/type';

import { isJsonRpcNotification, isJsonRpcRequest, JsonRpcErrorResponse, JsonRpcMessage, JsonRpcResponse, JsonRpcResultResponse, JsonRpcStandardErrorCodes } from '@fondamenta/mcp-core';
import { McpLocalServer } from '@fondamenta/mcp-local';
import { errToString } from '@fondamenta/utils';



/**
 * HTTP-based JSON-RPC server for MCP.
 * Extends JsonRpcActor with HTTP/SSE transport instead of stdio.
 */
export class JsonRpcHttpServer {

  #app: Hono;
  #host: string;
  #port: number;
  #local: McpLocalServer;

  constructor(host: string = '127.0.0.1', port: number = 3333, local: McpLocalServer) {
    this.#host = host;
    this.#port = port;
    this.#app = new Hono();
    this.#local = local;
    this.#setupRoutes();
  }

  #setupRoutes() {
    // Handle both POST requests (client sends data) and GET requests (server sends data)
    this.#app.post('/mcp', this.#handleMcpPost.bind(this));
    this.#app.get('/mcp', this.#handleMcpGet.bind(this));
    this.#app.delete('/mcp', this.#handleMcpDelete.bind(this));
  }

  #handleMcpPost: H<BlankEnv, "/mcp", BlankInput, any> = async (ctx) => {
    let messages;
    try {
      messages = await ctx.req.json();
      if (!Array.isArray(messages)) {
        messages = [messages];
      }
      messages = cast<JsonRpcMessage[]>(messages);
    } catch (err) {
      return ctx.text('Invalid JSON-RPC request', 400);
    }
    const responses: JsonRpcResponse[] = [];
    for (const message of messages) {
      if (isJsonRpcRequest(message)) {
        try {
          const result = await this.#local.onRequest(message.method, message.params);
          responses.push({
            jsonrpc: '2.0',
            id: message.id,
            result,
          } satisfies JsonRpcResultResponse);
        } catch (err) {
          responses.push({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: JsonRpcStandardErrorCodes.InternalError,
              message: errToString(err, true),
            },
          } satisfies JsonRpcErrorResponse);
        }
      } else if (isJsonRpcNotification(message)) {
        await this.#local.onNotification(message.method, message.params, {});
      } else {
        // TODO:
        // NOTIFICATION, CAN'T DO NOTHING
      }
    }
    if (responses.length > 0) {
      return ctx.json(responses, 200);
    }
    return ctx.body(null, 204);
  };

  #handleMcpGet: H<BlankEnv, "/mcp", BlankInput, any> = async (ctx) => {
    // GET endpoint for server-initiated messages
    // For now, return 405 Method Not Allowed
    return ctx.text('Method Not Allowed', 405);
  };

  #handleMcpDelete: H<BlankEnv, "/mcp", BlankInput, any> = async (ctx) => {
    // DELETE endpoint for deleting sessions
    // For now, return 405 Method Not Allowed
    return ctx.text('Method Not Allowed', 405);
  };

  #nodeServer: ReturnType<typeof serve> | null = null;

  /** The bound port — populated after start(). */
  get port(): number | null {
    const addr = this.#nodeServer?.address();
    return addr && typeof addr === 'object' ? addr.port : null;
  }

  async start(): Promise<void> {
    if (this.#nodeServer) {
      throw new Error('already started');
    }
    return new Promise((resolve) => {
      this.#nodeServer = serve(
        {
          fetch: this.#app.fetch,
          hostname: this.#host,
          port: this.#port,
        },
        () => {
          resolve();
        }
      );
    });
  }

  async stop(): Promise<void> {
    if (!this.#nodeServer) {
      return;
    }
    const nodeServer = this.#nodeServer;
    this.#nodeServer = null;
    await new Promise((resolve, reject) => {
      nodeServer.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve(null);
        }
      });
    });
  }
}
