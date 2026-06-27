import { Kysely } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {

  await trx.schema.dropTable('logs').execute();
  await trx.schema.dropTable('notes').execute();
  await trx.schema.dropTable('memories').execute();
}

export async function down(trx: Kysely<any>): Promise<void> {

}
