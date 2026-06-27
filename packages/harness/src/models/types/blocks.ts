
export interface BaseBlock {
  type: string;
}

export interface ToolUseRequestBlock extends BaseBlock {
  type: 'tool_use_req';
  req_id: string;
  tool: string;
  params: any;
}

export interface ToolUseResultBlock extends BaseBlock {
  type: 'tool_use_res';
  req_id: string;
  result: (TextBlock)[];
  tool: string;
  params: any;
}

export interface ToolUseErrorBlock extends BaseBlock {
  type: 'tool_use_err';
  req_id: string;
  error: (TextBlock)[];
  tool: string;
  params: any;
}

export interface TextBlock extends BaseBlock {
  type: 'text';
  text: string;
}

export interface RefusalBlock extends BaseBlock {
  type: 'refusal';
  text: string;
}

export interface ThinkingRedactedBlock extends BaseBlock {
  type: 'thinking_redacted';
  text: string;
}

export interface ThinkingBlock extends BaseBlock {
  type: 'thinking';
  text: string;
  anthropic_signature?: string;
}

export interface UnsupportedBlock extends BaseBlock {
  type: 'unsupported';
  text: string;
}

export type MessageBlock =
  | TextBlock
  | RefusalBlock
  | ToolUseRequestBlock
  | ToolUseResultBlock
  | ToolUseErrorBlock
  | ThinkingBlock
  | ThinkingRedactedBlock
  | UnsupportedBlock
  ;
