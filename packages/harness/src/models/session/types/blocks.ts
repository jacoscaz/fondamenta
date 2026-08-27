
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
  result: (ContentBlock)[];
  tool: string;
  params: any;
}

export interface ToolUseErrorBlock extends BaseBlock {
  type: 'tool_use_err';
  req_id: string;
  error: (TextBlock)[]; // errors are harness-generated text, never images
  tool: string;
  params: any;
}

export interface TextBlock extends BaseBlock {
  type: 'text';
  text: string;
}

/**
 * An image content block within a tool result. Data is base64-encoded
 * (no data-URL prefix) and has been normalized by the producing tool
 * (resize + recompress via sharp) to bound context cost.
 *
 * NOTE: image content is opaque to regex-based injection guardrails.
 * Attacks can render instructions as pixels; semantic filtering of images
 * is future work (embedding/multimodal guard layer).
 */
export interface ImageBlock extends BaseBlock {
  type: 'image';
  mime_type: string;
  data: string;
}

export type ContentBlock = TextBlock | ImageBlock;

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
  | ImageBlock
  | RefusalBlock
  | ToolUseRequestBlock
  | ToolUseResultBlock
  | ToolUseErrorBlock
  | ThinkingBlock
  | ThinkingRedactedBlock
  | UnsupportedBlock
  ;
