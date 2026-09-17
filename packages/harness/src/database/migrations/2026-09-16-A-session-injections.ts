import { Kysely, sql } from 'kysely';

import type { Tables } from '../tables.js';

/**
 * Session injections: bookkeeping for the automatic recollection strip.
 *
 * One row per strip event — which records were injected into which
 * session, for which triggering message, at what rank and retrieval score.
 * Empty-result attempts are recorded too (method 'facts_empty', record_id
 * null): they prevent re-firing on the same message and accumulate the
 * base-rate data a future evaluation pass will need.
 *
 * Compaction soft-purges (sets compacted_at) instead of deleting: dedup
 * reads only un-compacted rows; analysis reads the full history.
 */
export async function up(trx: Kysely<Tables>): Promise<void> {
  await trx.schema
    .createTable('session_injections')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('session_id', 'bigint', (col) =>
      col.notNull().references('sessions.id'))
    .addColumn('record_id', 'bigint', (col) =>
      col.references('continuity_records.id'))
    .addColumn('message_id', 'bigint', (col) =>
      col.notNull().references('messages.id'))
    .addColumn('method', 'text', (col) => col.notNull())
    .addColumn('score', 'real')
    .addColumn('rank', 'smallint')
    .addColumn('injected_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`))
    .addColumn('compacted_at', 'timestamptz')
    .execute();

  // Dedup lookups: open (not yet compacted) injections per session.
  await sql`CREATE INDEX session_injections_open_idx ON session_injections (session_id) WHERE compacted_at IS NULL`.execute(trx);
  // Per-message fire-once lookups.
  await sql`CREATE INDEX session_injections_message_idx ON session_injections (message_id)`.execute(trx);
}

export async function down(trx: Kysely<Tables>): Promise<void> {
  await trx.schema.dropTable('session_injections').execute();
}
