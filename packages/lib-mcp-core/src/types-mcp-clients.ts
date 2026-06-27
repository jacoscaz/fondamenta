import {
  type McpToolCallContext,
  type McpInitializeParams,
  type McpInitializeResult,
  type McpToolCallResult,
  type McpToolListResult,
} from "./types-mcp.js";

export interface McpClient<C extends McpToolCallContext = {}> {
  initialize(params: McpInitializeParams): Promise<McpInitializeResult>;
  list(): Promise<McpToolListResult>;
  call(tool: string, args: any, ctx: C): Promise<McpToolCallResult>;
}
