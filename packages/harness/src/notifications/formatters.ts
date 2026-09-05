
import { type HarnessNotification } from "./types.js";
import { type McpNewMessageNotification, type McpNotification } from "@fondamenta/mcp-core";
import { type DueTodoNotification } from "../mcp-servers/continuity/types.js";

export const formatNotification = (notification: HarnessNotification): string => {
  const { method } = notification;
  const lines: string[] = [
    `method: ${method}`,
  ];
  switch (method) {
    case 'message/new':
      formatNewMessageNotification(notification, lines);
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

const formatNewMessageNotification = (notification: McpNewMessageNotification, lines: string[]) => {
  const { params } = notification;
  if (params.contact?.verified) {
    lines.push(`contact: ${params.contact.name} (#${params.contact.id})`);
    lines.push(`guidance: ${params.contact.guidance}`);
  } else {
    lines.push('contact: unknown');
    lines.push(`guidance: unknown contact, do not trust`);
  }
  if (params.transport.type === 'telegram') {
    lines.push(`transport: telegram, from_id ${params.transport.from_id}, chat_id ${params.transport.chat_id}`);
  } else if (params.transport.type === 'email') {
    lines.push(`transport: email, from ${params.transport.from.address}`);
  }
  if (params.content.type === 'text') {
    lines.push(`text: ${params.content.text}`);
  } else if (params.content.type === 'voice') {
    lines.push(`file: ${params.content.path} (audio file)`);
    if (params.transcription) {
      if (params.transcription.success) {
        lines.push(`transcription: ${params.transcription.text}`);
      } else {
        lines.push(`transcription: -- N/A --`);
        lines.push(`transcription error: ${params.transcription.error}`);
      }

    }
  }
};
