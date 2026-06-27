import { McpLocalServer } from "@fondamenta/mcp-local";
import { Config } from "../config/config.js";
import pinetto from 'pinetto';
import { type HarnessMcpToolCallContext } from "./types.js";

export const registerProcessTools = (mcp_server: McpLocalServer<HarnessMcpToolCallContext>) => {

  mcp_server.addTool<{}>(
    'pid',
    'Get Process PID',
    'Get the process ID of the current process',
    async () => {
      return [{ type: 'text', text: `PID: ${process.pid}` }];
    });

  mcp_server.addTool<{ exit_code: number; }>(
    'exit',
    'Terminate the current process',
    'Terminate the current process with the provided exit code, useful for restarting. Use exit code 0 for regular restarts.',
    async () => {
      setTimeout(() => process.exit(0), 5_000);
      return [{ type: 'text', text: 'Process will be terminated in 5 seconds.' }];
  });

};

export const initProcessMcpServer = (config: Config): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp_server = new McpLocalServer<HarnessMcpToolCallContext>();

  registerProcessTools(mcp_server);

  return mcp_server;

};
