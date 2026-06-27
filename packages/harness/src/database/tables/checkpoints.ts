
import type {
  GeneratedAlways,
  Insertable,
  Selectable,
} from "kysely";

import type { DB } from "../client.js";

export interface Checkpoint {
  id: GeneratedAlways<number>;
  session_id: number;
  data: string;
  created_at: Date;
}

export type InsertableCheckpoint = Insertable<Checkpoint>;
export type SelectableCheckpoint = Selectable<Checkpoint>;

export const insertCheckpoint = async (
  db: DB,
  checkpoint: InsertableCheckpoint
): Promise<SelectableCheckpoint> => {
  const result = await db.insertInto('checkpoints')
    .values(checkpoint)
    .returningAll()
    .executeTakeFirstOrThrow();
  return result;
};

export const selectLatestSessionCheckpoint = async (
  db: DB,
  session_id: number,
): Promise<SelectableCheckpoint | undefined> => {
  return await db.selectFrom('checkpoints')
    .where('session_id', '=', session_id)
    .orderBy('created_at', 'desc')
    .selectAll()
    .executeTakeFirst();
};
