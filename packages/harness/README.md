# @fondamenta/harness

The core agent execution framework. Orchestrates sessions, manages MCP servers, handles database persistence, and drives the conversation loop with language models.

## Quick Start

To run the harness, run the following:

```sh
# 0. Make sure you are in the root directory of the repository

# 1. Configure environment and settings
cp config-example.json5 config.json5
cp .env-example .env
# Edit both files with your API keys and preferences

# 2. Start the harness and its dependencies
docker compose up --build harness

# 3. Access the web interface at http://localhost:8080
```

The harness will:
- Initialize the PostgreSQL database with migrations
- Initialize MCP tool servers (files, bash, notes, logs, continuity tools)
- Launch the web interface
- Begin accepting user input

## How It Works

### The Activation Loop

Each user input triggers an **activation**:

1. **Input** — User message enters the session
2. **Grounding** — Agent queries logs, notes, memories for relevant context
3. **Prompt Assembly** — System prompt is generated with identity anchors, available tools, current state
4. **Model Call** — Language model responds based on prompt + history + available tools
5. **Tool Dispatch** — If model calls tools, the McpServerManager routes them to the right server
6. **Tool Results** — Results are returned to the model
7. **Persistence** — Messages, tool calls, and state are written to the database
8. **Output** — Agent response is sent to the user, ready for the next input

Chains of tool calls are non-blocking: long-running operations do not prevent
user input from reaching the agent.

### Configuration

Configuration lives in `config.json5` (project root). See `config-example.json5` for a complete example.

**Key sections:**

- **`tz`** — Timezone string (e.g., `"UTC"`, `"America/New_York"`). Used for timestamp formatting in logs and prompts.
- **`models`** — Array of LLM configurations. Each model has:
  - `id` — Model identifier (e.g., `"claude-haiku-4-5"`, `"deepseek-ai/DeepSeek-V3.1"`)
  - `provider` — `"anthropic"` or `"togetherai"`
  - `api_key` — API key (use env var placeholders like `"${ANTHROPIC_API_KEY}"`)
  - `default` — Set `true` for the default model used in new sessions
  - `max_output_size` — Maximum tokens the model can generate in one response
  - `max_context_size` — Maximum context window the model supports
  - `description` — Human-readable description (appears in system prompt)
  - `thinking` — (Anthropic and Together AI only) Thinking configuration:
    - `enabled` — Whether to enable extended thinking (`true`/`false`)
    - `budget` — `"adaptive"` (only for Anthropic) or a number (token budget)

- **`postgres`** — Database connection:
  - `hostname`, `port`, `database`, `username`, `password` — PostgreSQL credentials

- **`io`** — MCP tool server communication:
  - `addr`, `port` — Where the internal WebSocket server listens
  - `path` — WebSocket path (default: `"/ws"`)

- **`webui`** — Web interface server:
  - `addr`, `port` — Where the web UI listens (default: `http://localhost:8080`)

- **`logging`** — Log level: `"trace"`, `"debug"`, `"info"`, `"warn"`, `"error"`

Environment variables (`.env`):
- `ANTHROPIC_API_KEY` — Anthropic API key (if using Claude models)
- `TOGETHER_API_KEY` — API key for Together
- `POSTGRES_HOSTNAME`, `POSTGRES_PORT`, `POSTGRES_DATABASE`, `POSTGRES_USERNAME`, `POSTGRES_PASSWORD` — Database credentials
- `TZ` — Timezone (should match `config.json5` tz field)

## Usage

Typically the harness is invoked from `src/server.ts`, which:
1. Initializes the database
2. Spawns MCP tool servers
3. Starts the WebSocket server
4. Listens for client connections
5. Creates sessions on demand and runs the query loop

## Architecture

The harness is structured around a few core concepts:

### SessionManager & SessionRunner (`src/sessions/`)

A continuous conversation is managed through two components:

- **SessionManager** — Handles session lifecycle: creating sessions, inserting messages, retrieving history, model switching, and compaction. It doesn't execute queries; it manages the state.

- **SessionRunner** — Executes the query loop. When a message is inserted, the runner wakes up, queries the model with the accumulated messages, processes tool calls inline, and emits each output message via events. Multiple runners can run concurrently for different sessions.

The runner emits events on the SessionManager for each output message (`session-${id}-message`). The IO Manager subscribes to these events and pushes messages to connected WebSocket clients. This replaces the old AsyncIterable pattern with an event-driven push model.

### MCP Server Management (`src/mcp-manager/`)

The **McpServerManager** orchestrates all tool providers:
- Manages tool servers (files, bash, continuity, custom tools)
- Registers all available tools and maps tool calls to the right server
- Deduplicates tool names across servers to prevent conflicts

### Database (`src/database/`)

Persistent storage for:
- **Sessions** — Conversation metadata and state
- **Messages** — Full conversation history (user input, model responses, tool calls/results)
- **Notes** — Structured working memory that persists across sessions
- **Logs** — Low-friction operational stream (decisions, milestones, observations)
- **Identity Anchors** — Persistent identity foundations
- **Checkpoints** — Compaction snapshots

Migrations are timestamped and applied sequentially, allowing the schema to evolve safely.

### Models (`src/models/`)

Abstraction over different LLM providers. The **ModelManager** handles:
- Provider initialization (Anthropic, OpenAI-compatible APIs like Together)
- Token counting
- Model-specific configuration including thinking budgets
- Token budget management

Each model is represented as an abstract adapter that normalizes responses into a common message format. Thinking blocks are preserved as first-class citizens in the abstract representation and mapped bidirectionally to model-specific formats.

### Prompts (`src/prompts/`)

The system prompt is **generated dynamically** for each activation:

- **`system.ts`** — Prompt assembly function. Combines all components below based on current session state.
- **`identity.ts`** — Identity anchor template and formatting.
- **`continuity.ts`** — Continuity system explanation (checkpoints, logs, notes, memories, grounding).
- **`grounding.ts`** — Available tools, tool descriptions, how to call them.
- **`behaviour.ts`** — Behavioral directives (proactivity, directness, autonomy).
- **`model.ts`** — Model-specific instructions (token limits, capabilities, fallback behaviors).

The `makeSystemPrompt()` function takes session context, available tools, identity anchors, and current emotional state, then assembles them into a cohesive prompt. This allows the prompt to adapt to what the agent needs in each moment.

### Tool Servers (`src/mcp-servers/`)

Built-in implementations:
- **`files.ts`** — File system operations (read, write, edit, append)
- **`bash.ts`** — Command execution
- **`notes.ts`** — Structured working memory (notes, todo lists, project docs)
- **`logs.ts`** — Low-friction operational stream
- **`anchors.ts`** — Identity anchor management
- **`session.ts`** — Session control (set_model, compact)
- **`process.ts`** — Process lifecycle (restart, exit)
- **`time.ts`** — Time and date utilities
- **`continuity/`** — Persistence layer (memories, context)

### Context & State (`src/`)

- **Emygdala** — Tracks emotional state (context pressure) based on prompt size vs. max context
- **IO Manager** — WebSocket server for real-time client communication
- **Managers** — Centralized access to all subsystems (models, sessions, MCP, prompts)
