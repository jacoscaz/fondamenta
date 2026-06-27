# @fondamenta/mcp-http-server

HTTP server that exposes an MCP interface.

## Purpose

Allows MCP tool implementations to be served over HTTP, making them accessible as network services. This pairs with `lib-mcp-http-client` to enable HTTP-based client/server communication.

## Key Components

- **`mcp-http-server.ts`** — Wraps an MCP server and exposes it via HTTP endpoints
- **`jsonrpc-http-server.ts`** — Lower-level JSON-RPC HTTP server handling request routing and response serialization

## Design Philosophy

Enables different deployment topologies: tools can run embedded (stdio), as local processes, or as distributed HTTP services. The interface is protocol-agnostic—the same MCP server can be wrapped differently depending on deployment needs.
