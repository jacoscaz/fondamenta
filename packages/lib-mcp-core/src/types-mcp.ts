
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
  mime_type: string;
  /** Base64-encoded image bytes (without data-URL prefix). */
  data: string;
};

export type McpToolCallResult = (McpContentBlock)[];

export interface McpToolDescriptor {
  name: string;
  title: string;
  description: string;
  input_schema: any;
}

export interface McpToolListResult {
  tools: McpToolDescriptor[];
}
