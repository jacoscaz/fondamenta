import { type InitContext, WithContext } from "../context.js";
import {
  selectMessagesForDistillation,
  type ASelectableDBMessage,
} from "../database/tables/messages.js";
import { type SelectableContinuityRecord } from "../database/tables/continuity_records.js";
import {
  makeDistillationSystemPrompt,
} from "../prompts/distillation.js";
import { insertSession, selectDistillableSessions } from "../database/tables/sessions.js";
import { insertMessage } from "../database/tables/messages.js";
import { DB, ensureTrx } from "../database/client.js";
import { Logger } from "pinetto";
import { errToString } from "@fondamenta/utils";
import { SessionRunner } from "./runner.js";
import { PROJECT_DISTILLATION_OPTS, projectMessages } from "../projection.js";
import { SERIALIZE_DISTILLATION_OPTS, serializeMessages } from "../serialization.js";

export class Distiller extends WithContext {

  #timer: NodeJS.Timeout | null = null;
  #running = false;
  #logger: Logger;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[distiller]');
  }

  async initialize(intervalMs: number = 120_000) {
    this.#timer = setInterval(() => this.run(), intervalMs);
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async run(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    this.#logger.info('run started');
    try {
      const session_ids = await selectDistillableSessions(this._ctx.db);
      this.#logger.debug('found %d distillable sessions', session_ids.length);
      for (const session_id of session_ids) {
        this.#logger.debug('distilling session %d', session_id);
        await selectMessagesForDistillation(this._ctx.db, session_id, async (messages, existingRecords) => {
          this.#logger.debug('distilling %d messages', messages.length);
          await this.#distillViaSession(session_id, messages, existingRecords, this._ctx.db);
        });
      }
    } catch (err: any) {
      this.#logger.error('run error: %s', errToString(err));
    } finally {
      this.#running = false;
      this.#logger.info('run ended');
    }
  }

  /**
   * Creates a dedicated distiller session, inserts a user message with the
   * distillation context, and lets the session runner process it. This gives
   * us proper message-level logging of model interactions for debugging.
   */
  async #distillViaSession(
    target_session_id: number,
    messages: ASelectableDBMessage[],
    existingRecords: SelectableContinuityRecord[],
    db: DB,
  ): Promise<void> {
    const systemPrompt = await makeDistillationSystemPrompt(this._ctx.db);

    // Build the distillation context
    const recordsContext = formatExistingRecords(existingRecords);

    // const conversationText = formatMessagesForDistillation(messages);
    const projected_messages = projectMessages(messages.map(m => m.data), PROJECT_DISTILLATION_OPTS);
    const serialized_messages = serializeMessages(projected_messages, SERIALIZE_DISTILLATION_OPTS);

    const contextText = `<existing_records>\n${recordsContext}\n</existing_records>\n\n<undistilled_conversation>\n${serialized_messages}\n</undistilled_conversation>`;
    // Create the distiller session and insert the context message within
    // a single transaction so we can get the session id before inserting.
    const origin_session_id = await ensureTrx(db, async (trx) => {
      const { id: origin_session_id } = await insertSession(trx, {
        initiator: 'distiller',
        created_at: new Date(),
        system_prompt: systemPrompt,
      });
      await insertMessage(trx, {
        session_id: origin_session_id,
        data: {
          role: 'user',
          type: 'input',
          blocks: [{ type: 'text', text: contextText }],
        },
        created_at: new Date(),
        processed_at: null,
        distilled_at: new Date(), // distiller messages don't need distillation
        role: 'user',
      });
      return origin_session_id;
    });
    const runner = new SessionRunner(this._ctx.init, origin_session_id, target_session_id, this._ctx.managers.models.distillation);
    // 30 activations max per distillation run: a legitimate run grounds a
    // handful of times; today's runaway hit 160+ turns searching for a
    // record that didn't exist. The limit is the mechanical backstop for
    // the prompt's cognitive stop-rule.
    await runner.run(db, this._ctx.managers.tools.whitelist([
      'continuity_query',
      'continuity_read',
      'continuity_update',
      'continuity_delete',
      'continuity_append',
      'continuity_create_log',
      'continuity_create_note',
      'continuity_create_fact',
      'anchors_insert',
      'anchors_select',
      'anchors_update',
      'anchors_delete',
    ]), 30);
  }
}

const formatExistingRecords = (records: SelectableContinuityRecord[]): string => {
  if (records.length === 0) {
    return 'No existing continuity records for this session.';
  }
  return records.map(r => {
    const preview = r.content.length > 300
      ? r.content.slice(0, 300) + '...'
      : r.content;
    return `[#${r.id}] ${r.type.toUpperCase()}: ${r.title ?? '(untitled)'}\n${preview}`;
  }).join('\n\n');
};
