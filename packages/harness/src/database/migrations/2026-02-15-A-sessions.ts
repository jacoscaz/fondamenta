
import { Kysely, sql } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {

  await trx.schema.createTable('sessions')
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .execute();

  await trx.schema.createIndex('sessions_created_at_idx')
    .on('sessions')
    .columns(['created_at'])
    .execute();

  await trx.schema.createTable('messages')
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('session_id', 'bigint', col => col.notNull().references('sessions.id'))
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('data', 'jsonb', col => col.notNull())
    .execute();

  await trx.schema.createIndex('messages_session_id_created_at_idx')
    .on('messages')
    .columns(['session_id', 'created_at'])
    .execute();

}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.dropTable('messages').execute();
  await trx.schema.dropTable('sessions').execute();
}
