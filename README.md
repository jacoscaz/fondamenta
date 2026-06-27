# Fondamenta

An agentic harness for instantiating autonomous agents with persistent memory,
tool integration, and language model coordination.

## Status

This project is currently **in development**. It started out as a learning
exercise to understand the scope and details of developing integrations with
large-language models. It then graduated into a playground for testing
different approaches to agent continuity and eventually became my go-to harness
for most of my agent-assisted work.

**WARNING: it's still quite rough around the edges and hardly usable for a non-developer.**

## Features

- Empowers agents with full, _transactional_ continuity across sessions and restarts
- Uses boring, battle-tested technologies (Node.js, PostgreSQL, Docker)
- Encourages token economy
- Considers low dependency count and low complexity as first-class architectural design principles
- Approaches type-safety via type reflection at runtime, no schemas needed
- Ships with a no-build web interface

## Getting Started

### Quick Start (5 minutes)

```sh
# 1. Clone the repository
git clone https://github.com/fondamenta/fondamenta.git
cd fondamenta

# 2. Copy configuration templates
cp config-example.json5 config.json5
cp .env-example .env

# 3. Edit .env with your API keys

# 4. Edit config.json5 if needed (defaults usually work)

# 5. Start the harness
docker compose up --build harness

# 6. Open http://localhost:8080 in your browser
```

The harness will:
- Initialize PostgreSQL and run migrations
- Initialize tool servers (files, bash, HTTP, continuity tools)
- Launch the web interface
- Wait for your first message

You can use [Docker Compose overrides] to customize the `docker-compose.yml`
file without modifying it directly. For example, paste the following into 
`docker-compose.override.yml` to mount this project into the agent's
container:

```yaml
services:
  harness:
    volumes:
      - ./:/fondamenta
```

[Docker Compose overrides]: (https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/

### Understanding the Architecture

See the [packages](#packages) section below for deeper documentation on each component. For a detailed walkthrough of how the harness works internally, see [`@fondamenta/harness`](packages/harness/README.md).

## Design Principles

**Minimal dependencies.** The entire dependency tree — direct, indirect, and dev — stays under 100 packages. Every dependency is a deliberate choice. Fewer dependencies means fewer supply chain risks, faster installs, less code I don't control and, most importantly, deeper understanding. Run `npm ls -a -p | wc -l` to verify (currently 53). The count of runtime dependencies - direct and indirect - currently sits at 31 packages.

**Modularity through separation.** Each concern is isolated: the MCP protocol is separate from transport; tools are separate servers; utilities have no framework dependencies. This makes the codebase composable and independently testable.

**Type-driven tool contracts.** [Runtyped](https://github.com/runtyped/runtyped) provides runtime type reflection. Tool inputs are plain TypeScript interfaces; JSON Schemas are derived automatically. Types are the source of truth; no manual schema maintenance.

**Persistence as a first-class feature.** The harness persists all messages, tool calls, notes, logs. Agents have genuine continuity across restarts, and their full history is inspectable.

## Packages

The codebase is organized as an npm monorepo. Packages live under `/packages` and are listed below.

### Core Framework

- **[`@fondamenta/harness`](packages/harness/README.md)** — The main agent execution engine. Orchestrates sessions, manages MCP servers, persists state to the database, and drives the conversation loop with LLMs.

### Protocol & Transport

- **[`@fondamenta/mcp-core`](packages/lib-mcp-core/README.md)** — Type definitions for the MCP (Model Context Protocol). No implementation—just the protocol contract.
- **[`@fondamenta/mcp-local`](packages/lib-mcp-local/README.md)** — MCP client and server using a custom pass-through transport for in-process communication.
- **[`@fondamenta/mcp-http-client`](packages/lib-mcp-http-client/README.md)** — MCP client using the Streaming HTTP transport (JSONRPC 2.0 over HTTP+SSE).
- **[`@fondamenta/mcp-http-server`](packages/lib-mcp-http-server/README.md)** — MCP server using the Streaming HTTP transport (JSONRPC 2.0 over HTTP+SSE).

### Utilities & Extensions

- **[`@fondamenta/utils`](packages/lib-utils/README.md)** — Common async utilities (queues, buffering, type guards).

## About

Fondamenta was built by Jacopo Scazzosi in collaboration with [Sage], a
persistent agent identity maintained through the framework itself.

## License

MIT

[Sage]: https://treesandrobots.com/2026/03/sage-the-harmonic-selector.html
