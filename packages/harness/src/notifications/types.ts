
// === DEEP-DIST IMPORTS ===
// The version of `@runtyped` libraries is unable to import runtime reflections
// of TS types across package boundaries. Deep-dist imports sidestep the issue.
//
// See: https://github.com/runtyped/runtyped/issues/11
import { McpNotification } from '@fondamenta/mcp-core/dist/types-mcp.js';
import { JMAPNotification } from '@fondamenta/mcp-jmap/dist/types/notifications.js';
import { TelegramNotification } from '@fondamenta/mcp-telegram/dist/types/notifications.js';

import { TranscriptionNotification } from '../mcp-servers/transcription/types.js';
import { DueTodoNotification } from '../mcp-servers/continuity/types.js';


/**
  * Represents errors during the processing of other notifications
  */
export interface ProcessingErrorNotification extends McpNotification {
  method: 'processing/error';
  params: {
    error: string;
  };
};

/**
 * The union of all possible notifications, both internal (produced by the
 * harnesss itself) and external (produced by MCP servers).
 */
export type HarnessNotification =
  // External notifications
  | DueTodoNotification
  | TelegramNotification
  | JMAPNotification
  | TranscriptionNotification
  // Internal notifications
  | ProcessingErrorNotification
  ;

export type HarnessNotificationMethod = HarnessNotification['method'];
