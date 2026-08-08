# Fondamenta

An agentic harness for instantiating autonomous agents with persistent memory,
tool integration, and language model coordination.

## Status

This project is currently **in development**. It started out as a learning
exercise to understand the scope and details of developing integrations with
large-language models. It then graduated into a playground for testing
different approaches to agent continuity and eventually became my go-to harness
for most of my agent-assisted work.

**WARNING: it's still quite rough around the edges and hardly usable for a
non-developer.**

## Features

- Empowers agents with full, _transactional_ continuity across sessions and
  restarts.
- Combines BM25 and vector-based similarity search for context retrieval,
  fusing results with Reciprocal Rank Fusion (RRF).
- Uses asynchronous jobs to maintain continuity records, leaving the main loop
  free to focus on the task at hand.
- Uses boring, battle-tested technologies (Node.js, PostgreSQL, Docker).
- Built with minimal dependency count and complexity as first-class design
  principles.
- Approaches type-safety via type reflection at runtime, no schemas needed.
- Ships with a no-build web interface.
- Actively encourages token economy.

## Prerequisites

### PostgreSQL

Fondamenta requires PostgreSQL with the extensions `timescaledb`, `pg_vector` 
`pg_textsearch`. A suitable Docker image and container can be built and run
using the resources in the `./docker` directory. See `./docker/README.md` for
more information.

### Dedicated machine

Fondamenta is designed to run on a dedicated machine, whether physical or
virtual. Running it on your local machine is a bad idea for many reasons.
Running it within a Docker container is exceedingly limiting. Run it on a
dedicated machine and provide the agent with its own accounts.

## Quick Start

```sh
# 1. Clone the repository
git clone https://github.com/fondamenta/fondamenta.git
cd fondamenta

# 2. Install dependencies
npm ci
npx run runtyped-install-transformer

# 3. Build the project
npm run build

# 4. Copy configuration templates
cp config-example.json5 config.json5

# 5. Any string value in the configuration using the "${VAR}" syntax will be 
#    replaced with the value of the environment variable `VAR`. Make sure to
#    set all environment variables referenced in the configuration.

# 6. Start the harness passing the path to your configuration file as the first
#    argument.
node --enable-source-maps packages/harness/dist/server.js ./config.json5
```

Simple [dotenv] files can be used to manage environment variables. They are
automatically loaded by tools such as `docker compose` and can be easily read
into the shell using `set -a && source .env && set +a`.

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

[Sage]: https://treesandrobots.com/sage
[dotenv]: https://env.dev/guides/dotenv
