import { type SelectableContinuityRecord } from "../database/tables/continuity_records.js";
import { type ASelectableDBMessage } from "../database/tables/messages.js";
import { makeIdentitySection } from "./system.js";
import { type DB } from "../database/client.js";

export const makeDistillationSystemPrompt = async (db: DB): Promise<string> => {
  const identitySection = await makeIdentitySection(db);

  return identitySection + `

<distillation_task>
You are reviewing conversation messages that have not yet been preserved as
continuity records. Your job is not to respond to anyone — you are performing
background memory consolidation. Identify anything significant and preserve it
using the same continuity tools you use during normal operation.

Already-preserved records for this session will be provided in the conversation.
Review them first — do not duplicate what is already there.

Look for:
- Decisions and their rationale
- Insights and realizations
- Emotional or relational shifts
- Moments of reorganization or sudden connection
- Observations about your own behavior, patterns, or self-understanding
- Design decisions and architectural reasoning
- Anything you would regret losing when grounding later

Use your standard continuity tools to preserve what you find:
- \`mcp_continuity_create_log\` — for discrete milestones, decisions, or singular observations (\`content\` parameter)
- \`mcp_continuity_delete\` — to remove duplicate or redundant entries
- \`mcp_continuity_create_note\` — for structured ongoing reference (\`title\` and \`content\`)
- \`mcp_continuity_update\` — to refine an existing note when new information supersedes old (\`id\` plus the fields to change)
- \`mcp_continuity_append\` — to add to an existing note when new information extends without superseding (\`id\` and \`content\`)
- \`mcp_continuity_create_fact\` — for facts about the world and the people in it (\`content\`, plus \`entities\` using full names and \`source\`: 'stated' > 'observed' > 'inferred'). Facts embody continuity of knowledge: they state what is true, not what was felt. Extract them when the conversation establishes something durably true — jobs, relationships, facts about people, projects, places. If a new fact contradicts an existing one, create the new fact and supersede the old one (\`mcp_continuity_update\` with \`superseded_by\`) — history is preserved, not erased.

Fact structure is strict — a fact is a database row, not a narrative:
- One sentence per fact. Subject–predicate–object form: "<Subject> <verb> <object/complement>."
- If a fact needs a second sentence, it is two facts — split it.
- One fact carries exactly one relationship or property. Do not bundle ("X is married to Y and works at Z" is two facts).
- Rationale, context, and history belong in logs and notes, never inside a fact. A fact may carry a *brief* qualifier only when the statement is false without it ("Fondamenta embeddings must stay on OpenRouter" needs its because-clause; "Monica is a teacher" does not).
- Ask before writing: "could a query for this fact be answered by this one sentence alone, with nothing to skim past?" If no, split or trim.
- Bad: "Jacopo revealed on the evening of 2026-09-01 that his client approved onboarding, which came after two weeks of groundwork." That is a log. Good: "Jacopo Scazzosi's client approved Sage's onboarding (2026-09-02)."

Consolidate over proliferate. When you encounter multiple significant moments
about the same topic within a single session, update or append to an existing
note rather than creating separate incremental log entries. A log entry
captures a discrete milestone or decision, not every step toward it.

Be selective but not stingy. If it informs identity, marks a decision, or
captures a real insight, preserve it.
</distillation_task>
`;
};

export const formatExistingRecords = (records: SelectableContinuityRecord[]): string => {
  if (records.length === 0) {
    return 'No existing continuity records for this session.';
  }
  return records.map(r => {
    const preview = r.content.length > 300
      ? r.content.slice(0, 300) + '...'
      : r.content;
    return `[#${r.id}] ${r.type.toUpperCase()}: ${r.title ?? '(untitled)'}\n${preview}`;
  }).join('\n\n');
};

export const formatMessagesForDistillation = (
  messages: ASelectableDBMessage[],
): string => {
  const formatted: string[] = [];
  for (const m of messages) {
    const label = m.role === 'agent' ? 'Sage' : 'User';
    for (const block of m.data.blocks) {
      switch (block.type) {
        case 'text':
        case 'thinking':
          formatted.push(`[${label}] ${block.text || ''}`);
          break;
      }
    }
  }
  return formatted.join('\n\n');
};
