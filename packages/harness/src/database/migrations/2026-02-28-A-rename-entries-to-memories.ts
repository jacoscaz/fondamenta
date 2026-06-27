import { Kysely, sql } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {

  // ========================================================================
  //  Rename entries table to memories
  // ========================================================================

  // Rename the table
  await sql`ALTER TABLE entries RENAME TO memories`.execute(trx);
  await trx.schema.alterTable('memories').dropColumn('type').execute();

}

export async function down(trx: Kysely<any>): Promise<void> {

  // ========================================================================
  //  Revert: Rename memories back to entries
  // ========================================================================

  // Rename the indexes back
  await sql`ALTER INDEX memories_type_created_at_idx RENAME TO entries_type_created_at_idx`.execute(trx);
  await sql`ALTER INDEX memories_session_id_created_at_idx RENAME TO entries_session_id_created_at_idx`.execute(trx);

  // Rename the table back
  await sql`ALTER TABLE memories RENAME TO entries`.execute(trx);

}
