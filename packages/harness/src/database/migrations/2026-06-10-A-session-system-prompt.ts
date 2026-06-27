import { Kysely } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {
  await trx.schema
    .alterTable('sessions')
    .addColumn('system_prompt', 'text', col => col.notNull().defaultTo(''))
    .execute();

  await trx.schema
    .alterTable('sessions')
    .alterColumn('system_prompt', col => col.dropDefault())
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.alterTable('sessions')
    .dropColumn('system_prompt')
    .execute();
}
