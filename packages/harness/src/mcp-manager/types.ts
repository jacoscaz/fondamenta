
// import { type ChildProcess } from "node:child_process";

import { type McpClient } from "@fondamenta/mcp-core";
import { type McpLocalClient } from "@fondamenta/mcp-local";
import { type HarnessMcpToolCallContext } from "../types/tools.js";

export interface BaseHarnessMcpServerDescriptor {
  name: string;
  type: 'stdio' | 'http' | 'local';
  /**
   * Whether this server's outputs can be treated as trusted content by the
   * session's prompt injection guardrails. Set to `true` only for servers
   * whose results are produced by the harness itself (e.g., continuity
   * stores). Servers that relay third-party content (mail, web, files,
   * shell, ...) must leave this undefined/false so their output is scanned.
   */
  safe: boolean;
  client: McpClient<HarnessMcpToolCallContext>;
};

// export interface McpHttpServerDescriptor extends BaseMcpServerDescriptor {
//   name: string;
//   type: 'http';
//   url: URL;
// }

// export interface McpStdioServerDescriptor extends BaseMcpServerDescriptor {
//   name: string;
//   type: 'stdio';
//   env: Record<string, string>;
//   path: string;
//   child?: ChildProcess;
// }

export interface HarnessMcpLocalServerDescriptor extends BaseHarnessMcpServerDescriptor {
  name: string;
  type: 'local';
  /**
   * Local server instance. Parameterized by the harness call context
   * (for continuity tools that need DB/session access); servers that
   * need no context use the default parameterization.
   */
  client: McpLocalClient<HarnessMcpToolCallContext>;
}

export type HarnessMcpServerDescriptor = /* McpHttpServerDescriptor | McpStdioServerDescriptor | */ HarnessMcpLocalServerDescriptor;
