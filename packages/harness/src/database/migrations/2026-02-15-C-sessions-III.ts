
import { Kysely, sql } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {

  await trx.schema.alterTable('sessions')
    .dropColumn('log')
    .execute();

  await trx.schema.alterTable('entries')
    .addColumn('session_id', 'bigint', col => col.notNull().references('sessions.id').defaultTo(0))
    .execute();

  await trx.schema.alterTable('entries')
    .alterColumn('session_id', col => col.dropDefault())
    .execute();

  await trx.schema.createTable('logs')
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('session_id', 'bigint', col => col.notNull().references('sessions.id'))
    .addColumn('message', 'text', col => col.notNull())
    .execute();

  await trx.schema.createIndex('logs_session_id_created_at_idx')
    .on('logs')
    .columns(['session_id', 'created_at'])
    .execute();



}

export async function down(trx: Kysely<any>): Promise<void> {

}
