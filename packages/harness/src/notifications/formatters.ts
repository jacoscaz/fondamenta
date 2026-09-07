
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
  lines.push('--- META ---');
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
  params.content.forEach((block, idx) => {
    lines.push('');
    lines.push(`--- BLOCK #${idx} - TYPE: ${block.type} ---`);
    if (block.type === 'text') {
      lines.push(`text:`);
      lines.push(block.text);
    } else if (block.type === 'file') {
      lines.push(`path: ${block.path}`);
    } else if (block.type === 'voice') {
      lines.push(`path: ${block.path} (audio file)`);
      if (block.transcription) {
        if (block.transcription.success) {
          lines.push(`transcription:`);
          lines.push(block.transcription.text);
        } else {
          lines.push(`transcription error: ${block.transcription.error}`);
        }
      }
    } else {
      // @ts-ignore
      lines.push(`unsupported block type ${block.type}, raw block data:`);
      lines.push(JSON.stringify(block, null, 2));
    }
  });

};
