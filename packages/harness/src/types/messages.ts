
import {
  ImageBlock,
  RefusalBlock,
  TextBlock,
  ThinkingBlock,
  ThinkingRedactedBlock,
  UnsupportedBlock,
  VoiceBlock,
} from "./blocks.js";

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
  contact?: string; // TODO
}

export interface UserNotification extends BaseMessage {
  role: 'user';
  type: 'notification';
  method: string;
  blocks: UserBlock[];
  contact?: string; // TODO
}

export interface UserToolResult extends BaseMessage {
  role: 'user';
  type: 'tool_res';
  req_id: string;
  blocks: UserBlock[];
  tool: string;
  params: any;
}

export interface UserToolError extends BaseMessage {
  role: 'user';
  type: 'tool_err';
  req_id: string;
  blocks: TextBlock[]; // errors are harness-generated text, never images
  tool: string;
  params: any;
}

export type UserMessage =
  | UserInput
  | UserNotification
  | UserToolError
  | UserToolResult
  ;

export interface AgentOutput extends BaseMessage {
  role: 'agent';
  type: 'message';
  blocks: AgentBlock[];
}

export interface AgentToolRequest extends BaseMessage {
  role: 'agent';
  type: 'tool_req';
  req_id: string;
  tool: string;
  params: any;
}

export type AgentMessage = AgentOutput | AgentToolRequest;

export type Message = UserMessage | AgentMessage;
