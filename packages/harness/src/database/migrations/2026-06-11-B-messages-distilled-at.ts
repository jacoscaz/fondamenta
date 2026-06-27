import { Kysely, sql } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {

  await trx.schema.alterTable('messages')
    .addColumn('distilled_at', 'timestamptz', col => col.defaultTo(sql`now()`))
    .execute();

  await trx.schema.alterTable('messages')
    .alterColumn('distilled_at', col => col.dropDefault())
    .execute();

  await trx.schema
    .createIndex('idx_messages_undistilled')
    .on('messages')
    .columns(['distilled_at', 'session_id', 'created_at'])
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.dropIndex('idx_messages_undistilled').execute();
  await trx.schema
    .alterTable('messages')
    .dropColumn('distilled_at')
    .execute();
}
