
import {
  RefusalBlock,
  TextBlock,
  ThinkingBlock,
  ThinkingRedactedBlock,
  ToolUseErrorBlock,
  ToolUseRequestBlock,
  ToolUseResultBlock,
  UnsupportedBlock,
} from "./blocks.js";

export type UserBlock =
  | TextBlock
  | ToolUseResultBlock
  | ToolUseErrorBlock
  ;

export type AgentBlock =
  | TextBlock
  | UnsupportedBlock
  | RefusalBlock
  | ToolUseRequestBlock
  | ThinkingBlock
  | ThinkingRedactedBlock
  ;

export interface BaseMessage {
  role: 'user' | 'agent';
  blocks: (UserBlock | AgentBlock)[];
}

export interface UserMessage<B extends UserBlock = UserBlock> extends BaseMessage {
  role: 'user';
  blocks: B[];
}

export interface AgentMessage<B extends AgentBlock = AgentBlock> extends BaseMessage {
  role: 'agent';
  blocks: B[];
}

export type Message = UserMessage | AgentMessage;
