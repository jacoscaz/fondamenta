
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
  subject?: string | null;
  caption?: string | null;
  path: string;
  /**
   * Audio duration in seconds. Mandatory on every voice block: transport
   * producers (telegram notifier) set it from message metadata, and the
   * speech server sets it from synthesis output. Enforced at the type
   * level — a voice block without a duration is a bug, not a default.
   */
  duration: number;
  transcription?: TranscriptionSuccess | TranscriptionError | null;
}

export interface FileContent {
  type: 'file';
  path: string;
  caption?: string | null;
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
    content: (TextContent | VoiceContent | FileContent)[];
    contact?: VerifiedContact | UnverifiedContact | null;
    transport: TelegramTransport | EmailTransport;
  };
}

/**
 * An outgoing message emitted by a transport server (currently telegram)
 * on behalf of the agent, flowing through the notification bus so that
 * intermediate servers (speech) may transform it before final dispatch.
 *
 * Lifecycle: the transport server emits OutgoingMessage with text blocks;
 * if `synthesize` is true, the speech server replaces text blocks with
 * voice blocks (duration set from synthesis output) and re-emits; the
 * transport server — subscribed after speech — sees the transformed
 * notification and performs the actual API call.
 *
 * The `synthesize` flag is authorship made structural: voice is opt-in
 * per message, never a global default the agent can set and forget.
 */
export interface McpOutgoingMessageNotification extends McpNotification {
  method: 'message/outgoing';
  params: {
    content: (TextContent | VoiceContent)[];
    transport: TelegramTransport;
    /** Text blocks are converted to voice by the speech server before dispatch. */
    synthesize: boolean;
  };
}
