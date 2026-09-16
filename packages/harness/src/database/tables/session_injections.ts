import type {
  GeneratedAlways,
  Insertable,
  Selectable,
} from "kysely";

import type { DB } from "../client.js";

/**
 * One row per recollection strip event: which facts were injected into
 * which session, for which triggering message, by which mechanism and at
 * what retrieval quality.
 *
 * Lifetimes: rows are NOT deleted at compaction. Instead, compaction marks
 * rows with `compacted_at` (soft purge): deduplication reads only
 * `compacted_at IS NULL` rows (a record may fire again once the context
 * that held it has been summarized away), while the full history stays
 * available for retroactive analysis of the recollection mechanism.
 */
export interface SessionInjection {
  id: GeneratedAlways<number>;
  session_id: number;
  record_id: number | null;
  message_id: number;
  method: string;
  score: number | null;
  rank: number | null;
  injected_at: Date;
  compacted_at: Date | null;
}

export type InsertableSessionInjection = Insertable<SessionInjection>;
export type SelectableSessionInjection = Selectable<SessionInjection>;

export const insertSessionInjection = async (
  db: DB,
  injection: InsertableSessionInjection,
): Promise<SelectableSessionInjection> => {
  return await db.insertInto('session_injections')
    .values(injection)
    .returningAll()
    .executeTakeFirstOrThrow();
};

/** Record ids injected into this session and still in context (not purged
 *  by a compaction). Deduplication reads only these. */
export const selectOpenInjectedRecordIds = async (
  db: DB,
  session_id: number,
): Promise<Set<number>> => {
  const rows = await db.selectFrom('session_injections')
    .where('session_id', '=', session_id)
    .where('compacted_at', 'is', null)
    .where('record_id', 'is not', null)
    .select('record_id')
    .execute();
  return new Set(rows.map(r => r.record_id as number));
};

/** Whether a triggering message has already been served a recollection
 *  strip (any method, including empty-result bookkeeping rows). */
export const selectMessageWasInjected = async (
  db: DB,
  message_id: number,
): Promise<boolean> => {
  const row = await db.selectFrom('session_injections')
    .where('message_id', '=', message_id)
    .select('id')
    .executeTakeFirst();
  return row !== undefined;
};
