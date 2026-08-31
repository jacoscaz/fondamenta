import { McpInitializeParams, McpInitializeResult, McpToolCallResult, McpToolListResult } from "@fondamenta/mcp-core";
import { type JsonRpcNotification } from "@fondamenta/mcp-core";
import { JsonRpcHttpClient } from "./jsonrpc-client.js";

export class McpHttpClient {

  #client: JsonRpcHttpClient;
  #url: URL;
  #notification_handlers: ((notification: JsonRpcNotification) => void)[];
  #poll_timer: ReturnType<typeof setInterval> | null = null;

  constructor(url: URL) {
    this.#url = url;
    this.#client = new JsonRpcHttpClient(url);
    this.#notification_handlers = [];
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
    this.#notification_handlers.push(handler);
  }

  /**
   * Start long-polling GET /mcp for server-to-client notifications.
   * Each drain response dispatches each notification to the registered
   * handlers; a handler's errors are swallowed. The poll request stays
   * open up to `waitMs` server-side, so the interval is effectively the
   * long-poll cycle, not a fixed sampling rate.
   */
  startNotificationPolling(waitMs: number = 25_000, pollIntervalMs: number = 30_000): void {
    if (this.#poll_timer) {
      throw new Error('notification polling already started');
    }
    const poll = async () => {
      try {
        const res = await fetch(this.#url, {
          method: 'GET',
          headers: {
            'x-mcp-wait-ms': String(waitMs),
          },
        });
        if (!res.ok) {
          return;
        }
        const body: unknown = await res.json();
        if (body === null || typeof body !== 'object' || !('notifications' in body)) {
          return;
        }
        const notifications = (body as { notifications: unknown }).notifications;
        if (!Array.isArray(notifications)) {
          return;
        }
        for (const notification of notifications) {
          for (const handler of this.#notification_handlers) {
            try {
              handler(notification as JsonRpcNotification);
            } catch (err) {
              // swallow
            }
          }
        }
      } catch (err) {
        // Network hiccup or server restart: retry on the next tick.
      }
    };
    void poll();
    this.#poll_timer = setInterval(() => void poll(), pollIntervalMs);
  }

  stopNotificationPolling(): void {
    if (this.#poll_timer) {
      clearInterval(this.#poll_timer);
      this.#poll_timer = null;
    }
  }

}
