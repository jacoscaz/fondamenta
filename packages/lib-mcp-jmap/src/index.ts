export {
  initJmapMcpServer,
  startJmapNotifier,
  startMailServer,
} from './server.js';
export {
  JmapConfig,
  loadJmapConfig,
} from './config.js';
export {
  JMAPClient,
  type EmailSummary,
  type EmailDetail,
  type Mailbox,
  type EmailAddress,
} from './jmap-client.js';
