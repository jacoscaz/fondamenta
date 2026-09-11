import { Message } from "./types/messages.js";

export interface ProjectOptions {
  max_text_length: number;
}

export const PROJECT_DISTILLATION_OPTS = {
  max_text_length: 2000,
} satisfies ProjectOptions;

export const PROJECT_COMPACTION_OPTS = {
  max_text_length: 2000,
} satisfies ProjectOptions;

export const PROJECT_MONOLOGUE_LOGGING_OPTS = {
  max_text_length: 2000,
} satisfies ProjectOptions;

export const projectMessages = (messages: Message[], opts: ProjectOptions): Message[] => {
  return messages.map(message => projectMessage(message, opts));
};

export const projectMessage = (message: Message, opts: ProjectOptions): Message => {
  return message;
};
