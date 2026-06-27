
import { Kysely } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {

  await trx.updateTable('sessions')
    .set({ model_id: 'default' })
    .where('model_id', 'is', null)
    .execute();

  await trx.schema.alterTable('sessions')
    .alterColumn('model_id', col => col.setNotNull())
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.alterTable('sessions')
    .alterColumn('model_id', col => col.dropNotNull())
    .execute();
}
