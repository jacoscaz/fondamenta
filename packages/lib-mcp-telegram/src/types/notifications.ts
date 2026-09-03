
import { McpNotification } from "@fondamenta/mcp-core";

export interface TelegramTextMessageNotification extends McpNotification {
  method: 'telegram/text_message',
  params: {
    text: string;
    sender: string;
    chat_id: number;
    from_id: number;
  };
};

export interface TelegramVoiceMessageNotification extends McpNotification {
  method: 'telegram/voice_message',
  params: {
    path: string;
    sender: string;
    chat_id: number;
    from_id: number;
    duration: number;
  };
};

export type TelegramNotification =
  | TelegramTextMessageNotification
  | TelegramVoiceMessageNotification
  ;
