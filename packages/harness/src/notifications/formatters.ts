
import { type TelegramTextMessageNotification } from "@fondamenta/mcp-telegram/src/types/notifications.js";
import { type TranscriptionNotification } from "../mcp-servers/transcription/types.js";
import { type HarnessNotification } from "./types.js";
import { type JMAPNewEmailNotification } from "@fondamenta/mcp-jmap";
import { type McpNotification } from "@fondamenta/mcp-core";
import { type DueTodoNotification } from "../mcp-servers/continuity/types.js";

export const formatNotification = (notification: HarnessNotification): string => {
  const { method } = notification;
  const lines: string[] = [
    `method: ${method}`,
  ];
  switch (method) {
    case 'transcription/ready':
      formatTranscriptionReadyNotification(notification, lines);
      break;
    case 'telegram/text_message':
      formatTelegramTextMessageNotification(notification, lines);
      break;
    case 'jmap/new_email':
      formatJMAPNewEmailNotification(notification, lines);
      break;
    case 'todo/due':
      formatDueTodoNotification(notification, lines);
      break;
    default:
      formatGenericNotification(notification, lines);
  }
  return lines.join('\n');
};

const formatGenericNotification = (notification: McpNotification, lines: string[]) => {
  const { method, params } = notification;
  lines.push(
    `warning: no formatter for method ${method}`,
    `payload: ${JSON.stringify(notification, null, 2)}`,
  );
};

const formatDueTodoNotification = (notification: DueTodoNotification, lines: string[]) => {
  const { method, params: { text } } = notification;
  lines.push(
    `text: ${text}`,
  );
};

const formatJMAPNewEmailNotification = (notification: JMAPNewEmailNotification, lines: string[]) => {
  const { method, params: { text } } = notification;
  lines.push(
    `text: ${text}`,
  );
};

const formatTranscriptionReadyNotification = (notification: TranscriptionNotification, lines: string[]) => {
  const { method, params: { text, language, duration } } = notification;
  lines.push(
    `language: ${language ?? 'n/a'}`,
    `duration: ${duration} ms`,
    `text: ${text}`,
  );
};

const formatTelegramTextMessageNotification = (notification: TelegramTextMessageNotification, lines: string[]) => {
  const { method, params: { text, chat_id, from_id, sender } } = notification;
  lines.push(
    `sender: ${sender}`,
    `chat_id: ${chat_id}`,
    `from_id: ${from_id}`,
    `text: ${text}`,
  );
};
