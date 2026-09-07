#!/usr/bin/env node

import 'dotenv/config';

import pinetto, { datetimeISO, datetimeVoid } from 'pinetto';
import { ProcessWriter } from 'pinetto';

import { getDB } from "./database/client.js";
import { getConfigFromProcessArgv } from "./config/config.js";

import { PromptManager } from "./prompts/manager.js";
import { SessionManager } from "./sessions/manager.js";
import { NotificationBus } from "./notifications/bus.js";

import { Compactor } from "./sessions/compactor.js";
import { migrateToLatest } from './database/migrator.js';
import { Emygdala } from './emygdala/emygdala.js';
import { Distiller } from './sessions/distiller.js';
import { Embedder } from './sessions/embedder.js';
import { InitContext, type CompleteContext } from './context.js';

import { RootMcpManager } from './mcp-manager/manager.js';
import { ModelManager } from './models/manager.js';
import { MonologueLogger } from './sessions/monologue-logger.js';

import { initJmapMcpServer } from "@fondamenta/mcp-jmap";
import { initTelegramMcpServer } from '@fondamenta/mcp-telegram';
import { initShellMcpServer } from "./mcp-servers/shell.js";
import { initFilesMcpServer } from "./mcp-servers/files.js";
import { initProcessMcpServer } from "./mcp-servers/process.js";
import { initTimeMcpServer } from "./mcp-servers/time.js";
import { initSessionMcpServer } from "./mcp-servers/session.js";
import { initTerminalMcpServer } from "./mcp-servers/terminal/terminal.js";
import { initContinuityMcpServer } from "./mcp-servers/continuity/server.js";
import { initPinningMcpServer } from "./mcp-servers/pinning.js";
import { initAnchorsMcpServer } from "./mcp-servers/anchors.js";
import { initTranscriptionMcpServer } from "./mcp-servers/transcription/server.js";
import { initContactsMcpServer } from "./mcp-servers/contacts/server.js";
import { McpLocalClient, McpLocalServer } from '@fondamenta/mcp-local';
import { HarnessMcpToolCallContext } from './types/tools.js';

const config = await getConfigFromProcessArgv();

// Main (ops) logger. Everything that is not a formatted block
// representation of the session stream goes to stderr: stdout is
// reserved for the monologue mirror (see MonologueLogger).
const logger = pinetto({
  level: config.logging.level,
  datetime: config.logging.datetime === false ? datetimeVoid : datetimeISO,
});


logger.info('PID %s', process.pid);
process.title = 'fondamenta';

// Human-facing mirror of the session stream, one entry per block,
// written to its own rotating file. Stdout/stderr stay ops-only.
const monologue = new MonologueLogger({
  dir: config.logging.monologue_dir ?? '/var/log/fondamenta',
});

// Shared database client
const db = getDB(config);

// Run migrations before anything else
await migrateToLatest(db, logger.child('[db:migrations]'));

const init_context: InitContext = {
  db,
  logger,
  monologue,
  config,
  getCompleteContext: () => complete_context,
};

const complete_context: CompleteContext = {
  db,
  init: init_context,
  logger,
  monologue,
  config,
  emygdala: new Emygdala(init_context),
  compactor: new Compactor(init_context),
  distiller: new Distiller(init_context),
  embedder: new Embedder(init_context),
  buses: {
    notifications: new NotificationBus(init_context),
  },
  managers: {
    mcp: new RootMcpManager(init_context),
    models: new ModelManager(init_context),
    prompts: new PromptManager(init_context),
    sessions: new SessionManager(init_context),
  },
};

await complete_context.managers.models.initialize();
await complete_context.managers.sessions.initialize();
await complete_context.emygdala.initialize();
await complete_context.distiller.initialize(300_000);
await complete_context.embedder.initialize(60_000);

// ============================================================================
//                          MCP SERVER REGISTRATION
// ============================================================================

complete_context.managers.mcp.register({
  type: 'local',
  name: 'continuity',
  safe: true,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initContinuityMcpServer(complete_context),
  ),
});

complete_context.managers.mcp.register({
  type: 'local',
  name: 'pinning',
  safe: true,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initPinningMcpServer(complete_context),
  ),
});

complete_context.managers.mcp.register({
  type: 'local',
  name: 'anchors',
  safe: true,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initAnchorsMcpServer(complete_context),
  ),
});

complete_context.managers.mcp.register({
  type: 'local',
  name: 'process',
  safe: true,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initProcessMcpServer(config),
  ),
});

complete_context.managers.mcp.register({
  type: 'local',
  name: 'time',
  safe: true,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initTimeMcpServer(config),
  ),
});

complete_context.managers.mcp.register({
  type: 'local',
  name: 'session',
  safe: true,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initSessionMcpServer(complete_context),
  ),
});

complete_context.managers.mcp.register({
  type: 'local',
  name: 'shell',
  safe: false,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initShellMcpServer(config),
  ),
});

complete_context.managers.mcp.register({
  type: 'local',
  name: 'files',
  safe: false,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initFilesMcpServer(config),
  ),
});

complete_context.managers.mcp.register({
  type: 'local',
  name: 'mail',
  safe: false,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initJmapMcpServer(config.mail),
  ),
});

complete_context.managers.mcp.register({
  type: 'local',
  name: 'telegram',
  safe: false,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initTelegramMcpServer(config.telegram),
  ),
});

complete_context.managers.mcp.register({
  type: 'local',
  name: 'terminal',
  safe: false,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initTerminalMcpServer(config, complete_context),
  ),
});

complete_context.managers.mcp.register({
  type: 'local' as const,
  name: 'transcription',
  safe: true,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initTranscriptionMcpServer(complete_context),
  ),
});

// Contacts server: subscriber-only MCP server (no tools). It enriches
// inbound message/new notifications with contact standing BEFORE the
// session manager sees them. Registered FIRST among the notification
// consumers so its 'high' bus priority is respected relative to
// transcription and session-manager, which subscribe later.
complete_context.managers.mcp.register({
  type: 'local' as const,
  name: 'contacts',
  safe: true,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initContactsMcpServer(complete_context),
  ),
});

// ============================================================================
//                        MAIN SESSION INITIALIZATION
// ============================================================================

// Resolve the main session and ensure its runner is alive
const { main_session_id } = complete_context.managers.sessions;
complete_context.managers.sessions.run(main_session_id);
logger.info('main session %d is live', main_session_id);

// ============================================================================
//                          PROCESS EXIT HANDLING
// ============================================================================

const onProcessExit = (signal: 'SIGTERM' | 'SIGINT') => {
  process.removeListener('beforeExit', onProcessExit);
  process.removeListener('SIGTERM', onProcessExit);
  process.removeListener('SIGINT', onProcessExit);
  logger.warn('Received signal %s, shutting down...', signal);
  db.destroy();
  setTimeout(() => process.exit(0), 1000);
};

process.on('beforeExit', onProcessExit);
process.on('SIGTERM', onProcessExit);
process.on('SIGINT', onProcessExit);
