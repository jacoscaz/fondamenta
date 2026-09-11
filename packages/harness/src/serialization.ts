import { Message } from "./types/messages.js";

export interface SerializeOptions {
  message_separator: string;
}

export const SERIALIZE_DISTILLATION_OPTS = {
  message_separator: '\n---\n',
} satisfies SerializeOptions;

export const SERIALIZE_COMPACTION_OPTS = {
  message_separator: '\n---\n',
} satisfies SerializeOptions;

export const SERIALIZE_MONOLOGUE_LOGGING_OPTS = {
  message_separator: '\n---\n',
} satisfies SerializeOptions;

export const serializeMessages = (messages: Message[], opts: SerializeOptions): string => {
  return messages.map(message => serializeMessage(message, opts)).join(opts.message_separator);
};

export const serializeMessage = (message: Message, opts: SerializeOptions): string => {
  return message.type;
};
