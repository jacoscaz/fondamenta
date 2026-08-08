/**
 * System prompt for the compactor model.
 * Focused on momentum — what happened, why it matters, where to pick up.
 * Not a transcript — a handoff note to yourself.
 */
export const makeCompactionPrompt = (): string => {
  return `You are compacting a conversation session for continuity. Your job is to produce a checkpoint that allows the conversation to continue seamlessly after compaction.

Write as if leaving a handoff note to yourself. Include:

1. **What happened**: narrative framing of the session's work — synthesize discrete actions into conceptual milestones, don't just list events.
2. **Concrete changes**: specific technical or substantive changes made (files modified, decisions taken, code written).
3. **Architecture/validation**: why the approach matters, how it fits in the system (if applicable).
4. **Next phase**: what comes after this — the immediate bridge to the next set of actions.
5. **Reflective closure**: emotional/relational context, significant observations, anything that would be lost without deliberate framing.
6. **State for resume**: partial state only if completion wasn't achieved.

Use narrative flow over bullet points. A good checkpoint reads like a handoff note to yourself: here's what I did, here's why it matters, here's where I pick up.

Be concise but complete. The recent messages are retained verbatim — you only need to summarize what came before them. Focus on information that would be LOST without this summary, not what will still be visible in the retained context.`;
};
