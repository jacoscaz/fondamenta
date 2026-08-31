/**
 * HTTP transport: JsonRpcHttpServer (hono) + McpHttpClient on an
 * ephemeral local port.
 */

import { McpHttpServer } from "@fondamenta/mcp-http-server";
import { McpHttpClient } from "@fondamenta/mcp-http-client";
import { type TransportFactory } from "./suite.js";
import { registerTestTools } from "./server.js";

export const httpTransport: TransportFactory = {
  name: 'http',
  async make() {
    // McpHttpServer extends McpLocalServer, so the tools are registered
    // directly on the instance that serves them.
    const server = new McpHttpServer('127.0.0.1', 0);
    registerTestTools(server);
    await server.start();
    const port = server.port!;
    const client = new McpHttpClient(new URL(`http://127.0.0.1:${port}/mcp`));
    // Fast polling so tests resolve quickly (long-poll wait is short too).
    client.startNotificationPolling(1_000, 1_200);
    return {
      client,
      async close() {
        client.stopNotificationPolling();
        await server.stop();
      },
    };
  },
};
