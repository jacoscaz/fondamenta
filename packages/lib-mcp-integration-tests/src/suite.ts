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
import { type McpClient } from "@fondamenta/mcp-core";
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
        protocolVersion: '2026-03-26',
        capabilities: {},
        clientInfo: { name: 'integration-tests', version: '0.0.1' },
      });
      assert.ok(result.serverInfo && typeof result.serverInfo.name === 'string');
      assert.ok(result.capabilities && 'tools' in result.capabilities);
    });

    it('lists tools with descriptors', async () => {
      const { tools } = await handle.client.list();
      assert.ok(Array.isArray(tools));
      const names = tools.map((t) => t.name).sort();
      assert.deepEqual(names, ['echo', 'fail']);
      const echo = tools.find((t) => t.name === 'echo')!;
      assert.equal(echo.title, 'Echo');
      assert.equal(typeof echo.description, 'string');
      assert.ok(echo.input_schema, 'descriptor carries an input schema');
    });

    it('calls a tool and gets the result', async () => {
      const result = await handle.client.call('echo', { message: 'hello' }, {});
      assert.deepEqual(result, [{ type: 'text', text: 'hello' }]);
    });

    it('tool result round-trips non-ASCII payloads', async () => {
      const result = await handle.client.call('echo', { message: 'ħéłłø wörld ✓' }, {});
      assert.deepEqual(result, [{ type: 'text', text: 'ħéłłø wörld ✓' }]);
    });

    it('rejects unknown tool with an error', async () => {
      await assert.rejects(
        () => handle.client.call('no-such-tool', {}, {}),
        /unknown tool/i,
      );
    });

    it('rejects invalid tool parameters with an error', async () => {
      await assert.rejects(
        () => handle.client.call('echo', { wrong: 'shape' }, {}),
        /invalid parameters/i,
      );
    });

    it('propagates tool errors (fail tool)', async () => {
      await assert.rejects(
        () => handle.client.call('fail', {}, {}),
        /deliberate/i,
      );
    });

  });

};
