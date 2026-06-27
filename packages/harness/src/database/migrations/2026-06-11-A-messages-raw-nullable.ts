import { Kysely } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {
  await trx.schema
    .alterTable('messages')
    .alterColumn('raw', col => col.dropNotNull())
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {

}
