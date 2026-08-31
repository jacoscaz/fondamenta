
import { spawn } from "node:child_process";
import { Logger } from "pinetto";
import { IAgentMcpHttpServer, IAgentMcpLocalServer, McpServer, IAgentMcpStdioServer } from "./types.js";
import assert from "node:assert";
import { McpContentBlock, McpToolDescriptor, McpToolListResult } from "@fondamenta/mcp-core";
import { McpHttpClient } from "@fondamenta/mcp-http-client";
import { McpLocalClient } from "@fondamenta/mcp-local";
import { InitContext, WithContext } from "../context.js";
import { getMcpServers } from "./descriptors.js";
import { HarnessMcpToolCallContext } from "../types.js";

type ToolRegistry = Record<string, { name: string, server: McpServer, desc: McpToolDescriptor }>;

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

  #tools: Record<string, { name: string, server: McpServer, desc: McpToolDescriptor }>;
  #logger: Logger;
  #servers: Record<string, McpServer>;

  constructor(ctx: InitContext) {
    const tools: ToolRegistry = Object.create(null);
    super(ctx, tools);
    this.#logger = ctx.logger.child('[mcp]');
    this.#tools = tools;
    this.#servers = Object.create(null);
  }

  async #initChild(server: IAgentMcpStdioServer) {
    const child = spawn('/usr/local/bin/node', [server.path], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: server.env,
    });
    child.on('exit', (code, signal) => {
      this.#logger.error(`MCP server ${server.name} exited with code ${code} and signal ${signal}`);
    });
    server.child = child;
    this.#logger.info(`MCP server ${server.name} started`);
  }

  async #initializeAndRegisterTools(server: McpServer) {
    await server.client!.initialize({
      protocolVersion: '2025-06-18',
      capabilities: { },
      clientInfo: { name: 'agency', version: '0.1.0' },
    });
    await server.client!.initialized();
    const { tools } = await server.client!.list();
    tools.forEach((desc) => {
      const name = `mcp_${server.name}_${desc.name}`;
      this.#tools[name] = { name, desc, server };
    });
  }

  async #initStdio(server: IAgentMcpStdioServer) {
    throw new Error('not implemented');
  }

  async #initHttp(server: IAgentMcpHttpServer) {
    server.client = new McpHttpClient(server.url);
    await this.#initializeAndRegisterTools(server);
  }

  async #initLocal(server: IAgentMcpLocalServer) {
    server.client = new McpLocalClient(server.server);
    await this.#initializeAndRegisterTools(server);
  }

  async initialize() {
    for (const server of getMcpServers(this._ctx)) {
      assert(!(server.name in this.#servers), `duplicate server name ${server.name}`);
      this.#servers[server.name] = server;
      switch (server.type) {
        case 'http': await this.#initHttp(server); break;
        case 'stdio': await this.#initStdio(server); break;
        case 'local': await this.#initLocal(server); break;
        default: throw new Error(`unknown server type`);
      }
      this.#logger.info('Initialization of MCP server %s of type %s completed', server.name, server.type);
    }
  }

  async shutdown() {
    await Promise.all(Object.values(this.#servers).map(async (server) => {
      if (server.type === 'stdio') {
        server.child?.kill('SIGKILL');
      }
    }));
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
