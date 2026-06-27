
import { type GeneratedAlways } from "kysely";
import { type Insertable } from "kysely";
import { type Selectable } from "kysely";
import { type Updateable } from "kysely";
import { type DB, ensureTrx } from "../client.js";
import { type Message } from "../../models/types/messages.js";
import { type SelectableContinuityRecord } from "./continuity_records.js";
import assert from "node:assert";

export interface ADBMessage {
  id: GeneratedAlways<number>;
  session_id: number;
  created_at: Date;
  processed_at: Date | null;
  distilled_at: Date | null;
  role: 'user' | 'agent';
  raw: any | any[] | null;
  data: Message;
}

export type AInsertableDBMessage = Insertable<ADBMessage>;
export type ASelectableDBMessage = Selectable<ADBMessage>;
export type AUpdateableDBMessage = Updateable<ADBMessage>;

export const insertMessage = async (db: DB, message: AInsertableDBMessage): Promise<ASelectableDBMessage> => {
  const result = await db.insertInto('messages')
    .values(message)
    .returningAll()
    .executeTakeFirstOrThrow();
  return result;
};

export const updateMessageRaw = async (db: DB, id: number, raw: any): Promise<ASelectableDBMessage> => {
  return await db.updateTable('messages')
    .set({ raw })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
};

export interface ADBSelectMessagesOpts {
  session_id: number;
  unprocessed?: 'include' | 'exclude';
}

export const selectMessages = async (db: DB, opts: ADBSelectMessagesOpts): Promise<ASelectableDBMessage[]> => {
  let query = db.selectFrom('messages')
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc');
  if (typeof opts.session_id === 'number') {
    query = query.where('session_id', '=', opts.session_id);
  }
  if (opts.unprocessed !== 'include') {
    query = query.where('processed_at', 'is not', null);
  }
  return await query.selectAll().execute();
};

export interface ADBDeleteMessagesOpts {
  session_id: number;
  unprocessed?: 'include' | 'exclude';
}

export const deleteMessages = async (db: DB, opts: ADBDeleteMessagesOpts): Promise<void> => {
  let query = db.deleteFrom('messages')
    .where('session_id', '=', opts.session_id);
  if (opts.unprocessed !== 'include') {
    query = query.where('processed_at', 'is not', null);
  }
  await query.execute();
};

/**
 * Calls the provided `handler` function with the entire conversation
 * history of the session if the latter contains unprocessed messages.
 * Persists messages returned by `handler`.
 *
 * This function is meant to be called in a `while()` loop: returns true
 * if execution might have created additional unprocessed messages, false
 * otherwise.
 *
 * This is one of the most critical functions of this entire project, if not
 * _the_ most critical.
 */
export const selectMessagesForActivation = async (db: DB, session_id: number, handler: (messages: ASelectableDBMessage[], db: DB) => Promise<AInsertableDBMessage[]>): Promise<boolean> => {
  // We run all of the above within a transaction so that if processing fails
  // for whatever reason we can resume from a coherent state.
  return await ensureTrx<boolean>(db, async (trx) => {
    // Retrieve latest non-processed message
    const not_proc = await trx.selectFrom('messages')
      .where('session_id', '=', session_id)
      .where('processed_at', 'is', null)
      .select('id')
      .limit(1)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (!not_proc) {
      // If we do not have any non-processed message for this session we signal
      // that the processing loop can stop.
      return false;
    }
    // Model queries require the entire conversation up to and including all
    // messages yet-to-be processed.
    const old_messages: ASelectableDBMessage[] = await trx.selectFrom('messages')
      .where('session_id', '=', session_id)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .selectAll()
      .execute();
    assert(old_messages.length > 0, `inconsistent state: no messages found for session ${session_id} even though there should be at least one unprocessed message`);
    // We pass the conversation to the handler, which will query the model and
    // return new messages.
    const new_messages = await handler(old_messages, trx);
    // The handler returned without errors. We now flag all non-processed
    // messages already in the database as processed.
    await trx.updateTable('messages')
      .set({ processed_at: new Date() })
      .where('session_id', '=', session_id)
      .where('processed_at', 'is', null)
      .execute();
    // Insert new messages returned by the handler.
    if (new_messages.length > 0) {
      await trx.insertInto('messages').values(new_messages).execute();
    }
    // We signal that the processing loop can continue, given we might just
    // have added new non-processed messages. Note that this might have been
    // done outside of this loop (`trx` is passed to `handler()` so that the
    // outcome of MCP calls can be persisted transactionally).
    return true;
  });
};

/**
 * Distillation variant: only passes undistilled messages to the handler,
 * along with existing continuity records for context. The handler is expected
 * to write to continuity_records via MCP tools (using the transactional db
 * handle). Returns a boolean to signal whether messages should be marked as
 * distilled — the handler returns false if there's nothing to distill yet
 * (e.g. all messages are still unprocessed).
 *
 * Like its sibling, meant to be called in a `while()` loop.
 */
export const selectMessagesForDistillation = async (
  db: DB,
  session_id: number,
  handler: (
    undistilled_messages: ASelectableDBMessage[],
    existing_records: SelectableContinuityRecord[],
    db: DB,
  ) => Promise<void>,
): Promise<void> => {
  return await ensureTrx<void>(db, async (trx) => {

    const processed_at_threshold = new Date(Date.now() - 2 * 60 * 1000);

    const undistilled = await trx.selectFrom('messages')
      .where('session_id', '=', session_id)
      .where('distilled_at', 'is', null)
      .where('processed_at', 'is not', null)
      .where('processed_at', '<', processed_at_threshold)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .selectAll()
      .execute();

    if (undistilled.length === 0) return;

    const existing_records = await trx.selectFrom('continuity_records')
      .where('target_session_id', '=', session_id)
      .where('deleted_at', 'is', null)
      .selectAll()
      .execute();

    await handler(undistilled, existing_records, trx);

    await trx.updateTable('messages')
      .set({ distilled_at: new Date() })
      .where('session_id', '=', session_id)
      .where('distilled_at', 'is', null)
      .where('processed_at', 'is not', null)
      .where('processed_at', '<', processed_at_threshold)
      .execute();

  });
};
