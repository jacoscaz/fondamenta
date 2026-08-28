import { sql, Kysely } from 'kysely';

/**
 * Add todo/pinning columns to the unified continuity_records table.
 *
 * Design decision: todos are NOT a separate table — they are continuity
 * records (logs/notes/memories) extended with temporal semantics:
 *
 * - `due_at`: the commitment — when the task should be done by.
 * - `notify_at`: when the harness should surface the record to the agent
 *   (scheduled activation trigger). Snoozing moves this forward; the
 *   due date stays as the commitment.
 * - `done_at`: completion timestamp. NULL means open.
 * - `pinned_at` / `pinned_by`: pinning state and provenance ('agent' or
 *   'distiller'). Pinned records are surfaced in every system prompt.
 *
 * All columns are nullable: a record only participates in a mechanism
 * when the relevant column is set.
 */
export async function up(trx: Kysely<any>): Promise<void> {
  await trx.schema.alterTable('continuity_records')
    .addColumn('due_at', sql`timestamptz`)
    .addColumn('notify_at', sql`timestamptz`)
    .addColumn('done_at', sql`timestamptz`)
    .addColumn('pinned_at', sql`timestamptz`)
    .addColumn('pinned_by', 'text')
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.alterTable('continuity_records')
    .dropColumn('due_at')
    .dropColumn('notify_at')
    .dropColumn('done_at')
    .dropColumn('pinned_at')
    .dropColumn('pinned_by')
    .execute();
}
