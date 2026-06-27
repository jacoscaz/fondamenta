import { Kysely, sql } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {

  // ========================================================================
  //  Rename context_entries table to identity_anchors
  // ========================================================================

  await sql`ALTER TABLE context_entries RENAME TO identity_anchors`.execute(trx);

}

export async function down(trx: Kysely<any>): Promise<void> {

  // ========================================================================
  //  Revert: Rename identity_anchors back to context_entries
  // ========================================================================

  await sql`ALTER TABLE identity_anchors RENAME TO context_entries`.execute(trx);

}
