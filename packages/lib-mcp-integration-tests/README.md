# @fondamenta/mcp-integration-tests

Transport-level integration test suite for the MCP implementations.

## Purpose

Exercises the full MCP stack — tool listing, tool calls, validation errors, error propagation, and notifications — across every transport (`mcp-local`, stdio, HTTP) against a shared reference server, so transport implementations can be verified for behavioral equivalence.

## Key Exports

- **`server.ts`** — reference test server (`echo` and `fail` tools) used by every transport under test.
- **`suite.ts`** — the transport-agnostic test suite, run once per transport.
- **`transport-*.ts`** — thin per-transport adapters wiring the suite to each client/server pair.

## Design Notes

- **One suite, many transports.** Behavioral guarantees are defined once; each transport must satisfy the same contract.
- Run with `node --test dist/tests.js` after building.
