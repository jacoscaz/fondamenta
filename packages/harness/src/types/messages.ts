
import {
  type ImageBlock,
  type RefusalBlock,
  type TextBlock,
  type ThinkingBlock,
  type ThinkingRedactedBlock,
  type UnsupportedBlock,
  type VoiceBlock,
} from "./blocks.js";

import {
  type Contact,
} from "./contacts.js";

import {
  type UserNotification,
} from "./notifications.js";

export type UserBlock =
  | TextBlock
  | VoiceBlock
  | ImageBlock
  ;

export type AgentBlock =
  | TextBlock
  | UnsupportedBlock
  | RefusalBlock
  | ThinkingBlock
  | ThinkingRedactedBlock
  ;

export interface BaseMessage {
  role: 'user' | 'agent';
  type: string;
}

export interface UserInput extends BaseMessage {
  role: 'user';
  type: 'input';
  blocks: UserBlock[];
  contact?: Contact;
}

export interface UserToolResult extends BaseMessage {
  role: 'user';
  type: 'tool_res';
  results: {
    req_id: string;
    blocks: UserBlock[];
    tool: string;
  }[];
}

export type UserMessage =
  | UserInput
  | UserNotification
  | UserToolResult
  ;

export interface AgentInput extends BaseMessage {
  role: 'agent';
  type: 'input';
  blocks: AgentBlock[];
}

export interface AgentToolRequest extends BaseMessage {
  role: 'agent';
  type: 'tool_req';
  requests: {
    req_id: string;
    tool: string;
    params: any;
  }[];
}

export type AgentMessage = AgentInput | AgentToolRequest;

export type Message = UserMessage | AgentMessage;
