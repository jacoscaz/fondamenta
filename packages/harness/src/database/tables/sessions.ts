
import type { Selectable } from "kysely";
import type { Updateable } from "kysely";
import type { Insertable } from "kysely";
import type { GeneratedAlways } from "kysely";
import type { DB } from "../client.js";
import type { Tables } from "../tables.js";
import { SelectQueryBuilder } from "kysely";
import { sql } from "kysely";

export type SessionInitiator = 'user' | 'agent' | 'distiller';

export interface Session {
  id: GeneratedAlways<number>;
  initiator: SessionInitiator;
  connected: boolean;
  created_at: Date;
  updated_at: Date;
  input_tokens_count: number;
  output_tokens_count: number;
  prompt_size: number;
  system_prompt: string;
}

export type InsertableSession = Insertable<Session>;
export type SelectableSession = Selectable<Session>;
export type UpdateableSession = Updateable<Session>;

export const insertSession = async (db: DB, session: Pick<InsertableSession, 'created_at' | 'initiator' | 'system_prompt'>): Promise<SelectableSession> => {
  const result = await db.insertInto('sessions')
    .values({
      initiator: session.initiator,
      created_at: session.created_at,
      updated_at: session.created_at,
      system_prompt: session.system_prompt,
      connected: false,
      input_tokens_count: 0,
      output_tokens_count: 0,
      prompt_size: 0,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return result;
};

export const selectSessionById = async (db: DB, id: number): Promise<SelectableSession> => {
  const query = db.selectFrom('sessions')
    .where('id', '=', id)
    .selectAll('sessions');
  return await query.executeTakeFirstOrThrow();
};

export interface SelectSessionOpts {
  order_by?: 'created_at' | 'updated_at';
  order_dir?: 'asc' | 'desc';
}

export const selectSessions = async (db: DB, opts?: SelectSessionOpts): Promise<SelectableSession[]> => {
  let query = db.selectFrom('sessions');
  if (opts?.order_by) {
    query = query.orderBy(opts.order_by, opts.order_dir ?? 'asc');
  } else {
    query = query.orderBy('created_at', 'asc');
  }
  return await query.selectAll().execute();
};

export const connectSession = async (db: DB, id: number): Promise<boolean> => {
  await db.updateTable('sessions')
    .where('id', '=', id)
    .where('connected', '=', false)
    .executeTakeFirstOrThrow();
  return true;
};

export interface UpdateTokensOpts {
  prompt_size: number;
  input_tokens_delta: number;
  output_tokens_delta: number;
}

export const updateSessionTokens = async (db: DB, id: number, opts: UpdateTokensOpts): Promise<void> => {
  await db.updateTable('sessions')
    .where('id', '=', id)
    .set({
      updated_at: sql`now()`,
      prompt_size: opts.prompt_size,
      input_tokens_count: eb => sql`${eb.ref('input_tokens_count')} + ${opts.input_tokens_delta}`,
      output_tokens_count: eb => sql`${eb.ref('output_tokens_count')} + ${opts.output_tokens_delta}`,
    })
    .execute();
};

export const updateSessionSystemPrompt = async (db: DB, id: number, system_prompt: string): Promise<void> => {
  await db.updateTable('sessions')
    .where('id', '=', id)
    .set({
      updated_at: sql`now()`,
      system_prompt,
    })
    .execute();
};

export const selectDistillableSessions = async (db: DB): Promise<number[]> => {
  const sessions = await db.selectFrom('messages')
    .where('distilled_at', 'is', null)
    .where('processed_at', 'is not', null)
    .select('session_id')
    .distinct()
    .where('session_id', 'in', qb => qb.selectFrom('sessions')
      .select('sessions.id')
      .where('initiator', '!=', 'distiller'))
    .execute();
  return sessions.map(s => s.session_id);
};
