
import { McpNotification } from "@fondamenta/mcp-core";
import { TelegramVoiceMessageNotification } from "@fondamenta/mcp-telegram/dist/types/notifications.js";

export interface TranscriptionReadyNotification extends McpNotification {
  method: 'transcription/ready';
  params: {
    source: TelegramVoiceMessageNotification;
    text: string;
    language?: string;
    duration: number;
    transcriber: string;
  };
};

export type TranscriptionNotification = TranscriptionReadyNotification;
