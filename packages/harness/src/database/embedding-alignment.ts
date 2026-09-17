import { sql, type DB } from './client.js';
import { type Logger } from 'pinetto';

/**
 * Startup dimension alignment for continuity_records.embedding.
 *
 * Regular migrations are frozen history; the embedding model is
 * configuration and may change independently of the code. This runs
 * after migrateToLatest at every boot and reconciles the column with
 * the configured embedding model's dimensionality:
 *
 *  a) Content check — the dimension of the most recently computed
 *     embedding (the embedder enforces a single model, so one row
 *     speaks for the whole column) is compared against the configured
 *     dimension. On mismatch the entire column is nulled, which makes
 *     the embedder loop re-embed everything in the background.
 *  b) Type check — the column is (re)typed to vector(dimensions). A
 *     typed column is what makes ANN indexes possible; a dimensionless
 *     column (the historical state left by migration 2026-09-15-A)
 *     forces sequential scans forever. Retyping is safe: content
 *     either matches the configured dimension or was nulled in (a).
 *
 * pgvector's atttypmod equals the dimension for typed columns and -1
 * for dimensionless ones (verified empirically against PostgreSQL 17 /
 * pgvector, 2026-09-17), so typmod comparison is exact.
 */
export const alignEmbeddingDimensions = async (db: DB, dimensions: number, logger: Logger): Promise<void> => {
  const typmod_res = await sql<{ atttypmod: number }>`
    SELECT atttypmod FROM pg_attribute
    WHERE attrelid = 'continuity_records'::regclass AND attname = 'embedding'
  `.execute(db);
  const typmod = typmod_res.rows[0]?.atttypmod ?? -1;

  const dims_res = await sql<{ dims: number }>`
    SELECT vector_dims(embedding) AS dims
    FROM continuity_records WHERE embedding IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `.execute(db);
  const content_dims = dims_res.rows[0]?.dims ?? null;

  if (content_dims !== null && content_dims !== dimensions) {
    await sql`UPDATE continuity_records SET embedding = NULL WHERE embedding IS NOT NULL`.execute(db);
    logger.warn(`embedding dimension mismatch: stored vectors are ${content_dims}-dim, model configured for ${dimensions}-dim — column nulled, re-embedding will run in the background`);
  }

  if (typmod !== dimensions) {
    // Type names cannot be bind parameters in DDL; the number comes
    // from local config, so literal interpolation is safe.
    await sql`ALTER TABLE continuity_records ALTER COLUMN embedding TYPE vector(${sql.lit(dimensions)})`.execute(db);
    logger.info(`embedding column retyped vector(${dimensions}) (was ${typmod === -1 ? 'dimensionless' : `vector(${typmod})`})`);
  }
};
