# @fondamenta/mcp-core

Type definitions for the MCP (Model Context Protocol) specification.

## Purpose

Provides core TypeScript interfaces and types that define the MCP protocol. This package contains no implementation—purely the shape of the protocol and JSON-RPC communication layer.

## Key Exports

- **`types-mcp.ts`** — Tool descriptors, initialization params, call results, content blocks
- **`types-mcp-clients.ts`** — Client interface contract (what a client must implement)
- **`types-mcp-servers.ts`** — Server interface contract (what a server must implement)
- **`types-jsonrpc.ts`** — JSON-RPC 2.0 message types and helpers
- **`helpers-jsonrpc.ts`** — Utilities for constructing and validating JSON-RPC messages

## Design Philosophy

This package is a **protocol definition layer**. It establishes the contract between MCP clients and servers without prescribing implementation. Other packages (`lib-mcp-local`, `lib-mcp-http-client`, etc.) provide the actual implementations.
