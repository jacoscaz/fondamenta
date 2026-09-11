import { Message } from "./types/messages.js";
import { MessageBlock } from "./types/blocks.js";

/**
 * Message projection: the single content-decision layer shared by every
 * consumer that renders the conversation for a non-wire audience
 * (monologue mirror, compactor, distiller).
 *
 * Projection owns WHAT SURVIVES: which blocks and messages a consumer
 * sees, how oversized text and non-text media are represented. It never
 * formats: rendering is serialization's job (see ./serialization.js).
 *
 * Every decision is a declared field of ProjectOptions, instantiated
 * once per profile. A consumer that silently loses content is now a
 * visible diff in its profile object, not an inline `continue`.
 */
export interface ProjectOptions {
  /** Text (and refusal/unsupported) blocks longer than this are truncated. */
  max_text_length: number;
  /** Drop thinking/thinking_redacted blocks entirely. */
  exclude_thinking: boolean;
  /** Drop tool_req/tool_res messages entirely. */
  exclude_tool_traffic: boolean;
  /** How media blocks (image, voice) are represented. */
  media_policy: 'placeholder' | 'omit';
}

export const PROJECT_DISTILLATION_OPTS = {
  max_text_length: 2000,
  exclude_thinking: true,
  exclude_tool_traffic: true,
  // Visible markers over silent omission — the survey showed labeled
  // placeholders are the norm (opencode, pi), and silence was the old
  // defect class this layer exists to end.
  media_policy: 'placeholder',
} satisfies ProjectOptions;

export const PROJECT_COMPACTION_OPTS = {
  max_text_length: 2000,
  exclude_thinking: true,
  exclude_tool_traffic: false,
  media_policy: 'placeholder',
} satisfies ProjectOptions;

export const PROJECT_MONOLOGUE_LOGGING_OPTS = {
  max_text_length: 2000,
  exclude_thinking: false,
  exclude_tool_traffic: false,
  media_policy: 'placeholder',
} satisfies ProjectOptions;

/**
 * Project a whole conversation. Messages dropped by policy (tool traffic
 * under exclude_tool_traffic) are removed here, so downstream consumers
 * never see holes — they see the projected conversation.
 */
export const projectMessages = (messages: Message[], opts: ProjectOptions): Message[] => {
  return messages
    .map(message => projectMessage(message, opts))
    .filter((message): message is Message => message !== null);
};

/**
 * Project one message. Returns null when the whole message is dropped by
 * policy (tool traffic under exclude_tool_traffic); consumers rendering
 * single messages (monologue logger) must handle null.
 */
export const projectMessage = (message: Message, opts: ProjectOptions): Message | null => {
  if (opts.exclude_tool_traffic && (message.type === 'tool_req' || message.type === 'tool_res')) {
    return null;
  }

  switch (message.type) {
    case 'tool_req':
      // Params are projection-opaque: bounded at serialization time.
      return message;

    case 'tool_res':
      return {
        ...message,
        results: message.results.map(result => ({
          ...result,
          blocks: projectBlocks(result.blocks, opts),
        })),
      };

    case 'notification':
      return {
        ...message,
        blocks: projectBlocks(message.blocks, opts),
      };

    case 'input':
      // Narrow by role so each branch's block family matches its message type.
      if (message.role === 'agent') {
        return { ...message, blocks: projectBlocks(message.blocks, opts) };
      }
      return { ...message, blocks: projectBlocks(message.blocks, opts) };
  }
};

/**
 * Projection outputs are always within the input block family's space:
 * pass-through keeps the original block, and every replacement is a
 * TextBlock (a member of both UserBlock and AgentBlock). The internal
 * cast below only bridges the generic parameter, not the type space.
 */
const projectBlocks = <B extends MessageBlock>(blocks: readonly B[], opts: ProjectOptions): B[] => {
  const projected: B[] = [];
  for (const block of blocks) {
    const mapped = projectBlock(block as MessageBlock, opts);
    if (mapped !== null) projected.push(mapped as B);
  }
  return projected;
};

const projectBlock = (block: MessageBlock, opts: ProjectOptions): MessageBlock | null => {
  switch (block.type) {
    case 'text':
      return { ...block, text: truncate(block.text || '', opts.max_text_length) };

    case 'refusal':
      return { ...block, text: truncate(block.text || '', opts.max_text_length) };

    case 'thinking':
    case 'thinking_redacted':
      return opts.exclude_thinking ? null : block;

    case 'image':
      if (opts.media_policy === 'omit') return null;
      return { type: 'text', text: `[image omitted: ${block.mimeType}]` };

    case 'voice':
      if (opts.media_policy === 'omit') return null;
      // A transcription is content: when present it survives as text.
      if (block.transcription) return { type: 'text', text: truncate(block.transcription, opts.max_text_length) };
      return { type: 'text', text: `[voice note omitted: ${block.path}, ${block.duration}s]` };

    case 'unsupported':
      // Unknown content always survives, loudly, in every profile.
      return block;

    default:
      // Block types the projection layer does not know about pass through
      // untouched; the serializer renders them visibly. Silent loss needs
      // a declared policy field; there is none for this case, by design.
      return block;
  }
};

const truncate = (text: string, max: number): string => {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[...truncated ${text.length - max} characters]`;
};
