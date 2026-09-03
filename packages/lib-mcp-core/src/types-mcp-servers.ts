import {
  type McpNotification,
  type McpContentBlock,
  type McpToolCallContext,
} from "./types-mcp.js";

/**
 * A tool implementation returns bare content blocks (or a plain string,
 * shorthand for a single text block) on success, and throws on
 * execution failure. The wrapper handles the spec envelope.
 */
export type McpToolFnResult = McpContentBlock[] | string;

export interface McpServer<C extends McpToolCallContext = {}> {

  addTool<I>(name: string, title: string, description: string, fn: (params: I, ctx: C) => McpToolFnResult | Promise<McpToolFnResult>): void;
  /** Notify clients */
  notify(notification: McpNotification): void;
  /** Destroy the server */
  destroy?(): void;

}
