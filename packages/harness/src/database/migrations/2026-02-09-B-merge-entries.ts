
import { Kysely, sql } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {

  // ========================================================================
  //  Merge thoughts + memories into a single 'entries' table
  //  with a type discriminator and tags as a text[] column.
  //  Context entries stay separate (different schema: priority, readonly).
  //  Tags and tag_mappings tables are dropped.
  // ========================================================================

  // 1. Create the unified entries table
  await trx.schema.createTable('entries')
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('type', 'varchar(20)', col => col.notNull()) // 'thought' | 'memory'
    .addColumn('data', 'text', col => col.notNull())
    .addColumn('tags', sql`text[]`, col => col.defaultTo(sql`'{}'::text[]`))
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  // GIN index on tags array for efficient array containment queries
  await sql`CREATE INDEX entries_tags_idx ON entries USING GIN (tags)`.execute(trx);

  // Index for filtering by type (most queries will filter on type)
  await sql`CREATE INDEX entries_type_idx ON entries (type) WHERE deleted_at IS NULL`.execute(trx);

  // 2. Migrate existing thoughts into entries
  await sql`
    INSERT INTO entries (id, type, data, tags, created_at, deleted_at)
    SELECT
      t.id,
      'thought',
      t.data,
      COALESCE(
        (
          SELECT array_agg(DISTINCT tg.name)
          FROM tag_mappings tm
          JOIN tags tg ON tg.id = tm.tag_id
          WHERE tm.entry_id = t.id
            AND tm.source = 'thought'
            AND tm.deleted_at IS NULL
        ),
        '{}'::text[]
      ),
      t.created_at,
      t.deleted_at
    FROM thoughts t
  `.execute(trx);

  // 3. Migrate existing memories into entries
  //    We need to offset memory IDs to avoid collision with thought IDs.
  //    First, find the max thought ID to use as offset.
  const maxThoughtId = await sql<{ max: number | null }>`
    SELECT COALESCE(MAX(id), 0) as max FROM thoughts
  `.execute(trx);
  const offset = maxThoughtId.rows[0]?.max ?? 0;

  await sql`
    INSERT INTO entries (id, type, data, tags, created_at, deleted_at)
    SELECT
      m.id + ${offset},
      'memory',
      m.data,
      COALESCE(
        (
          SELECT array_agg(DISTINCT tg.name)
          FROM tag_mappings tm
          JOIN tags tg ON tg.id = tm.tag_id
          WHERE tm.entry_id = m.id
            AND tm.source = 'memory'
            AND tm.deleted_at IS NULL
        ),
        '{}'::text[]
      ),
      m.created_at,
      m.deleted_at
    FROM memories m
  `.execute(trx);

  // 4. Reset the sequence to the correct next value
  await sql`
    SELECT setval('entries_id_seq', (SELECT COALESCE(MAX(id), 1) FROM entries))
  `.execute(trx);

  // 5. Drop old tables
  await trx.schema.dropTable('tag_mappings').ifExists().execute();
  await trx.schema.dropTable('tags').ifExists().execute();
  await trx.schema.dropTable('thoughts').ifExists().execute();
  await trx.schema.dropTable('recalls').ifExists().execute();
  await trx.schema.dropTable('memories').ifExists().execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  // This migration is not safely reversible due to ID remapping.
  // A backup should be taken before running.
  await trx.schema.dropTable('entries').execute();
}
