# @fondamenta/mcp-telegram

Telegram Bot API integration giving agents a two-way conversational channel with humans.

## Purpose

Exposes an agent over Telegram: outbound messages through the `send` tool, inbound messages as `telegram/message` events on the notification bus. Inbound messages from allowlisted users activate the agent — Telegram becomes a primary human↔agent I/O channel rather than a passive notification feed.

## Key Exports

- **`TelegramClient`** — thin, typed Bot API wrapper: long-polling `getUpdates` with offset bookkeeping, `sendMessage`, `getMe`, and on-demand photo download via `getFile`.
- **`initTelegramMcpServer`** — MCP server exposing `send`, `me`, and `photo` tools.
- **`startTelegramServer`** — convenience wrapper building server + client + notifier in one call.
- **`loadTelegramConfig`** — config loading with `${VAR}` environment placeholder expansion.

## Design Notes

- **Fail-closed allowlist.** Messages from users not in `allowed_user_ids` are silently dropped and logged. Bots are publicly discoverable; without this filter anyone could inject content into the agent's context.
- **Multimodal inbound.** Photos are described in events with their `file_id` and caption; the `photo` tool downloads the image to the configured media directory for viewing by the agent's vision-capable model.
- **Package-owned configuration.** This package owns its config structure (`telegram` block), independent of harness-side config parsing.
