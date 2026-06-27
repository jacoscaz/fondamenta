import { Kysely } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {
  await trx.schema
    .alterTable('messages')
    .addColumn('processed_at', 'timestamptz', col => col)
    .addColumn('role', 'text', col => col.notNull().defaultTo('user'))
    .execute();

  // Add index for efficient unprocessed message queries
  await trx.schema
    .createIndex('idx_messages_unprocessed')
    .on('messages')
    .columns(['session_id', 'processed_at', 'created_at'])
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.dropIndex('idx_messages_unprocessed').execute();
  await trx.schema
    .alterTable('messages')
    .dropColumn('role')
    .dropColumn('processed_at')
    .execute();
}
