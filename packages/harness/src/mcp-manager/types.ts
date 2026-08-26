import { ChildProcess } from "node:child_process";
import { McpClient } from "@fondamenta/mcp-core";
import { McpLocalServer } from "@fondamenta/mcp-local";
import { type HarnessMcpToolCallContext } from "../types.js";


export interface IAgentMcpBaseServer {
  name: string;
  type: 'stdio' | 'http' | 'local';
  client?: McpClient<HarnessMcpToolCallContext>;
  /**
   * Whether this server's outputs can be treated as trusted content by the
   * session's prompt injection guardrails. Set to `true` only for servers
   * whose results are produced by the harness itself (e.g., continuity
   * stores). Servers that relay third-party content (mail, web, files,
   * shell, ...) must leave this undefined/false so their output is scanned.
   */
  safe?: boolean;
};

export interface IAgentMcpHttpServer extends IAgentMcpBaseServer {
  name: string;
  type: 'http';
  url: URL;
}

export interface IAgentMcpStdioServer extends IAgentMcpBaseServer {
  name: string;
  type: 'stdio';
  env: Record<string, string>;
  path: string;
  child?: ChildProcess;
}

export interface IAgentMcpLocalServer extends IAgentMcpBaseServer {
  name: string;
  type: 'local';
  server: McpLocalServer<HarnessMcpToolCallContext>;
}

export type McpServer = IAgentMcpHttpServer | IAgentMcpStdioServer | IAgentMcpLocalServer;
