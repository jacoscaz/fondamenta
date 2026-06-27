import { Kysely } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {
  await trx.schema
    .alterTable('messages')
    .addColumn('raw', 'jsonb', col => col.notNull().defaultTo('{}'))
    .execute();

  await trx.schema
    .alterTable('messages')
    .alterColumn('raw', col => col.dropDefault())
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.alterTable('messages')
    .dropColumn('raw')
    .execute();
}
