import { sql } from 'kysely';
import { Kysely } from 'kysely';

/**
 * Transform messages.data from { role, block } to { role, blocks }.
 *
 * Rationale (2026-08-29): a single assistant response can legitimately carry
 * multiple blocks (e.g. text plus several tool_use_req). Storing one block
 * per message forced #parse to split such responses into multiple rows,
 * losing the provider's grouping — which some OpenAI-compatible providers
 * care about on replay. An array of blocks preserves the original response
 * shape; one tool result per user message following it restores the exact
 * wire format at request time.
 */
export async function up(trx: Kysely<any>): Promise<void> {
  await trx.updateTable('messages')
    .set({
      data: sql`
        jsonb_set(
          jsonb_build_object(
            'role', data->'role',
            'blocks', jsonb_build_array(data->'block')
          ),
          '{processed_at}',
          data->'processed_at'
        )
      `,
    })
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.updateTable('messages')
    .set({
      data: sql`
        jsonb_set(
          jsonb_build_object(
            'role', data->'role',
            'block', data->'blocks'->0
          ),
          '{processed_at}',
          data->'processed_at'
        )
      `,
    })
    .execute();
}
