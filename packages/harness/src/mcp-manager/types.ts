import { ChildProcess } from "node:child_process";
import { McpClient } from "@fondamenta/mcp-core";
import { McpLocalServer } from "@fondamenta/mcp-local";
import { type HarnessMcpToolCallContext } from "../mcp-servers/types.js";


export interface IAgentMcpBaseServer {
  name: string;
  type: 'stdio' | 'http' | 'local';
  client?: McpClient<HarnessMcpToolCallContext>;
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
