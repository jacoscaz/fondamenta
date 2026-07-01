import { Kysely, sql } from 'kysely';
import { EMBEDDING_DIMENSIONS } from '../../constants.js';

export async function up(trx: Kysely<any>): Promise<void> {
  // Enable the pgvector extension
  await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(trx);

  // Add nullable embedding column to continuity_records.
  await trx.schema
    .alterTable('continuity_records')
    .addColumn('embedding', sql.raw(`vector(${EMBEDDING_DIMENSIONS})`))
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema
    .alterTable('continuity_records')
    .dropColumn('embedding')
    .execute();
}
