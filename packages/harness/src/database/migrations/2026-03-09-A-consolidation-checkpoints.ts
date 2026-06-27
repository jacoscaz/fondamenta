
import { sql, Kysely } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {
  await trx.schema
    .createTable('checkpoints')
    .addColumn('id', 'serial', col => col.primaryKey())
    .addColumn('session_id', 'integer', col => col.notNull().references('sessions.id'))
    .addColumn('data', 'text', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.dropTable('checkpoints').execute();
}
