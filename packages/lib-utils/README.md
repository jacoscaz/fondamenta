# @fondamenta/utils

Lightweight utilities for the agent harness infrastructure.

## Purpose

Common utility functions and data structures used across the agent framework.

## Key Components

- **`utils.ts`** — General-purpose utility functions (wait, delays, type guards, etc.)
- **`arrayqueue.ts`** — Async-friendly queue implementation
- **`bufferedasynciterable.ts`** — Buffering wrapper for async iterables, useful for handling streaming data with backpressure

## Usage

```typescript
import { wait } from '@fondamenta/utils';

await wait(1000); // Wait 1 second
```

## Design Philosophy

Minimal dependencies, maximum reusability. Utilities here should have no coupling to the MCP framework or harness-specific concerns.
