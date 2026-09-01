# @fondamenta/mcp-stdio-server

Expose an MCP server over standard input/output.

## Purpose

Serves any `McpLocalServer` as a newline-delimited JSON-RPC stream on the process's stdin/stdout, allowing MCP tool implementations to be consumed by external clients that spawn the process — the standard integration surface for tool vendors and external harnesses.

## Key Exports

- **`StdioServer`** — bridges a local MCP server to stdio: requests get response lines, notifications are silent per JSON-RPC 2.0.
- **`serveStdio`** — convenience entry point for one-line serving of a server instance.

## Design Notes

- **Wire protocol:** one JSON-RPC message per line (newline-delimited JSON).
- **Transport symmetry:** pairs with `@fondamenta/mcp-stdio-client`; together they implement the stdio transport alongside the in-process (`mcp-local`) and HTTP transports.
