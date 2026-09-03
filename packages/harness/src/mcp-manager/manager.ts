
import { errToString } from "@fondamenta/utils";
import { Logger } from "pinetto";
import { HarnessMcpServerDescriptor } from "./types.js";
import { McpContentBlock, McpToolDescriptor, McpToolListResult } from "@fondamenta/mcp-core";
import { type InitContext, WithContext } from "../context.js";
import { type HarnessMcpToolCallContext } from "../types/tools.js";
import { cast } from "@runtyped/type";
import { HarnessNotification } from "../notifications/types.js";

type ToolRegistry = Record<string, { name: string, server: HarnessMcpServerDescriptor, desc: McpToolDescriptor }>;

export class McpManager extends WithContext {

  #tools: ToolRegistry;

  constructor(ctx: InitContext, tools: ToolRegistry) {
    super(ctx);
    this.#tools = tools;
  }

  async list(): Promise<McpToolListResult> {
    const tools = Object.values(this.#tools)
      .map(({ name, desc }) => ({ ...desc, name }));
    return { tools };
  }

  /**
   * Whether the given tool's outputs are trusted (i.e., exempt from prompt
   * injection scanning). Trust is a property of the MCP *server* that hosts
   * the tool, not of the tool name.
   */
  isSafeServer(name: string): boolean {
    return this.#tools[name]?.server.safe === true;
  }

  async call(name: string, params: any, ctx: HarnessMcpToolCallContext): Promise<McpContentBlock[]> {
    if (name in this.#tools) {
      const { server, desc } = this.#tools[name];
      const result = await server.client!.call(desc.name, params, ctx);
      // Unwrap the spec result envelope for the harness, which consumes
      // bare content blocks. isError results surface as normal content;
      // the model sees the error text.
      return result.content;
    }
    throw new Error('unknown tool');
  }
}

export class RootMcpManager extends McpManager {

  #tools: Record<string, { name: string, server: HarnessMcpServerDescriptor, desc: McpToolDescriptor }>;
  #logger: Logger;
  #servers: Record<string, HarnessMcpServerDescriptor>;

  constructor(ctx: InitContext) {
    const tools: ToolRegistry = Object.create(null);
    super(ctx, tools);
    this.#logger = ctx.logger.child('[mcp]');
    this.#tools = tools;
    this.#servers = Object.create(null);
  }

  async register(server: HarnessMcpServerDescriptor) {
    await server.client.initialize({
      protocolVersion: '2025-06-18',
      capabilities: { },
      clientInfo: { name: 'fondamenta', version: '0.1.0' },
    });
    await server.client.initialized();
    // Subscribe to server-emitted notifications and route them to the
    // notification bus (Phase II step 3). Same interface for every
    // transport — the manager does not need to know which one speaks.
    server.client.onNotification((notification) => {
      try {
        const _notification = cast<HarnessNotification>(notification);
        this._ctx.buses.notifications.notify(_notification);
      } catch (err) {
        this.#logger.error('notification routing error (%s): %s', server.name, errToString(err));
      }
    });
    const { tools } = await server.client.list();
    tools.forEach((desc) => {
      const name = `mcp_${server.name}_${desc.name}`;
      this.#tools[name] = { name, desc, server };
    });
  }

  blacklist(blacklist: string[]): McpManager {
    const filteredTools = Object.fromEntries(Object.entries(this.#tools).filter(([name]) => {
      return !blacklist.includes(name);
    }));
    return new McpManager(this._ctx.init, filteredTools);
  }

  whitelist(whitelist: string[]): McpManager {
    const filteredTools = whitelist.reduce((acc, name) => {
      if (name in this.#tools) {
        acc[name] = this.#tools[name];
        return acc;
      }
      throw new Error(`unknown tool ${name}`);
    }, Object.create(null) as ToolRegistry);
    return new McpManager(this._ctx.init, filteredTools);
  }


}
