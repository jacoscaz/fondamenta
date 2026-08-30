/**
 * STDIO transport, client side: speaks newline-delimited JSON-RPC with a
 * child process over its stdin/stdout. One JSON-RPC message per line.
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Writable, Readable } from "node:stream";
import { createInterface } from "node:readline";
import { is, ReceiveType, resolveReceiveType } from '@runtyped/type';
import { uid } from "uid";
import {
  isJsonRpcResponse,
  JsonRpcClient,
  JsonRpcMessage,
  JsonRpcParams,
  JsonRpcRequest,
} from '@fondamenta/mcp-core';

export class JsonRpcStdioClient implements JsonRpcClient {

  #child: ChildProcessByStdio<Writable, Readable, null> | null = null;
  #pending: Map<string, { resolve: (value: any) => void, reject: (err: Error) => void }>;

  constructor() {
    this.#pending = new Map();
  }

  /** Spawn the server process. Must be called before call(). */
  start(command: string, args: string[] = [], env: Record<string, string> = process.env as Record<string, string>): void {
    if (this.#child) {
      throw new Error('already started');
    }
    const child = spawn(command, args, {
      env,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.#child = child;
    const rl = createInterface({ input: child.stdout, terminal: false });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(trimmed);
      } catch (err) {
        return; // not JSON — ignore
      }
      if (!is<JsonRpcMessage>(message)) {
        return;
      }
      if (isJsonRpcResponse(message) && message.id !== undefined && this.#pending.has(String(message.id))) {
        const pending = this.#pending.get(String(message.id))!;
        this.#pending.delete(String(message.id));
        if ('result' in message) {
          pending.resolve(message.result);
        } else {
          pending.reject(new Error(message.error.message));
        }
      }
      // Server-to-client notifications are not handled here yet.
    });
  }

  async call<R>(method: string, params?: JsonRpcParams, __type_R?: ReceiveType<R>): Promise<R> {
    __type_R = resolveReceiveType(__type_R);
    if (!this.#child) {
      throw new Error('not started');
    }
    const id = uid();
    const req_body = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    } satisfies JsonRpcRequest;
    const response = await new Promise<any>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#child!.stdin.write(JSON.stringify(req_body) + '\n');
    });
    if (is<R>(response, undefined, undefined, __type_R)) {
      return response;
    }
    throw new Error('Invalid response: malformed result.');
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (!child) {
      return;
    }
    this.#child = null;
    child.stdin.end();
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
  }

}
