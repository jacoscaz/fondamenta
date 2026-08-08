#!/usr/bin/env node

import pinetto from 'pinetto';

import { getDB } from "./database/client.js";
import { getConfigFromProcessArgv } from "./config/config.js";
import { WebUIServer } from "./webui/server.js";
import { PromptManager } from "./prompts/manager.js";
import { SessionRepository } from "./sessions/repository.js";
import { RunnerRegistry } from "./sessions/registry.js";
import { MailNotifier } from "./mail/notifier.js";
import { ActivationGate } from "./activation/gate.js";
import { Compactor } from "./sessions/compactor.js";
import { migrateToLatest } from './database/migrator.js';
import { Emygdala } from './emygdala/emygdala.js';
import { Distiller } from './sessions/distiller.js';
import { Embedder } from './sessions/embedder.js';
import { InitContext, type CompleteContext } from './context.js';
import { IOManager } from './io/manager.js';
import { RootMcpManager } from './mcp-manager/manager.js';
import { ModelManager } from './models/manager.js';

const config = await getConfigFromProcessArgv();

// Main logger
const logger = pinetto({ level: config.logging.level });

// Shared database client
const db = getDB(config);

// Run migrations before anything else
await migrateToLatest(db, logger.child('[db:migrations]'));

const init_context: InitContext = {
  db,
  logger,
  config,
  getCompleteContext: () => complete_context,
};

const complete_context: CompleteContext = {
  db,
  init: init_context,
  logger,
  config,
  emygdala: new Emygdala(init_context),
  mailNotifier: new MailNotifier(init_context),
  activationGate: new ActivationGate(init_context),
  compactor: new Compactor(init_context),
  distiller: new Distiller(init_context),
  embedder: new Embedder(init_context),
  managers: {
    io: new IOManager(init_context),
    mcp: new RootMcpManager(init_context),
    models: new ModelManager(init_context),
    prompts: new PromptManager(init_context),
    sessions: new SessionRepository(init_context),
    runners: new RunnerRegistry(init_context),
  },
};

await complete_context.managers.models.initialize();
await complete_context.distiller.initialize(300_000);
await complete_context.embedder.initialize(60_000);
await complete_context.managers.mcp.initialize();
await complete_context.mailNotifier.initialize(120_000);
complete_context.activationGate.initialize();

// Resolve the main session and ensure its runner is alive
const main_session_id = await complete_context.managers.sessions.getOrCreateMain();
const main_runner = complete_context.managers.runners.ensure(main_session_id);
main_runner.run();
logger.info('main session %d is live', main_session_id);

const webui_server = new WebUIServer(init_context);

const onProcessExit = (signal: 'SIGTERM' | 'SIGINT') => {
  logger.warn('Received signal %s, shutting down...', signal);
  webui_server.close();
  complete_context.mailNotifier.stop();
  complete_context.activationGate.stop();
};

process.on('beforeExit', onProcessExit);
process.on('SIGTERM', onProcessExit);
process.on('SIGINT', onProcessExit);
