# @fondamenta/mcp-http-client

HTTP-based MCP client implementation.

## Purpose

Provides a client that communicates with MCP servers via HTTP REST calls. This allows connecting to MCP services that expose HTTP interfaces rather than stdio-based communication.

## Key Components

- **`mcp-client.ts`** — High-level MCP client that translates MCP method calls into HTTP requests
- **`jsonrpc-client.ts`** — Lower-level JSON-RPC client managing request/response correlation and error handling

## Design Philosophy

Complements `lib-mcp-local` (stdio) and `lib-mcp-http-server` (HTTP listener). Together they enable flexible topology: servers can run as HTTP services discovered and called over the network, or as local child processes over stdio.
