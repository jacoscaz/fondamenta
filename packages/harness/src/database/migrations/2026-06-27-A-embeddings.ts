import { Kysely, sql } from 'kysely';

export async function up(trx: Kysely<any>): Promise<void> {
  // Enable the pgvector extension
  await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(trx);

  // Add nullable embedding column to continuity_records.
  // text-embedding-3-small produces 1536-dimensional vectors.
  await trx.schema
    .alterTable('continuity_records')
    .addColumn('embedding', sql`vector(1536)`)
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema
    .alterTable('continuity_records')
    .dropColumn('embedding')
    .execute();
}
