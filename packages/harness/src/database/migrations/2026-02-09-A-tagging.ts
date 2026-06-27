
import { Kysely, sql } from 'kysely';
import { Tables } from '../tables.js';

export async function up(trx: Kysely<Tables>): Promise<void> {

  // ========================================================================
  //                            Tagging System
  // ========================================================================

  // Central tag registry - prevents duplication, enables "all tags" queries
  await trx.schema.createTable('tags')
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('name', 'text', col => col.notNull().unique())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .execute();

  // Create index on tags.name for fast lookups
  await trx.schema.createIndex('tags_name_idx')
    .on('tags')
    .column('name')
    .execute();

  // Polymorphic relationship table: links tags to entries (thoughts, memories, context_entries)
  // source column indicates which table the entry_id refers to
  await trx.schema.createTable('tag_mappings')
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('tag_id', 'bigint', col => col.notNull())
    .addColumn('entry_id', 'bigint', col => col.notNull())
    .addColumn('source', 'varchar(20)', col => col.notNull()) // 'thought', 'memory', 'context_entry'
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('deleted_at', 'timestamptz', col => col)
    .execute();

  // Composite unique constraint: same tag can't be applied twice to the same entry
  // (source + entry_id + tag_id uniquely identifies a tagging relationship)
  // Note: We use raw SQL for partial unique indexes since Kysely has limitations
  await sql<void>`
    CREATE UNIQUE INDEX tag_mappings_unique_idx
    ON tag_mappings(tag_id, entry_id, source)
    WHERE deleted_at IS NULL
  `.execute(trx);

  // Index for finding all tags on an entry
  await sql<void>`
    CREATE INDEX tag_mappings_entry_idx
    ON tag_mappings(source, entry_id)
    WHERE deleted_at IS NULL
  `.execute(trx);

  // Index for finding all entries with a tag
  await sql<void>`
    CREATE INDEX tag_mappings_tag_idx
    ON tag_mappings(tag_id)
    WHERE deleted_at IS NULL
  `.execute(trx);

}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.dropTable('tag_mappings').execute();
  await trx.schema.dropTable('tags').execute();
}
