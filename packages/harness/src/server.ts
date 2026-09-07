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
import { FileManager } from './files/manager.js';
import { MonologueLogger } from './sessions/monologue-logger.js';

import { initJMAPTools } from "./tools/servers/jmap/init.js";
import { initTelegramTools } from './tools/servers/telegram/init.js';
import { initShellTools } from "./tools/servers/shell.js";
import { initFilesMcpServer } from "./mcp-servers/files.js";
import { initProcessTools } from "./tools/servers/process.js";
import { initTimeTools } from "./tools/servers/time.js";
import { initSpeechTools } from "./tools/servers/speech.js";
import { initContinuityTools } from "./tools/servers/continuity.js";
import { initPinningTools } from "./tools/servers/pinning.js";
import { initAnchorsTools } from "./tools/servers/anchors.js";
import { initSessionTools } from "./tools/servers/session.js";
import { initFilesTools } from "./tools/servers/files.js";
import { initSessionMcpServer } from "./mcp-servers/session.js";
import { initTerminalMcpServer } from "./mcp-servers/terminal/terminal.js";
import { initContinuityMcpServer } from "./mcp-servers/continuity/server.js";
import { initPinningMcpServer } from "./mcp-servers/pinning.js";
import { initAnchorsMcpServer } from "./mcp-servers/anchors.js";
import { initSpeechMcpServer } from "./mcp-servers/speech/server.js";
import { ContactsManager } from "./contacts/manager.js";
import { SpeechManager } from "./speech/manager.js";
import { McpLocalClient, McpLocalServer } from '@fondamenta/mcp-local';
import { HarnessMcpToolCallContext } from './types/tools.js';
import { RootToolManager } from './tools/manager.js';

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
  files: new FileManager(init_context),
  contacts: new ContactsManager(init_context),
  speech: new SpeechManager(init_context),
  managers: {
    mcp: new RootMcpManager(init_context),
    tools: new RootToolManager(init_context),
    models: new ModelManager(init_context),
    prompts: new PromptManager(init_context),
    sessions: new SessionManager(init_context),
  },
};

await complete_context.managers.models.initialize();
await complete_context.files.start();
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

initProcessTools(complete_context);

initTimeTools(complete_context);

initSpeechTools(complete_context);

initContinuityTools(complete_context);

initPinningTools(complete_context);

initAnchorsTools(complete_context);

initSessionTools(complete_context);

initFilesTools(complete_context);

complete_context.managers.mcp.register({
  type: 'local',
  name: 'session',
  safe: true,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initSessionMcpServer(complete_context),
  ),
});

initShellTools(complete_context);

complete_context.managers.mcp.register({
  type: 'local',
  name: 'files',
  safe: false,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initFilesMcpServer(config),
  ),
});

initJMAPTools(complete_context);

complete_context.managers.mcp.register({
  type: 'local',
  name: 'terminal',
  safe: false,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initTerminalMcpServer(config, complete_context),
  ),
});

// ────────────────────────────────────────────────────────────────────────
// NOTIFICATION SUBSCRIBER REGISTRATION ORDER IS LOAD-BEARING.
//
// The bus is first-true-wins; 'high' priority UNSHIFTS, so among high
// subscribers the LAST registered runs FIRST. Registration order here:
//   1. telegram  (high)  — emits message/new; consumes message/outgoing
//   2. speech    (high)  — transcribes inbound voice, synthesizes outbound
//   3. contacts  (high)  — decorates inbound with standing
// Runtime chain (reverse of registration among highs):
//   message/new:     contacts → speech → telegram(pass) → session-manager
//   message/outgoing: telegram → speech → session-manager(ignored)
// The session-manager subscribes at default (low) priority during its
// initialize() and is the TERMINAL consumer of message/new (injects and
// stops the chain). Any subscriber that must transform an inbound
// notification before injection MUST be high-priority and registered
// BEFORE session-manager's initialize() runs — which registration order
// above guarantees. See speech/server.ts for the full chain commentary.
// ────────────────────────────────────────────────────────────────────────

initTelegramTools(complete_context);

complete_context.managers.mcp.register({
  type: 'local' as const,
  name: 'speech',
  safe: true,
  client: new McpLocalClient<HarnessMcpToolCallContext>(
    initSpeechMcpServer(complete_context),
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
