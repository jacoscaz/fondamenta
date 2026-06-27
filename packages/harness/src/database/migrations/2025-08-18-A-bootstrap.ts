
import { sql, Kysely } from 'kysely';
import { Tables } from '../tables.js';

export async function up(trx: Kysely<Tables>): Promise<void> {

  await sql`CREATE EXTENSION IF NOT EXISTS timescaledb;`.execute(trx);

  // ========================================================================
  //                                Memories
  // ========================================================================

  await trx.schema.createTable('memories')
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('data', 'text', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('deleted_at', 'timestamptz', col => col)
    .execute();

}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.dropTable('memories').execute();
}
