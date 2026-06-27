
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
