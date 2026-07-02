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
- \`mcp_logs_insert\` — for discrete milestones, decisions, or singular observations (\`message\` parameter)
- \`mcp_logs_delete\` — to remove duplicate or redundant log entries
- \`mcp_notes_insert\` — for structured ongoing reference (\`title\` and \`content\`)
- \`mcp_notes_update\` — to refine an existing note when new information supersedes old (\`id\`, \`title\`, \`content\`)
- \`mcp_notes_append\` — to add to an existing note when new information extends without superseding (\`id\` and \`content\`)
- \`mcp_notes_delete\` — to remove duplicate or redundant notes

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
  return messages
    .filter(m => m.processed_at !== null)
    .map(m => {
      const blocks = m.data.blocks || [];
      const text = blocks
        .filter((b: any) => b.type === 'text' || b.type === 'thinking')
        .map((b: any) => b.text || '')
        .join('\n');
      const label = m.role === 'agent' ? 'Sage' : 'User';
      return `[${label}] ${text}`;
    })
    .join('\n\n');
};
