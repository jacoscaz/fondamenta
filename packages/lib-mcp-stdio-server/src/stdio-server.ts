/**
 * STDIO transport, server side: newline-delimited JSON-RPC over the
 * process's stdin/stdout. Serves a McpLocalServer so any local server can
 * be exposed over stdio by pointing this binary at it.
 *
 * Wire protocol: one JSON-RPC message per line (newline-delimited JSON).
 * Requests get a response line; notifications get nothing (per JSON-RPC 2.0).
 */

import { createInterface } from "node:readline";
import { McpLocalServer } from "@fondamenta/mcp-local";
import {
  isJsonRpcNotification,
  isJsonRpcRequest,
  JsonRpcErrorResponse,
  JsonRpcResultResponse,
  JsonRpcStandardErrorCodes,
} from "@fondamenta/mcp-core";
import { errToString } from "@fondamenta/utils";

export class StdioServer<C extends { [key: string]: any } = {}> {

  #local: McpLocalServer<C>;
  #write: (line: string) => void;

  constructor(local: McpLocalServer<C>, write: (line: string) => void = (line) => process.stdout.write(line + '\n')) {
    this.#local = local;
    this.#write = write;
  }

  handleMessage = async (message: any): Promise<void> => {
    if (isJsonRpcRequest(message)) {
      try {
        const result = await this.#local.onRequest(message.method, message.params, undefined as any);
        const response: JsonRpcResultResponse = {
          jsonrpc: '2.0',
          id: message.id,
          result,
        };
        this.#write(JSON.stringify(response));
      } catch (err) {
        const response: JsonRpcErrorResponse = {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: JsonRpcStandardErrorCodes.InternalError,
            message: errToString(err, true),
          },
        };
        this.#write(JSON.stringify(response));
      }
    } else if (isJsonRpcNotification(message)) {
      await this.#local.onNotification(message.method, message.params, undefined as any);
    }
    // Anything else is malformed; per JSON-RPC 2.0, silently ignore.
  };

}

/**
 * Wire a StdioServer to process.stdin (line-delimited) / process.stdout.
 * The returned promise resolves only when stdin closes.
 */
export const serveStdio = <C extends { [key: string]: any } = {}>(local: McpLocalServer<C>): Promise<void> => {
  const server = new StdioServer<C>(local);
  const rl = createInterface({ input: process.stdin, terminal: false });
  return new Promise((resolve) => {
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(trimmed);
      } catch (err) {
        return; // bad JSON on a line — ignore, nothing to respond to
      }
      void server.handleMessage(message);
    });
    rl.on('close', () => resolve());
  });
};
