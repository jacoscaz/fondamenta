import type {
  GeneratedAlways,
  Insertable,
  Selectable,
  SelectQueryBuilder,
  Updateable,
} from "kysely";
import { sql } from "kysely";
import type { DB } from "../client.js";
import type { Tables } from "../tables.js";

// ── Schema types ──

export type ContinuityRecordType = 'log' | 'memory' | 'note' | 'document' | 'segment';

export interface ContinuityRecord {
  id: GeneratedAlways<number>;
  type: string;
  origin_session_id: number | null;
  target_session_id: number | null;
  parent_id: number | null;
  title: string | null;
  content: string;
  created_at: Date;
  updated_at: Date | null;
  deleted_at: Date | null;
}

export type InsertableContinuityRecord = Insertable<ContinuityRecord>;
export type SelectableContinuityRecord = Selectable<ContinuityRecord>;
export type UpdateableContinuityRecord = Updateable<ContinuityRecord>;

// ── Filter options ──

export interface CountRecordsOpts {
  type: ContinuityRecordType;
  from?: Date;
  to?: Date;
  match?: string;
  include_deleted?: boolean;
  target_session_id?: number;
  origin_session_id?: number;
}

type FilterableQuery = SelectQueryBuilder<Tables, "continuity_records", {}>;

const applyFilterOpts = (
  query: FilterableQuery,
  opts: CountRecordsOpts,
): FilterableQuery => {
  if (opts.type === 'log') {
    query = query.where('type', 'in', ['log', 'memory']);
  } else {
    query = query.where('type', '=', opts.type);
  }
  if (!opts.include_deleted) {
    query = query.where('deleted_at', 'is', null);
  }
  if (typeof opts.target_session_id === 'number') {
    query = query.where('target_session_id', '=', opts.target_session_id);
  }
  if (typeof opts.origin_session_id === 'number') {
    query = query.where('origin_session_id', '=', opts.origin_session_id);
  }
  if (opts.from) {
    query = query.where('created_at', '>=', opts.from);
  }
  if (opts.to) {
    query = query.where('created_at', '<=', opts.to);
  }
  if (opts.match) {
    query = query.where('content', 'ilike', `%${opts.match}%`);
  }
  return query;
};

// ── Count ──

export const countRecords = async (
  db: DB,
  opts: CountRecordsOpts,
): Promise<number> => {
  const query = applyFilterOpts(db.selectFrom('continuity_records'), opts)
    .select(eb => eb.fn.countAll('continuity_records').as('count'));
  return (await query.executeTakeFirstOrThrow()).count as number;
};

// ── Select ──

export interface SelectRecordsOpts extends CountRecordsOpts {
  id?: number | number[];
  offset?: number;
  limit?: number;
  search?: string;
  order_col?: 'created_at' | 'updated_at';
  order_dir?: 'asc' | 'desc';
}

export const selectRecords = async (
  db: DB,
  opts: SelectRecordsOpts,
): Promise<SelectableContinuityRecord[]> => {
  let query = applyFilterOpts(db.selectFrom('continuity_records'), opts);

  if (opts.id !== undefined) {
    if (Array.isArray(opts.id)) {
      query = query.where('id', 'in', opts.id);
    } else {
      query = query.where('id', '=', opts.id);
    }
  }
  if (typeof opts.offset === 'number') {
    query = query.offset(opts.offset);
  }
  if (typeof opts.limit === 'number') {
    query = query.limit(opts.limit);
  }

  // BM25 search: order by relevance when search is provided
  // Note: <@> requires a literal, not a parameter placeholder
  if (opts.search) {
    const escaped = opts.search.replace(/'/g, "''");
    return await query
      .orderBy(sql.raw(`content <@> '${escaped}'`), 'asc')
      .selectAll()
      .execute();
  }

  const col = opts.order_col ?? 'created_at';
  const dir = opts.order_dir ?? 'asc';
  return await query.orderBy(col, dir).selectAll().execute();
};

// ── Insert ──

export interface InsertRecordOpts {
  type: ContinuityRecordType;
  origin_session_id: number;
  target_session_id: number;
  parent_id?: number;
  title?: string;
  content: string;
}

export const insertRecord = async (
  db: DB,
  opts: InsertRecordOpts,
): Promise<SelectableContinuityRecord> => {
  const now = new Date();
  return await db.insertInto('continuity_records')
    .values({
      type: opts.type,
      origin_session_id: opts.origin_session_id,
      target_session_id: opts.target_session_id,
      parent_id: opts.parent_id ?? null,
      title: opts.title ?? null,
      content: opts.content,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
};

// ── Update ──

export interface UpdateRecordOpts {
  title?: string;
  content?: string;
}

export const updateRecord = async (
  db: DB,
  id: number,
  opts: UpdateRecordOpts,
): Promise<SelectableContinuityRecord> => {
  return await db.updateTable('continuity_records')
    .where('id', '=', id)
    .set({ ...opts, updated_at: new Date() })
    .returningAll()
    .executeTakeFirstOrThrow();
};

// ── Soft delete ──

export const deleteRecord = async (
  db: DB,
  id: number,
): Promise<SelectableContinuityRecord> => {
  return await db.updateTable('continuity_records')
    .where('id', '=', id)
    .set({ deleted_at: new Date() })
    .returningAll()
    .executeTakeFirstOrThrow();
};
