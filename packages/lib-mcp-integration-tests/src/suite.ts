/**
 * Transport-agnostic MCP integration test suite.
 *
 * The SAME tests must run against all three transports: in-process (local),
 * stdio, and http. The suite verifies compatibility BETWEEN the libraries —
 * that client and server agree on wire format and semantics through every
 * transport. Anything missing for these basics in any transport gets
 * implemented alongside these tests.
 *
 * A `TransportFactory` spawns (or instantiates) a server exposing a small
 * fixed set of test tools, and returns a client connected to it. The suite
 * is written only in terms of the `McpClient` interface.
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { type McpClient, type JsonRpcNotification } from "@fondamenta/mcp-core";
import { makeTestServer } from "./server.js";

export interface TransportHandle {
  client: McpClient;
  /** Release transport resources (stop server, kill child, close port). */
  close(): Promise<void>;
}

export interface TransportFactory {
  name: string;
  make(): Promise<TransportHandle>;
}

export const runSuite = (factory: TransportFactory) => {

  describe(`MCP integration suite — ${factory.name}`, () => {

    let handle: TransportHandle;

    before(async () => {
      handle = await factory.make();
    });

    after(async () => {
      await handle.close();
    });

    it('initialize returns protocol version and server info', async () => {
      const result = await handle.client.initialize({
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'integration-tests', version: '0.0.1' },
      });
      assert.ok(result.serverInfo && typeof result.serverInfo.name === 'string');
      assert.ok(result.capabilities && 'tools' in result.capabilities);
      // Spec: the lifecycle closes with the initialized notification.
      await handle.client.initialized();
    });

    it('lists tools with descriptors', async () => {
      const { tools } = await handle.client.list();
      assert.ok(Array.isArray(tools));
      const names = tools.map((t) => t.name).sort();
      assert.deepEqual(names, ['echo', 'fail', 'ping']);
      const echo = tools.find((t) => t.name === 'echo')!;
      assert.equal(echo.title, 'Echo');
      assert.equal(typeof echo.description, 'string');
      assert.ok(echo.inputSchema, 'descriptor carries an input schema (spec camelCase)');
    });

    it('calls a tool and gets the spec-shaped result', async () => {
      const result = await handle.client.call('echo', { message: 'hello' }, {});
      assert.equal(result.isError, false);
      assert.deepEqual(result.content, [{ type: 'text', text: 'hello' }]);
    });

    it('tool result round-trips non-ASCII payloads', async () => {
      const result = await handle.client.call('echo', { message: 'ħéłłø wörld ✓' }, {});
      assert.deepEqual(result.content, [{ type: 'text', text: 'ħéłłø wörld ✓' }]);
    });

    it('rejects unknown tool with a protocol error', async () => {
      await assert.rejects(
        () => handle.client.call('no-such-tool', {}, {}),
        /unknown tool/i,
      );
    });

    it('rejects invalid tool parameters with a protocol error', async () => {
      await assert.rejects(
        () => handle.client.call('echo', { wrong: 'shape' }, {}),
        /invalid parameters/i,
      );
    });

    it('tool execution error is an isError result, not a protocol error', async () => {
      // Per spec: execution errors belong in the result body with
      // isError: true; JSON-RPC errors are reserved for protocol errors.
      const result = await handle.client.call('fail', {}, {});
      assert.equal(result.isError, true);
      assert.ok(result.content.length > 0);
      assert.match(result.content[0].type === 'text' ? result.content[0].text : '', /deliberate/i);
    });

    it('delivers a notification emitted by a tool call', async () => {
      const received: JsonRpcNotification[] = [];
      handle.client.onNotification((n) => received.push(n));
      // The ping tool emits `test/ping` server-side as a side effect.
      const result = await handle.client.call('ping', {}, {});
      assert.deepEqual(result.content, [{ type: 'text', text: 'pinged' }]);
      // Local transport: synchronous. Wire transports: delivered by the
      // next drain/readline flush. Either way, well within 5 seconds.
      const deadline = Date.now() + 5_000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(received.length, 1);
      assert.equal(received[0].method, 'test/ping');
      assert.deepEqual(received[0].params, { source: 'ping-tool' });
    });

    it('notification handlers that throw do not break delivery', async () => {
      const received: JsonRpcNotification[] = [];
      handle.client.onNotification(() => {
        throw new Error('broken handler');
      });
      handle.client.onNotification((n) => received.push(n));
      await handle.client.call('ping', {}, {});
      const deadline = Date.now() + 5_000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(received.some((n) => n.method === 'test/ping'));
    });

  });

};
