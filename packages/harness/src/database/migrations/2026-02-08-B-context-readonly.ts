
import { Kysely } from 'kysely';
import { Tables } from '../tables.js';

export async function up(trx: Kysely<Tables>): Promise<void> {

  // ========================================================================
  //                        Readonly Context Entries
  // ========================================================================

  await trx.schema.alterTable('context_entries')
    .addColumn('readonly', 'boolean', col => col.notNull().defaultTo(false))
    .execute();

}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.alterTable('context_entries')
    .dropColumn('readonly')
    .execute();
}
