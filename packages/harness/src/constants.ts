export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Reasoning-effort vocabulary: the harness's common language for how hard
 * a session model should think (Jacopo's review, PR #27: harness-wide
 * vocabulary belongs here, not in config). Adapters translate these to
 * their native equivalents; adapters with no notion of reasoning effort
 * no-op the request (log + false, never error).
 */
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * Prefix format of every automated (harness-injected) message. All
 * inbound content from the world — mail, telegram, todos, heartbeat —
 * arrives as an event with this prefix plus a domain/method
 * identifier: `[event: mail/arrived] ...`. Human-originated content
 * also arrives as events now (the channels inject it); there is no
 * unmarked channel. See the <registers> section of the system prompt.
 */
export const EVENT_PREFIX = '[event: ';
