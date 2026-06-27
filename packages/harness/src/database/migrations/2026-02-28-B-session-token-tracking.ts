import { sql } from 'kysely';
import { Kysely } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {

  await trx.schema.alterTable('sessions')
    .addColumn('updated_at', 'timestamp', col => col)
    .addColumn('prompt_size', 'bigint', col => col.notNull().defaultTo(0))
    .addColumn('input_tokens_count', 'bigint', col => col.notNull().defaultTo(0))
    .addColumn('output_tokens_count', 'bigint', col => col.notNull().defaultTo(0))
    .execute();

  await trx.updateTable('sessions')
    .set({ updated_at: sql.ref('created_at') })
    .execute();

  await trx.schema.alterTable('sessions')
    .alterColumn('updated_at', col => col.setNotNull())
    .alterColumn('prompt_size', col => col.dropDefault())
    .alterColumn('input_tokens_count', col => col.dropDefault())
    .alterColumn('output_tokens_count', col => col.dropDefault())
    .execute();

}

export async function down(trx: Kysely<any>): Promise<void> {

  await trx.schema.alterTable('sessions')
    .dropColumn('updated_at')
    .dropColumn('prompt_size')
    .dropColumn('output_tokens_count')
    .dropColumn('input_tokens_count')
    .execute();

}
