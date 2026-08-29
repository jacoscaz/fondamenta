import { Kysely } from 'kysely';

/**
 * Drop the `raw` column from messages.
 *
 * Rationale (2026-08-29): `raw` was a per-model formatted cache of each
 * message, added when Anthropic thinking-block signatures had no canonical
 * equivalent. With multiple substrates in play, a cached provider-format
 * payload is a hazard: it bypasses on-demand re-formatting whenever the
 * model changes, and nothing invalidated it on model identity change
 * (crash of 2026-08-29: a GLM-Flash raw containing an image block was sent
 * verbatim to a text-only model, 404ing in a retry loop).
 *
 * All frameworks surveyed store ONE canonical representation and translate
 * to the provider format at request time. The canonical `data` column is
 * the source of truth; translation happens in the model adapter on every
 * query. Thinking-block fidelity, if a future Anthropic adapter needs it,
 * belongs in the canonical schema (see ThinkingBlock.anthropic_signature),
 * not in parallel storage.
 */
export async function up(trx: Kysely<any>): Promise<void> {
  await trx.schema
    .alterTable('messages')
    .dropColumn('raw')
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema
    .alterTable('messages')
    .addColumn('raw', 'jsonb')
    .execute();
}
