import { Kysely, sql } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {
  // Rename existing column
  await trx.schema
    .alterTable('continuity_records')
    .renameColumn('session_id', 'origin_session_id')
    .execute();

  // Add target_session_id as nullable first
  await trx.schema
    .alterTable('continuity_records')
    .addColumn('target_session_id', 'bigint', col => col.references('sessions.id'))
    .execute();

  // Backfill: set target_session_id = origin_session_id for all existing rows
  await sql`UPDATE continuity_records SET target_session_id = origin_session_id`.execute(trx);

  // Now make it NOT NULL
  await trx.schema
    .alterTable('continuity_records')
    .alterColumn('target_session_id', col => col.setNotNull())
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema
    .alterTable('continuity_records')
    .dropColumn('target_session_id')
    .execute();

  await trx.schema
    .alterTable('continuity_records')
    .renameColumn('origin_session_id', 'session_id')
    .execute();
}
