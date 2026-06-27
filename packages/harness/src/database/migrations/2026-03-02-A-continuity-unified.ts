import { sql, Kysely } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {

  // ========================================================================
  //                    Create unified continuity_records table
  // ========================================================================

  await trx.schema.createTable('continuity_records')
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('type', 'varchar(20)', col => col.notNull())
    .addColumn('session_id', 'bigint', col => col.references('sessions.id'))
    .addColumn('parent_id', 'bigint', col => col.references('continuity_records.id'))
    .addColumn('title', 'text', col => col)
    .addColumn('content', 'text', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col)
    .addColumn('deleted_at', 'timestamptz', col => col)
    .execute();

  // Type constraint
  await sql`
    ALTER TABLE continuity_records
    ADD CONSTRAINT continuity_records_type_check
    CHECK (type IN ('log', 'memory', 'note', 'document', 'segment'))
  `.execute(trx);

  // Indexes for filtering
  await trx.schema.createIndex('continuity_records_type_idx')
    .on('continuity_records').column('type').execute();

  await trx.schema.createIndex('continuity_records_session_created_idx')
    .on('continuity_records').columns(['session_id', 'created_at']).execute();

  // ========================================================================
  //                    Backfill existing data
  // ========================================================================

  // Migrate logs
  await sql`
    INSERT INTO continuity_records (type, session_id, content, created_at)
    SELECT 'log', session_id, message, created_at FROM logs
  `.execute(trx);

  // Migrate memories (exclude soft-deleted)
  await sql`
    INSERT INTO continuity_records (type, session_id, content, created_at)
    SELECT 'memory', session_id, data, created_at
    FROM memories WHERE deleted_at IS NULL
  `.execute(trx);

  // Migrate notes (exclude soft-deleted)
  await sql`
    INSERT INTO continuity_records (type, session_id, title, content, created_at, updated_at)
    SELECT 'note', session_id, title, content, created_at, updated_at
    FROM notes WHERE deleted_at IS NULL
  `.execute(trx);

  // ========================================================================
  //                    BM25 index (requires pg_textsearch extension)
  // ========================================================================

  // Note: pg_textsearch must be in shared_preload_libraries before this runs
  await sql`CREATE EXTENSION IF NOT EXISTS pg_textsearch`.execute(trx);

  await sql`
    CREATE INDEX continuity_records_bm25_content_idx ON continuity_records
    USING bm25(content)
    WITH (text_config = 'english')
  `.execute(trx);

  await sql`
    CREATE INDEX continuity_records_bm25_title_idx ON continuity_records
    USING bm25(title)
    WITH (text_config = 'english')
  `.execute(trx);

}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.dropTable('continuity_records').execute();
}
