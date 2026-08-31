
import { initShellMcpServer } from "../mcp-servers/shell.js";
// import { initContinuityMcpServer } from "../mcp-servers/continuity/continuity.js";
import { initFilesMcpServer } from "../mcp-servers/files.js";
import { type McpServer } from "./types.js";
import { initProcessMcpServer } from "../mcp-servers/process.js";
import { initTimeMcpServer } from "../mcp-servers/time.js";
import { initSessionMcpServer } from "../mcp-servers/session.js";
import { initJmapMcpServer } from "@fondamenta/mcp-jmap";

import { initTerminalMcpServer } from "../mcp-servers/terminal/terminal.js";
import { type CompleteContext } from "../context.js";
import { initNotesMcpServer } from "../mcp-servers/notes.js";
import { initTodosMcpServer } from "../mcp-servers/todos.js";
import { initPinningMcpServer } from "../mcp-servers/pinning.js";
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
      name: 'pinning',
      safe: true,
      server: initPinningMcpServer(ctx),
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
      // The mail server instance is owned by server.ts's startMailServer
      // (notifier attached); fetch it from the context to avoid a second
      // instance with its own poller. The mail server needs no harness
      // call context, hence the plain McpLocalServer<{}>.
      server: ctx.notifiers.mail_server,
    },
    {
      type: 'local',
      name: 'telegram',
      // Same ownership pattern as mail (server.ts's startTelegramServer).
      server: ctx.notifiers.telegram_server,
    },
    {
      type: 'local',
      name: 'terminal',
      server: initTerminalMcpServer(ctx.config, ctx),
    },
  ];
};
