# @fondamenta/mcp-stdio-client

Consume MCP servers exposed over standard input/output by a child process.

## Purpose

Spawns a child process and speaks newline-delimited JSON-RPC over its stdin/stdout, both at the raw protocol level and through an MCP-flavored client. This is the client half of the stdio transport, pairing with `@fondamenta/mcp-stdio-server`.

## Key Exports

- **`JsonRpcStdioClient`** — process lifecycle plus newline-delimited JSON-RPC: calls, notifications, and notification subscription.
- **`McpStdioClient`** — MCP-flavored wrapper: `initialize`, tool listing, and tool calls against a stdio-served MCP server.

## Design Notes

- **Transport symmetry:** alongside `@fondamenta/mcp-local` (in-process) and `@fondamenta/mcp-http-client` (HTTP+SSE), completes the set of transports available to the harness's MCP manager.
