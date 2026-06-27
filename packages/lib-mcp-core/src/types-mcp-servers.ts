import { type McpToolCallResult, type McpToolCallContext } from "./types-mcp.js";


export interface McpServer<C extends McpToolCallContext = {}> {

  addTool<I>(name: string, title: string, description: string, fn: (params: I, ctx: C) => McpToolCallResult | Promise<McpToolCallResult>): void;

}
