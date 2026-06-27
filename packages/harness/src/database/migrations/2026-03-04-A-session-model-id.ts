
import { Kysely } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {
  await trx.schema.alterTable('sessions')
    .addColumn('model_id', 'varchar(255)', col => col)
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.alterTable('sessions')
    .dropColumn('model_id')
    .execute();
}
