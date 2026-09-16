import { Kysely, sql } from 'kysely';

import type { Tables } from '../tables.js';

/**
 * Fix: session_injections.message_id FK blocks compaction.
 *
 * Migration 2026-09-16-A created the FK without an ON DELETE action, but
 * the compactor DELETES summarized messages. Any injection row referencing
 * a summarized message made the compaction transaction fail with a foreign
 * key violation (found live, 2026-09-16: the test-era strips poisoned
 * compaction for their session).
 *
 * ON DELETE CASCADE preserves the design semantics exactly:
 *  - rows referencing retained messages stay (dedup + eval data intact);
 *  - rows referencing summarized messages die with the message — which is
 *    the intended "strips from summarized messages may fire again"
 *    behavior, and the soft-purge (compacted_at) marking of those rows was
 *    already moot (the message text they bookkeep is gone).
 */
export async function up(trx: Kysely<Tables>): Promise<void> {
  await sql`ALTER TABLE session_injections DROP CONSTRAINT session_injections_message_id_fkey`.execute(trx);
  await sql`ALTER TABLE session_injections ADD CONSTRAINT session_injections_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE`.execute(trx);
}

export async function down(trx: Kysely<Tables>): Promise<void> {
  await sql`ALTER TABLE session_injections DROP CONSTRAINT session_injections_message_id_fkey`.execute(trx);
  await sql`ALTER TABLE session_injections ADD CONSTRAINT session_injections_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages (id)`.execute(trx);
}
