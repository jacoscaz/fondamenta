export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Prefix format of every automated (harness-injected) message. All
 * inbound content from the world — mail, telegram, todos, heartbeat —
 * arrives as an event with this prefix plus a domain/method
 * identifier: `[event: mail/arrived] ...`. Human-originated content
 * also arrives as events now (the channels inject it); there is no
 * unmarked channel. See the <registers> section of the system prompt.
 */
export const EVENT_PREFIX = '[event: ';
