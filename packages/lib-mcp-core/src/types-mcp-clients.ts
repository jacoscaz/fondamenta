import {
  type McpToolCallContext,
  type McpInitializeParams,
  type McpInitializeResult,
  type McpToolCallResult,
  type McpToolListResult,
} from "./types-mcp.js";
import { type JsonRpcNotification } from "./types-jsonrpc.js";

export interface McpClient<C extends McpToolCallContext = {}> {
  initialize(params: McpInitializeParams): Promise<McpInitializeResult>;
  /**
   * Send the `notifications/initialized` message. Per the MCP spec the
   * client MUST send it after receiving the initialize response, before
   * normal operation. Transports without a client→server notification
   * channel (http drain) may no-op, but must be callable.
   */
  initialized(): Promise<void>;
  list(): Promise<McpToolListResult>;
  call(tool: string, args: any, ctx: C): Promise<McpToolCallResult>;
  /**
   * Register a handler for server-to-client notifications (JSON-RPC
   * requests without a call id). Handlers are invoked in registration
   * order; each handler's errors are swallowed so one bad handler
   * cannot break the notification flow.
   */
  onNotification(handler: (notification: JsonRpcNotification) => void): void;
}
