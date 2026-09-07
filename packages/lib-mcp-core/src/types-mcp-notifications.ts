
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
  /**
   * Synthesis decoration — the inverse of VoiceContent.transcription.
   * Text blocks are never replaced by voice blocks: the text survives
   * (it is the source; the audio is the derivative), and this property
   * carries the claim state of the synthesis attempt:
   *   - undefined/null: nothing has tried to synthesize yet
   *   - SynthesisError:  the attempt failed; transport delivers as text
   *   - SynthesisResult: the attempt succeeded; transport MAY deliver
   *     the synthesized audio instead of the text (transport's choice)
   */
  synthesis?: SynthesisResult | SynthesisError | null;
}

export interface SynthesisResult {
  success: true;
  path: string;
  /** Audio duration in seconds. Mandatory — same rule as voice blocks. */
  duration: number;
  /** Voice id used, for provenance (e.g. 'bm_fable'). */
  voice?: string | null;
}

export interface SynthesisError {
  success: false;
  error: string;
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
 * if `synthesize` is true, the speech server DECORATES each text block
 * with a `synthesis` property (SynthesisResult on success — path + exact
 * duration — or SynthesisError on failure) and re-emits; the transport
 * server — subscribed after speech — sees the decorated notification and
 * chooses what to send: the synthesized audio when present, the text
 * otherwise. Blocks are never replaced: the text is the source and
 * survives every transform, exactly mirroring how inbound voice blocks
 * carry `transcription` without ceasing to be voice.
 *
 * The `synthesize` flag is authorship made structural: voice is opt-in
 * per message, never a global default the agent can set and forget.
 */
export interface McpOutgoingMessageNotification extends McpNotification {
  method: 'message/outgoing';
  params: {
    content: TextContent[];
    transport: TelegramTransport;
    /**
     * Text blocks are DECORATED with synthesis state by the speech server
     * before dispatch; the transport server chooses text vs audio per block.
     */
    synthesize: boolean;
  };
}
