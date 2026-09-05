
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
  verified: true;
  id: number;
  name: string;
  guidance: string;
}

export interface UnverifiedContact {
  verified: false;
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

export interface TranscriptionSuccess {
  success: true;
  text: string;
  time?: number;
  language?: string | null;
  transcriber?: string | null;
}

export interface TranscriptionError {
  success: false;
  error: string;
}

export interface McpNewMessageNotification extends McpNotification {
  method: 'message/new';
  params: {
    content: TextContent | VoiceContent;
    contact?: VerifiedContact | UnverifiedContact | null;
    transport: TelegramTransport | EmailTransport;
    transcription?: TranscriptionSuccess | TranscriptionError | null;
  };
}
