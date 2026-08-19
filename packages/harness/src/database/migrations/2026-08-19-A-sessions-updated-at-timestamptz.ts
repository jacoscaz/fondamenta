import { sql } from 'kysely';
import { Kysely } from 'kysely';

/**
 * Migrate sessions.updated_at from `timestamp without time zone` to
 * `timestamp with time zone` (timestamptz).
 *
 * The original column was created as `timestamp` (without time zone) in
 * migration 2026-02-28-B-session-token-tracking.ts. The postgres-js
 * driver returns strings for `timestamp without time zone` instead of
 * Date objects, which caused silent type coercion bugs (e.g. emygdala
 * time-gap false positives because valueOf() on a string returns NaN
 * in arithmetic context).
 *
 * Converting to timestamptz makes the driver return proper Date objects
 * natively, matching the TypeScript interface declaration and the
 * behavior of created_at (which was already timestamptz).
 *
 * The `USING updated_at AT TIME ZONE 'UTC'` clause tells PostgreSQL to
 * interpret the existing values as UTC (which is how they were written
 * via `now()`), so no timestamps shift during conversion.
 */
export async function up(trx: Kysely<any>): Promise<void> {
  await trx.schema.alterTable('sessions')
    .alterColumn('updated_at', col => col
      .setDataType(sql`timestamptz USING updated_at AT TIME ZONE 'UTC'`)
    )
    .execute();
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.alterTable('sessions')
    .alterColumn('updated_at', col => col
      .setDataType(sql`timestamp USING updated_at AT TIME ZONE 'UTC'`)
    )
    .execute();
}
