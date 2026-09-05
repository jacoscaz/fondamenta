
import { McpNotification } from "./types-mcp.js";

export interface TelegramTransport {
  type: 'telegram';
  chat_id: number;
  from_id: number;
  username?: string;
}

export interface EmailTransport {
  type: 'email';
  from: { address: string; name?: string | null; };
}

export interface VerifiedContact {
  id: number;
  name: string;
  guidance: string;
}

export interface TextContent {
  type: 'text';
  subject?: string;
  text: string;
}

export interface VoiceContent {
  type: 'voice';
  subject?: string;
  path: string;
}

export interface Transcription {
  text: string;
  time?: number;
  language?: string | null;
  transcriber?: string | null;
}

export interface TranscriptionError {
  error: string;
}

export interface McpNewMessageNotification extends McpNotification {
  method: 'message/new';
  params: {
    content: TextContent | VoiceContent;
    contact?: VerifiedContact | null;
    transport: TelegramTransport | EmailTransport;
    transcription?: Transcription | TranscriptionError | null;
  };
}
