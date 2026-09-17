import { Kysely, sql } from 'kysely';

/**
 * Drop the fixed dimension constraint on continuity_records.embedding.
 *
 * The column was created as vector(1536) when embeddings were produced by
 * qwen3-embedding-8b via OpenRouter. Moving to locally-served embedding
 * models (possibly several, experimentally) requires the column to accept
 * any dimensionality. pgvector allows a dimensionless `vector` column.
 *
 * Trade-offs, accepted deliberately:
 * - No ANN index is possible on a dimensionless column — but none exists
 *   today; search is a sequential scan with <=>, fine at current scale.
 * - Distance operators error on mismatched dimensions, so model swaps
 *   MUST null the entire column and re-embed with a single model. The
 *   embedder loop (batches of 20, embedding IS NULL) already supports
 *   this workflow.
 */
export async function up(trx: Kysely<any>): Promise<void> {
  await trx.schema.alterTable('continuity_records')
    .alterColumn('embedding', col => col
      .setDataType(sql`vector`)
    )
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  // Down requires all stored vectors to share one dimensionality; the
  // USING clause nulls the column rather than guessing a common dim.
  await trx.schema.alterTable('continuity_records')
    .alterColumn('embedding', col => col
      .setDataType(sql`vector(1536) USING NULL`)
    )
    .execute();
}
