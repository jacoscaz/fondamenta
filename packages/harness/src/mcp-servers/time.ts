
import { McpLocalServer } from "@fondamenta/mcp-local";
import { formatCurrentTime } from "../prompts/formatters.js";
import { type Config } from "../config/config.js";
import { type HarnessMcpToolCallContext } from "../types/tools.js";

export const registerTimeTools = (mcp_server: McpLocalServer<HarnessMcpToolCallContext>) => {

  mcp_server.addTool<{}>(
    'get',
    'Get Current Date and Time',
    'Get the current date and time both in local and GMT format. Use this tool to ground truth the current time.',
    async ({}) => {
      return [{ type: 'text', text: formatCurrentTime(new Date()) }];
    },
  );

};

export const initTimeMcpServer = (config: Config): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp_server = new McpLocalServer<HarnessMcpToolCallContext>();

  registerTimeTools(mcp_server);

  return mcp_server;

};
