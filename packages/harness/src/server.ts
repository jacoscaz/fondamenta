#!/usr/bin/env node

import 'dotenv/config';

import pinetto from 'pinetto';
import { ProcessWriter } from 'pinetto';

import { getDB } from "./database/client.js";
import { getConfigFromProcessArgv } from "./config/config.js";
import { WebUIServer } from "./webui/server.js";
import { PromptManager } from "./prompts/manager.js";
import { SessionManager } from "./sessions/manager.js";
import { MailNotifier } from "./mcp-servers/mail/notifier.js";
import { TodoNotifier } from "./sessions/todo-scheduler.js";
import { Compactor } from "./sessions/compactor.js";
import { migrateToLatest } from './database/migrator.js';
import { Emygdala } from './emygdala/emygdala.js';
import { Distiller } from './sessions/distiller.js';
import { Embedder } from './sessions/embedder.js';
import { InitContext, type CompleteContext } from './context.js';
import { IOManager } from './io/manager.js';
import { RootMcpManager } from './mcp-manager/manager.js';
import { ModelManager } from './models/manager.js';
import { MonologueLogger } from './sessions/monologue-logger.js';

const config = await getConfigFromProcessArgv();

// Main (ops) logger. Everything that is not a formatted block
// representation of the session stream goes to stderr: stdout is
// reserved for the monologue mirror (see MonologueLogger).
const logger = pinetto({ level: config.logging.level, writer: new ProcessWriter('stderr') });

// Human-facing mirror of the session stream, one entry per block.
const monologue = new MonologueLogger(process.stdout);

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
  notifiers: {
    mail: new MailNotifier(init_context),
    todo: new TodoNotifier(init_context),
  },
  managers: {
    io: new IOManager(init_context),
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
await complete_context.notifiers.mail.initialize(120_000);
await complete_context.notifiers.todo.initialize(60_000);

// Resolve the main session and ensure its runner is alive
const { main_session_id } = complete_context.managers.sessions;
complete_context.managers.sessions.run(main_session_id);
logger.info('main session %d is live', main_session_id);

logger.info('PID %s', process.pid);
process.title = 'fondamenta';

const webui_server = new WebUIServer(init_context);

const onProcessExit = (signal: 'SIGTERM' | 'SIGINT') => {
  process.removeListener('beforeExit', onProcessExit);
  process.removeListener('SIGTERM', onProcessExit);
  process.removeListener('SIGINT', onProcessExit);
  logger.warn('Received signal %s, shutting down...', signal);
  webui_server.close();
  complete_context.notifiers.mail.stop();
  complete_context.notifiers.todo.stop();
  db.destroy();
  setTimeout(() => process.exit(0), 1000);
};

process.on('beforeExit', onProcessExit);
process.on('SIGTERM', onProcessExit);
process.on('SIGINT', onProcessExit);
