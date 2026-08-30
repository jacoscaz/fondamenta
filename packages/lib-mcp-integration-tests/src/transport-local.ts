/**
 * In-process transport: local server + local client, no wire at all.
 * This is the control group — the same suite over the other transports
 * proves the wire (stdio, http) doesn't distort semantics.
 */

import { McpLocalClient } from "@fondamenta/mcp-local";
import { type TransportFactory } from "./suite.js";
import { makeTestServer } from "./server.js";

export const localTransport: TransportFactory = {
  name: 'in-process',
  async make() {
    const server = makeTestServer();
    const client = new McpLocalClient(server);
    return {
      client,
      async close() {
        /* nothing to release */
      },
    };
  },
};
