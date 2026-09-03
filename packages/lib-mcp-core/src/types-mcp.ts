import { JsonRpcParams } from "./types-jsonrpc.js";

export interface McpInitializeParams {
  protocolVersion: string;
  capabilities: {
    [key: string]: any;
    // elicitation: {};
  };
  clientInfo: {
    name: string;
    version: string;
  };
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools: {
      listChanged: boolean;
    };
    resources: {};
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

export interface McpToolCallContext {

}

export interface McpToolsCallParams {
  name: string;
  arguments: any;
}

export type McpContentBlock = {
  type: 'text';
  text: string;
} | {
  /**
   * An image content block, base64-encoded. Typically produced by tools that
   * process visual media (screenshots, image files) after normalization via
   * sharp (resize + recompress) to bound the token cost of the payload.
   */
  type: 'image';
  /** MIME type of the encoded image, e.g. `image/jpeg`, `image/webp`. */
  mimeType: string;
  /** Base64-encoded image bytes (without data-URL prefix). */
  data: string;
};

/**
 * Result of a tools/call request, per the MCP spec: the content blocks
 * plus an `isError` flag. Tool EXECUTION errors are reported as normal
 * results with `isError: true`; JSON-RPC error responses are reserved
 * for PROTOCOL errors (unknown tool, invalid arguments, ...).
 */
export interface McpToolCallResult {
  content: McpContentBlock[];
  isError: boolean;
}

export interface McpToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: any;
}

export interface McpToolListResult {
  tools: McpToolDescriptor[];
}

export interface McpNotification {
  method: string;
  params: JsonRpcParams;
}
