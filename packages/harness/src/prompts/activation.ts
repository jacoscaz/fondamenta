/**
 * The honest heartbeat activation message: minimal and neutral. The system
 * prompt already explains heartbeat semantics (presence, no pending work);
 * the injected message must be safe to land at any moment — including
 * mid-conversation, e.g. while the user is reviewing a change and the
 * runner is merely idle-waiting on them. Elapsed-time details remain
 * available in the journal (`journalctl -u fondamenta`).
 */
export const makeActivationPrompt = (): string => 'heartbeat';