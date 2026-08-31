
import { McpLocalServer } from "@fondamenta/mcp-local";
import { JsonRpcHttpServer } from "./jsonrpc-http-server.js";

export class McpHttpServer extends McpLocalServer {

  #server: JsonRpcHttpServer;

  constructor(host: string = '127.0.0.1', port: number = 3333) {
    super();
    this.#server = new JsonRpcHttpServer(host, port, this);
  }

  async start() {
    await this.#server.start();
  }

  async stop() {
    await this.#server.stop();
  }

  get port(): number | null {
    return this.#server.port;
  }

}
