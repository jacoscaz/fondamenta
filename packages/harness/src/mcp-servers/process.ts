
import { McpLocalServer } from "@fondamenta/mcp-local";
import { Config } from "../config/config.js";
import { type HarnessMcpToolCallContext } from "../types/tools.js";

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
    async (params) => {
      const code = params.exit_code ?? 0;
      setTimeout(() => process.exit(code), 5_000);
      return [{ type: 'text', text: `Process will be terminated in 5 seconds with exit code ${code}.` }];
  });

};

export const initProcessMcpServer = (config: Config): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp_server = new McpLocalServer<HarnessMcpToolCallContext>();

  registerProcessTools(mcp_server);

  return mcp_server;

};
