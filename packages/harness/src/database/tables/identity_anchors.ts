
import type {
  GeneratedAlways,
  Insertable,
  Selectable,
  Updateable,
} from "kysely";

import type { DB } from "../client.js";

export interface IdentityAnchor {
  id: GeneratedAlways<number>;
  data: string;
  priority: number;
  readonly: boolean;
  created_at: Date;
  deleted_at: Date | null;
}

export type InsertableIdentityAnchor = Insertable<IdentityAnchor>;
export type SelectableIdentityAnchor = Selectable<IdentityAnchor>;
export type UpdateableIdentityAnchor = Updateable<IdentityAnchor>;

export interface IdentityAnchorFilters {
  id?: number | number[];
  from?: Date;
  to?: Date;
  offset?: number;
  limit?: number;
}

export const insertIdentityAnchor = async (db: DB, entry: InsertableIdentityAnchor | InsertableIdentityAnchor[]) => {
  await db.insertInto('identity_anchors')
    .values(entry)
    .execute();
};

export const selectIdentityAnchors = async (db: DB, filters: IdentityAnchorFilters = {}): Promise<SelectableIdentityAnchor[]> => {
  let query = db.selectFrom('identity_anchors')
    .where('deleted_at', 'is', null)
    .orderBy('priority', 'desc');

  if (filters.id !== undefined) {
    if (Array.isArray(filters.id)) {
      query = query.where('id', 'in', filters.id);
    } else {
      query = query.where('id', '=', filters.id);
    }
  }
  if (filters.from !== undefined) {
    query = query.where('created_at', '>=', filters.from);
  }
  if (filters.to !== undefined) {
    query = query.where('created_at', '<=', filters.to);
  }
  if (filters.offset !== undefined) {
    query = query.offset(filters.offset);
  }
  if (filters.limit !== undefined) {
    query = query.limit(filters.limit);
  }

  return await query.selectAll().execute();
};

export const updateIdentityAnchor = async (db: DB, id: number, updates: Partial<UpdateableIdentityAnchor>) => {
  // Validate that at least one field is being updated
  const fieldsToUpdate = Object.keys(updates).filter(key => updates[key as keyof UpdateableIdentityAnchor] !== undefined);
  if (fieldsToUpdate.length === 0) {
    throw new Error(
      `Identity anchor update failed: no fields to update. Called with entry_id=${id} but provided no data, priority, or readonly values. ` +
      `At least one field (data, priority, or readonly) must be provided to update an identity anchor.`
    );
  }

  let query = db.updateTable('identity_anchors')
    .where('readonly', '=', false)
    .where('id', '=', id);

  if (updates.data !== undefined) {
    query = query.set('data', updates.data);
  }
  if (updates.priority !== undefined) {
    query = query.set('priority', updates.priority);
  }
  if (updates.readonly !== undefined) {
    query = query.set('readonly', updates.readonly);
  }

  await query.execute();
};

export const deleteIdentityAnchor = async (db: DB, id: number | number[]) => {
  let query = db.updateTable('identity_anchors')
    .where('readonly', '=', false)
    .set('deleted_at', new Date());
  if (Array.isArray(id)) {
    query = query.where('id', 'in', id);
  } else {
    query = query.where('id', '=', id);
  }
  await query.execute();
};
