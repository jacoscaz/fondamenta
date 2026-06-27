
import { Kysely, sql } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {

  // ========================================================================
  //  1. Enhance logs table with tags for searchability
  // ========================================================================

  await trx.schema.alterTable('logs')
    .addColumn('tags', sql`text[]`, col => col.notNull().defaultTo(sql`'{}'::text[]`))
    .execute();

  await trx.schema.alterTable('logs')
    .alterColumn('tags', col => col.dropDefault())
    .execute();

  await sql`CREATE INDEX logs_tags_idx ON logs USING GIN (tags)`.execute(trx);

  // ========================================================================
  //  2. Create notes table
  // ========================================================================

  await trx.schema.createTable('notes')
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('title', 'text', col => col.notNull())
    .addColumn('content', 'text', col => col.notNull())
    .addColumn('tags', sql`text[]`, col => col.defaultTo(sql`'{}'::text[]`))
    .addColumn('session_id', 'bigint', col => col.notNull().references('sessions.id'))
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await sql`CREATE INDEX notes_tags_idx ON notes USING GIN (tags)`.execute(trx);
  await sql`CREATE INDEX notes_type_idx ON notes (created_at) WHERE deleted_at IS NULL`.execute(trx);
  await sql`CREATE INDEX notes_updated_at_idx ON notes (updated_at) WHERE deleted_at IS NULL`.execute(trx);

}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.dropTable('notes').execute();
  await trx.schema.alterTable('logs').dropColumn('tags').execute();
}
