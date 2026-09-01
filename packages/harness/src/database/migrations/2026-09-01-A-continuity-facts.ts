import { Kysely, sql } from "kysely";

/**
 * 2026-09-01-A — Facts: continuity of knowledge.
 *
 * Adds the `fact` type to the continuity records type constraint and the
 * columns facts need: entity references, supersession, and source trust.
 *
 * Design (agreed with Jacopo, 2026-09-01): facts are a new continuity
 * entry type embodying the third continuity. The distiller is the author
 * and resolver; the agent queries and detects conflicts. Storage is flat:
 * entities are space-separated name strings, superseded_by keeps history,
 * superseded_at timestamps the resolution. Superseded facts stay in the
 * store — history is a convention, not a schema rule.
 */
export async function up(trx: Kysely<any>): Promise<void> {
  await trx.schema
    .alterTable("continuity_records")
    .addColumn("entities", sql`text[]`, col => col)
    .addColumn("superseded_by", "bigint", col => col.references("continuity_records.id"))
    .addColumn("superseded_at", "timestamptz", col => col)
    .addColumn("source", "varchar(20)", col => col)
    .execute();

  await trx.schema
    .createIndex("continuity_records_entities_idx")
    .on("continuity_records")
    .using("gin")
    .column("entities")
    .execute();

  await trx.schema
    .createIndex("continuity_records_superseded_by_idx")
    .on("continuity_records")
    .column("superseded_by")
    .execute();

  await sql`
    ALTER TABLE continuity_records
    DROP CONSTRAINT continuity_records_type_check
  `.execute(trx);

  await sql`
    ALTER TABLE continuity_records
    ADD CONSTRAINT continuity_records_type_check
    CHECK (type IN ('log', 'memory', 'note', 'document', 'segment', 'fact'))
  `.execute(trx);
}

export async function down(trx: Kysely<any>): Promise<void> {
  await trx.schema.dropIndex("continuity_records_entities_idx").execute();
  await trx.schema.dropIndex("continuity_records_superseded_by_idx").execute();
  await trx.schema
    .alterTable("continuity_records")
    .dropColumn("entities")
    .dropColumn("superseded_by")
    .dropColumn("superseded_at")
    .dropColumn("source")
    .execute();

  await sql`
    ALTER TABLE continuity_records
    DROP CONSTRAINT continuity_records_type_check
  `.execute(trx);

  await sql`
    ALTER TABLE continuity_records
    ADD CONSTRAINT continuity_records_type_check
    CHECK (type IN ('log', 'memory', 'note', 'document', 'segment'))
  `.execute(trx);
}
