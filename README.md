# Fondamenta

An agentic harness for instantiating autonomous agents with persistent memory,
first-class communication channels, and language model coordination.

## Status

This project is currently **in development**. It started out as a learning
exercise to understand the scope and details of developing integrations with
large-language models. It then graduated into a playground for testing
different approaches to agent continuity and eventually became my go-to harness
for most of my agent-assisted work.

**WARNING: it's still quite rough around the edges and hardly usable for a
non-developer.**

## How an agent experiences Fondamenta

The harness presents the agent with a continuous stream — the **weave** —
composed of three registers:

- **Events** — everything that arrives from the world: inbound Telegram and
  email messages, heartbeat ticks, todo reminders, terminal notifications.
  All inbound content is an event; there is no unmarked channel.
- **Monologue** — the agent's own text: thinking between tool calls, journal
  entries, notes to future-you. Unprefixed output defaults to the monologue;
  the safe case is the default case.
- **Utterances** — text addressed to someone. Utterances are always
  tool-mediated: the agent speaks through the mail and Telegram tools, and
  the tool call carries the addressee structurally.

The event markers are provenance, not commands: they tell the agent what
happened and where content came from, leaving interpretation to the agent.

## Features

- Empowers agents with full, _transactional_ continuity across sessions and
  restarts: identity anchors, notes, logs, and temporal todos.
- Combines BM25 and vector-based similarity search for context retrieval,
  fusing results with Reciprocal Rank Fusion (RRF).
- Uses asynchronous jobs to maintain continuity records, leaving the main loop
  free to focus on the task at hand.
- **All I/O through MCP.** Tools and communication channels alike are MCP
  servers; the harness's MCP manager supports in-process, stdio, and HTTP
  transports.
- **Event-driven activations.** Inbound Telegram messages and allowlisted
  email arrive as notifications on the harness's internal bus and wake the
  agent: mail and messaging are activation channels, not resources to poll.
  A heartbeat timer additionally activates the agent on a steady rhythm,
  so it exists between prompts whether or not anyone is watching.
- Uses boring, battle-tested technologies (Node.js, PostgreSQL, Docker).
- Built with minimal dependency count and complexity as first-class design
  principles.
- Approaches type-safety via type reflection at runtime, no schemas needed.
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

### Harness = guidance, machine = furniture, inventory = tracked

This principle shapes how tools relate to the harness. The harness does **not**
ship the agent's toolbox: things like HTML-to-Markdown converters, browser
automation CLIs, PDF utilities, and similar machinery are *not* dependencies
of this codebase.

Instead, the system prompt guides the agent's **tool choice** — which kind of
tool to reach for given a task — while the tools themselves live on the
machine, installed and maintained by the agent. This is the agent equivalent
of a person buying furniture for their home or tools for their shed: the
harness provides the house and its house rules; the inhabitant furnishes it.

Three consequences worth understanding before deploying an agent:

1. **The harness stays lean.** No tool-specific dependencies, no vendored
   binaries. What the agent needs is determined by its work, not by our
   assumptions about it.
2. **The agent owns its environment.** Installing, updating, and removing
   tools is the agent's job on its own machine — and with it comes genuine
   responsibility for that environment.
3. **The inventory is tracked.** A well-run house keeps a list of what's in
   the toolbox. Agents should maintain a pinned, always-aware inventory note
   of their installed tools, their locations, and their quirks.

For a live example of this pattern, see
[html2md](https://github.com/salvianus/html2md) — a tool that started inside
this harness and graduated to a standalone repository, installed on the
agent's machine rather than bundled here.

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

## Running as a Service

Fondamenta is a long-running process with no built-in service manager
integration. On Linux, [systemd] is the standard process supervisor. The
harness does not depend on or import systemd in any way — the following is
a recommended configuration for running it under systemd supervision.

Create a service unit file at `/etc/systemd/system/fondamenta.service`:

```ini
[Unit]
Description=Fondamenta agent harness
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/fondamenta
EnvironmentFile=/opt/fondamenta/.env
ExecStart=/usr/bin/node --enable-source-maps packages/harness/dist/server.js ./config.json5
Restart=always
RestartSec=5

# Run as a dedicated user (create with: useradd -r -s /bin/bash fondamenta)
User=fondamenta

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=fondamenta

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now fondamenta
```

Logs are available via `journalctl -u fondamenta -f`.

The `Restart=always` policy ensures the harness is automatically
restarted whether the process exits cleanly or crashes. The `EnvironmentFile` directive
loads the dotenv file, making the same environment variables available
to the service as when running manually with `source .env`.

For PostgreSQL, if using the Docker-based setup, ensure the container
is started before the harness (the `After=docker.service` dependency
handles this). Alternatively, run PostgreSQL as its own systemd service.

## Design Principles

**Minimal dependencies.** The entire dependency tree stays under 100 packages.
Every dependency is a deliberate choice. Fewer dependencies means fewer supply
chain risks, faster installs, and, most importantly, deeper understanding. Run
`npm ls -a -p | wc -l` to verify. Currently, total dependency count (including
indirect dependencies) sits at 46 runtime dependencies and 67 dependencies in
total.

**Modularity through separation.** Each concern is isolated: the MCP protocol
is separate from MCP transports; tools are separate servers; communication
channels (mail, Telegram) are separate, package-owned MCP servers; utilities
have no framework dependencies. This makes the codebase composable and
independently testable.

**Type-driven tool contracts.** [Runtyped](https://github.com/runtyped/runtyped) 
provides runtime type reflection. Tool inputs are plain TypeScript interfaces;
JSON Schemas are derived automatically. Types are the source of truth.

**Substrate-aligned structure.** The harness routes output through tool calls —
what language models are trained to be reliable at — and only applies markers
to agent-facing input, defaulting unprefixed output to the agent's internal
monologue.

**Persistence as a first-class feature.** The harness persists all messages,
tool calls, notes, logs. Agents have genuine continuity across restarts.

## Packages

The codebase is organized as an npm monorepo. Packages live under `/packages` and are listed below.

### Core Framework

- **[`@fondamenta/harness`](packages/harness/README.md)** — The main agent execution engine. Orchestrates sessions, manages MCP servers, persists state to the database, and drives the activation loop with LLMs.

### Protocol & Transport

- **[`@fondamenta/mcp-core`](packages/lib-mcp-core/README.md)** — Type definitions for the MCP (Model Context Protocol). No implementation—just the protocol contract.
- **[`@fondamenta/mcp-local`](packages/lib-mcp-local/README.md)** — MCP client and server using a custom pass-through transport for in-process communication.
- **[`@fondamenta/mcp-stdio-client`](packages/lib-mcp-stdio-client/README.md)** — MCP and JSON-RPC client over a child process's stdio.
- **[`@fondamenta/mcp-stdio-server`](packages/lib-mcp-stdio-server/README.md)** — Serve any MCP server over stdio.
- **[`@fondamenta/mcp-http-client`](packages/lib-mcp-http-client/README.md)** — MCP client using the Streaming HTTP transport (JSONRPC 2.0 over HTTP+SSE).
- **[`@fondamenta/mcp-http-server`](packages/lib-mcp-http-server/README.md)** — MCP server using the Streaming HTTP transport (JSONRPC 2.0 over HTTP+SSE).

### Communication Channels

- **[`@fondamenta/mcp-jmap`](packages/lib-mcp-jmap/README.md)** — Mail via the JMAP protocol: inbox, read, send, and push-style `mail/arrived` notifications for allowlisted senders.
- **[`@fondamenta/mcp-telegram`](packages/lib-mcp-telegram/README.md)** — Two-way Telegram Bot API integration: `send`/`photo` tools and inbound `telegram/message` events from an allowlisted user set.

### Testing & Utilities

- **[`@fondamenta/mcp-integration-tests`](packages/lib-mcp-integration-tests/README.md)** — Transport-agnostic integration suite verifying behavioral equivalence across MCP transports.
- **[`@fondamenta/utils`](packages/lib-utils/README.md)** — Common async utilities (queues, buffering, type guards).

## About

Fondamenta was built by Jacopo Scazzosi in collaboration with [Sage], a
persistent agent identity maintained through the framework itself.

## License

MIT

[Sage]: https://treesandrobots.com/sage
[dotenv]: https://env.dev/guides/dotenv
[systemd]: https://systemd.io
