#!/usr/bin/env node

import 'dotenv/config';

import pinetto from 'pinetto';
import { ProcessWriter } from 'pinetto';

import { getDB } from "./database/client.js";
import { getConfigFromProcessArgv } from "./config/config.js";

import { PromptManager } from "./prompts/manager.js";
import { SessionManager } from "./sessions/manager.js";
import { TodoNotifier } from "./sessions/todo-scheduler.js";
import { NotificationBus } from "./sessions/notification-bus.js";
import { initTranscriptionMcpServer } from "./mcp-servers/transcription.js";
import { startMailServer } from "@fondamenta/mcp-jmap";
import { startTelegramServer } from "@fondamenta/mcp-telegram";
import { type JsonRpcParams } from "@fondamenta/mcp-core";
import { Compactor } from "./sessions/compactor.js";
import { migrateToLatest } from './database/migrator.js';
import { Emygdala } from './emygdala/emygdala.js';
import { Distiller } from './sessions/distiller.js';
import { Embedder } from './sessions/embedder.js';
import { InitContext, type CompleteContext } from './context.js';

import { RootMcpManager } from './mcp-manager/manager.js';
import { ModelManager } from './models/manager.js';
import { MonologueLogger } from './sessions/monologue-logger.js';

const config = await getConfigFromProcessArgv();

// Main (ops) logger. Everything that is not a formatted block
// representation of the session stream goes to stderr: stdout is
// reserved for the monologue mirror (see MonologueLogger).
const logger = pinetto({ level: config.logging.level, writer: new ProcessWriter('stderr') });

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

// Mail: the JMAP MCP server owns its tools AND its notifications now
// (mail/arrived, emitted via server.notify → transport → manager → bus).
const mail_server = startMailServer(
  init_context.config.mail,
  (msg: string, ...args: any[]) => logger.child('[mail]').info(msg, ...args),
);

// Telegram: same pattern (telegram/message on incoming allowlisted
// updates). started only if a token is configured.
let telegram_server: ReturnType<typeof startTelegramServer> | null = null;
if (init_context.config.telegram?.api_token) {
  telegram_server = startTelegramServer(
    init_context.config.telegram,
    (msg: string, ...args: any[]) => logger.child('[telegram]').info(msg, ...args),
  );
}

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
  notifiers: {
    todo: new TodoNotifier(init_context),
    bus: new NotificationBus(init_context),
    mail_server: mail_server.server,
    mail: { stop: () => mail_server.stop() },
    telegram_server: telegram_server!.server,
    telegram: { stop: () => telegram_server?.stop() },
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
await complete_context.managers.mcp.initialize();
await complete_context.emygdala.initialize();
await complete_context.distiller.initialize(300_000);
await complete_context.embedder.initialize(60_000);
await complete_context.notifiers.todo.initialize(60_000);

// Transcription MCP server (2026-09-02, refactor per Jacopo): the
// transcription capability is an MCP server, not a dedicated pipeline
// class. It registers as a bus subscriber for audio/available (the
// automatic path) and exposes mcp_transcription_transcribe (the
// manual path). Registration happens after model init so config
// presence decides whether the server exists at all.
if (config.models.transcription) {
  const transcription_server = initTranscriptionMcpServer(complete_context);
  complete_context.notifiers.transcription_server = transcription_server;
  // Subscription face: the bus delivers audio/available payloads to
  // the server's own onNotification (client→server direction, local
  // transport). Tool face is exposed via the MCP descriptors. Emission
  // face: the server's notify() flows through the manager's routing
  // back to the bus like every other server.
  complete_context.notifiers.bus.subscribe('audio/available', {
    name: 'transcription',
    onNotification: (method, params) => transcription_server.onNotification(method, params as JsonRpcParams, {} as never),
  });
  logger.info('transcription server active (%s @ %s) — auto + manual paths', config.models.transcription.options.model, config.models.transcription.options.base_url ?? 'openai-default');
} else {
  logger.info('no transcription model configured — audio notifications discarded at the bus');
}

// Resolve the main session and ensure its runner is alive
const { main_session_id } = complete_context.managers.sessions;
complete_context.managers.sessions.run(main_session_id);
logger.info('main session %d is live', main_session_id);

logger.info('PID %s', process.pid);
process.title = 'fondamenta';

const onProcessExit = (signal: 'SIGTERM' | 'SIGINT') => {
  process.removeListener('beforeExit', onProcessExit);
  process.removeListener('SIGTERM', onProcessExit);
  process.removeListener('SIGINT', onProcessExit);
  logger.warn('Received signal %s, shutting down...', signal);
  complete_context.notifiers.mail.stop();
  complete_context.notifiers.telegram.stop();
  complete_context.notifiers.todo.stop();
  db.destroy();
  setTimeout(() => process.exit(0), 1000);
};

process.on('beforeExit', onProcessExit);
process.on('SIGTERM', onProcessExit);
process.on('SIGINT', onProcessExit);
