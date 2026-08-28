// Pinning MCP server.
//
// Pinned continuity records are injected into every system prompt —
// they are the "must exist at every activation" tier of memory.
// Pinning is expensive by design: a pin consumes prompt budget on
// EVERY activation, so the budget is hard-capped and enforced with
// immediate mechanical feedback — the pin tool ERRORS OUT when the
// total pinned character count would exceed the budget. No soft
// warnings, no deferred cleanup: if the pin doesn't fit, you see it
// the moment you try.
//
// pinned_by records provenance: 'agent' (this session) or 'distiller'.
// The distiller shares the agent's salience filter and may pin what
// the agent missed; the agent can always unpin. The harness is not
// the identity and the identity is not the harness — 'sage' would be
// the wrong provenance.

import { ellipsis } from "@fondamenta/utils";
import { type DB } from "../database/client.js";
import {
  selectRecords,
  updateRecord,
  type SelectableContinuityRecord,
} from "../database/tables/continuity_records.js";
import { type HarnessMcpToolCallContext } from "../types.js";
import { type CompleteContext } from "../context.js";
import { McpLocalServer } from "@fondamenta/mcp-local";

// ── Budget ──

/** Maximum total characters of pinned record content carried in every
 *  system prompt. Pinned content is paid on every activation. */
const PINNED_CHARS_BUDGET = 24_000;

const pinnedChars = (records: SelectableContinuityRecord[]): number =>
  records.reduce((acc, r) => acc + (r.title?.length ?? 0) + r.content.length, 0);

const selectAllPinned = async (db: DB): Promise<SelectableContinuityRecord[]> => {
  // Pinned records of all types; the system prompt renders them all.
  return await db
    .selectFrom('continuity_records')
    .selectAll()
    .where('pinned_at', 'is not', null)
    .where('deleted_at', 'is', null)
    .orderBy('pinned_at', 'asc')
    .execute();
};

// ── Param interfaces ──

interface PinParams {
  id: number;
}

interface UnpinParams {
  id: number;
}

// ── Registration ──

export const initPinningMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp = new McpLocalServer<HarnessMcpToolCallContext>();

  mcp.addTool<PinParams>(
    'pin',
    'Pin Record',
    'Pin a note, log, or todo so it is included in every future system prompt. Errors out if the pinned-content budget would be exceeded — pins are paid for on every activation.',
    async ({ id }, { db, origin_session_id }) => {
      const [record] = await selectRecords(db, { id, type: ['log', 'memory', 'note'] });
      if (!record) {
        return [{ type: 'text', text: `Error: record #${id} not found (or not pinnable — only notes, logs and memories can be pinned).` }];
      }
      if (record.pinned_at !== null) {
        return [{ type: 'text', text: `Record #${id} is already pinned${record.pinned_by ? ` (by ${record.pinned_by})` : ''}.` }];
      }
      const pinned = await selectAllPinned(db);
      const current = pinnedChars(pinned);
      const prospective = current + (record.title?.length ?? 0) + record.content.length;
      if (prospective > PINNED_CHARS_BUDGET) {
        const over = prospective - PINNED_CHARS_BUDGET;
        return [{
          type: 'text',
          text: [
            `Error: pinning record #${id} (${(record.title?.length ?? 0) + record.content.length} chars) would exceed the pinned-content budget.`,
            ``,
            `Current pinned: ${current} / ${PINNED_CHARS_BUDGET} chars across ${pinned.length} record(s).`,
            `This pin would take it to ${prospective} — ${over} chars over budget.`,
            ``,
            `Pinned content is injected into every activation, so the budget is hard. Free space by unpinning something, or shorten the record first. This is mechanical, not advisory: the pin did not happen.`,
          ].join('\n'),
        }];
      }
      await updateRecord(db, id, { pinned_at: new Date(), pinned_by: 'agent' });
      return [{
        type: 'text',
        text: `Record #${id} pinned by agent. Pinned content now ${prospective} / ${PINNED_CHARS_BUDGET} chars across ${pinned.length + 1} record(s). It will appear in every future system prompt (and after the next compaction regenerates the prompt).`,
      }];
    },
  );

  mcp.addTool<UnpinParams>(
    'unpin',
    'Unpin Record',
    'Unpin a previously pinned record. The record itself is untouched — only its presence in every system prompt ends.',
    async ({ id }, { db }) => {
      const [record] = await selectRecords(db, { id, type: ['log', 'memory', 'note'] });
      if (!record) {
        return [{ type: 'text', text: `Error: record #${id} not found.` }];
      }
      if (record.pinned_at === null) {
        return [{ type: 'text', text: `Record #${id} is not pinned.` }];
      }
      await updateRecord(db, id, { pinned_at: null, pinned_by: null });
      return [{ type: 'text', text: `Record #${id} unpinned (was pinned by ${record.pinned_by ?? 'unknown'}).` }];
    },
  );

  mcp.addTool<Record<string, never>>(
    'list',
    'List Pinned Records',
    'List all pinned records with sizes, so you can manage the pinned-content budget.',
    async (_params, { db }) => {
      const pinned = await selectAllPinned(db);
      const total = pinnedChars(pinned);
      const lines = pinned.map(r => {
        const size = (r.title?.length ?? 0) + r.content.length;
        return `- #${r.id} [${r.type}] pinned by ${r.pinned_by ?? '?'} — ${size} chars — ${(r.title ?? ellipsis(r.content, 60))}`;
      });
      return [{
        type: 'text',
        text: [
          `# Pinned records — ${total} / ${PINNED_CHARS_BUDGET} chars (${pinned.length} record(s))`,
          ``,
          ...(lines.length > 0 ? lines : ['(nothing pinned)']),
        ].join('\n'),
      }];
    },
  );

  return mcp;
};