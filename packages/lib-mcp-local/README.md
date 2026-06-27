# @fondamenta/mcp-local

In-process MCP client and server implementations using a custom pass-through transport.

## Purpose

Enables running MCP servers and clients within the same process. This is the foundation for providing agents with tools through which they can modify their own state and behavior.

## Key Components

- **`server.ts`** — In-process MCP server implementation
- **`client.ts`** — In-process MCP client implementation
- **`tools.ts`** — Tool registration and invocation helpers
