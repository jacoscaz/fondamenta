/**
 * The reference test server used by every transport in the integration
 * suite. Two tools:
 *  - echo: returns its `message` param as a text block (also exercises
 *    validation by requiring the param).
 *  - fail: throws immediately — the error-propagation case.
 */

import { McpLocalServer } from "@fondamenta/mcp-local";

export const registerTestTools = (server: McpLocalServer) => {
  server.addTool<{ message: string }>(
    'echo',
    'Echo',
    'Returns the message parameter as a text block.',
    async ({ message }) => {
      return [{ type: 'text', text: message }];
    },
  );
  server.addTool<{}>(
    'fail',
    'Fail',
    'Always throws — used to verify error propagation as an isError result.',
    async () => {
      throw new Error('deliberate failure');
    },
  );
  server.addTool<{}>(
    'ping',
    'Ping',
    'Emits a test notification and returns a text block.',
    async () => {
      server.notify('test/ping', { source: 'ping-tool' });
      return 'pinged';
    },
  );
};

export const makeTestServer = (): McpLocalServer => {
  const server = new McpLocalServer();
  registerTestTools(server);
  return server;
};
