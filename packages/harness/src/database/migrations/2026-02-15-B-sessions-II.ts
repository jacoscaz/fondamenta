
import { Kysely, sql } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {

  await trx.schema.alterTable('sessions')
    .addColumn('log', 'text', col => col.notNull().defaultTo(''))
    .addColumn('initiator', 'varchar(16)', col => col.notNull().defaultTo('user'))
    .addColumn('connected', 'boolean', col => col.notNull().defaultTo(false))
    .execute();

  await trx.schema.alterTable('sessions')
    .alterColumn('log', col => col.dropDefault())
    .alterColumn('initiator', col => col.dropDefault())
    .alterColumn('connected', col => col.dropDefault())
    .execute();

}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.alterTable('sessions')
    .dropColumn('log')
    .dropColumn('connected')
    .dropColumn('initiator')
    .execute();
}
