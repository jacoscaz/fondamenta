
import { Kysely } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {

  await trx.schema.createTable('contacts')
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('guidance', 'text', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .execute();

  await trx.schema.createTable('contact_urls')
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('contact_id', 'bigint', col => col.references('contacts.id').notNull())
    .addColumn('url', 'text', col => col.notNull())
    .addColumn('guidance', 'text', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .execute();

  await trx.schema.createIndex('idx_contacts_by_url')
    .on('contact_urls')
    .column('url')
    .unique()
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.dropTable('contact_urls').execute();
  await trx.schema.dropTable('contacts').execute();

}
