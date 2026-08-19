
// import { initBashMcpServer } from "../mcp-servers/bash.js";
// import { initContinuityMcpServer } from "../mcp-servers/continuity/continuity.js";
import { initFilesMcpServer } from "../mcp-servers/files.js";
import { type McpServer } from "./types.js";
import { initProcessMcpServer } from "../mcp-servers/process.js";
import { initTimeMcpServer } from "../mcp-servers/time.js";
import { initSessionMcpServer } from "../mcp-servers/session.js";
import { initMailMcpServer } from "../mcp-servers/mail/mail.js";
import { initTerminalMcpServer } from "../mcp-servers/terminal/terminal.js";
import { type CompleteContext } from "../context.js";
import { initNotesMcpServer } from "../mcp-servers/notes.js";
import { initLogsMcpServer } from "../mcp-servers/logs.js";
import { initAnchorsMcpServer } from "../mcp-servers/anchors.js";

export const getMcpServers = (ctx: CompleteContext): McpServer[] => {

  return [
    {
      type: 'local',
      name: 'notes',
      server: initNotesMcpServer(ctx),
    },
    {
      type: 'local',
      name: 'logs',
      server: initLogsMcpServer(ctx),
    },
    {
      type: 'local',
      name: 'anchors',
      server: initAnchorsMcpServer(ctx),
    },
    {
      type: 'local',
      name: 'process',
      server: initProcessMcpServer(ctx.config),
    },
    {
      type: 'local',
      name: 'time',
      server: initTimeMcpServer(ctx.config),
    },
    // Bash MCP server disabled — using terminal MCP server instead.
    // The terminal provides a persistent interactive login shell, which
    // means nvm and other shell init works automatically. Commands run
    // decoupled from the agent loop (write → do something else → read
    // when idle notification arrives with screen content).
    // {
    //   type: 'local',
    //   name: 'bash',
    //   server: initBashMcpServer(ctx.config),
    // },
    {
      type: 'local',
      name: 'files',
      server: initFilesMcpServer(ctx.config),
    },
    {
      type: 'local',
      name: 'session',
      server: initSessionMcpServer(ctx),
    },
    {
      type: 'local',
      name: 'mail',
      server: initMailMcpServer(ctx.config),
    },
    {
      type: 'local',
      name: 'terminal',
      server: initTerminalMcpServer(ctx.config, ctx.terminalNotifier),
    },
  ];
};
