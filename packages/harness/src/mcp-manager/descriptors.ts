
import { initShellMcpServer } from "../mcp-servers/shell.js";
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
import { initTodosMcpServer } from "../mcp-servers/todos.js";
import { initLogsMcpServer } from "../mcp-servers/logs.js";
import { initAnchorsMcpServer } from "../mcp-servers/anchors.js";

export const getMcpServers = (ctx: CompleteContext): McpServer[] => {

  return [
    {
      type: 'local',
      name: 'notes',
      safe: true,
      server: initNotesMcpServer(ctx),
    },
    {
      type: 'local',
      name: 'todos',
      safe: true,
      server: initTodosMcpServer(ctx),
    },
    {
      type: 'local',
      name: 'logs',
      safe: true,
      server: initLogsMcpServer(ctx),
    },
    {
      type: 'local',
      name: 'anchors',
      safe: true,
      server: initAnchorsMcpServer(ctx),
    },
    {
      type: 'local',
      name: 'process',
      safe: true,
      server: initProcessMcpServer(ctx.config),
    },
    {
      type: 'local',
      name: 'time',
      safe: true,
      server: initTimeMcpServer(ctx.config),
    },
    {
      type: 'local',
      name: 'shell',
      server: initShellMcpServer(ctx.config),
    },
    {
      type: 'local',
      name: 'files',
      server: initFilesMcpServer(ctx.config),
    },
    {
      type: 'local',
      name: 'session',
      safe: true,
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
      server: initTerminalMcpServer(ctx.config, ctx),
    },
  ];
};
