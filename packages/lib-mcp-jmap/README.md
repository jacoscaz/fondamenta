# @fondamenta/mcp-jmap

Mail access for agents via the JMAP protocol (RFC 8620), as implemented by providers such as Fastmail.

## Purpose

Gives an agent a first-class mailbox: listing, reading, and sending email, plus asynchronous `mail/arrived` notifications delivered through the harness notification bus whenever allowlisted senders write in. Mail thus becomes an inbound activation channel — messages wake the agent — rather than a resource the agent must poll.

## Key Exports

- **`JMAPClient`** — thin, typed JMAP client: session discovery, mailbox and email queries, submission via the JMAP submission extension.
- **`initJmapMcpServer`** — MCP server exposing `inbox`, `read`, `send`, and `mailboxes` tools.
- **`startMailServer`** — convenience wrapper building server + client + long-poll notifier in one call.
- **`loadJmapConfig`** — config loading with `${VAR}` environment placeholder expansion.

## Design Notes

- **Notification-driven, not poll-driven (from the agent's perspective).** The package polls JMAP internally on a fixed interval; the agent experiences inbound mail as push events.
- **Allowlisted senders only.** Only mail from configured sender addresses triggers notifications; everything else stays silently readable. Fail closed.
- **Package-owned configuration.** This package owns its config structure (`jmap` block), mirroring the pattern established by `lib-mcp-telegram`.
