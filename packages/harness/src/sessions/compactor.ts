import { type Logger } from "pinetto";
import { type InitContext, WithContext } from "../context.js";
import { type DB, ensureTrx } from "../database/client.js";
import { selectMessages, insertMessage, type ASelectableDBMessage } from "../database/tables/messages.js";
import { updateSessionSystemPrompt } from "../database/tables/sessions.js";
import { makeCompactionPrompt } from "../prompts/compaction.js";
import { AgentBlock } from "../models/session/types/messages.js";
import { TextBlock } from "../models/session/types/blocks.js";
import assert from "node:assert";

/**
 * Tiered compaction: summarizes older messages via a dedicated model
 * while retaining recent messages verbatim. Replaces the previous
 * all-or-nothing compaction where I wrote a checkpoint under pressure.
 *
 * Procedure:
 * 1. Select all processed messages for the session
 * 2. Split: messages before the last N get summarized; last N retained
 * 3. Feed to-summarize messages to the compactor model
 * 4. Delete summarized messages, insert the summary, keep retained messages
 */
export class Compactor extends WithContext {

  #logger: Logger;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[compactor]');
  }

  /**
   * Compact a session: summarize older messages, retain recent ones.
   *
   * @param session_id  The session to compact
   * @param retain_count  Number of recent messages to keep verbatim
   * @param db  Database connection (may be a transaction)
   */
  async compact(session_id: number, retain_count: number = 20, db?: DB): Promise<void> {
    await ensureTrx(db ?? this._ctx.db, async (trx) => {
      // Select all processed messages
      const all_messages = await selectMessages(trx, {
        session_id,
        unprocessed: 'exclude',
      });

      if (all_messages.length <= retain_count) {
        this.#logger.info('session %d has only %d messages, need %d to compact — skipping',
          session_id, all_messages.length, retain_count);
        return;
      }

      let split_index = all_messages.length - retain_count;

      // Compaction can never break ordered pairs comprised of a tool use
      // request and the following result (response or error). If the split
      // index falls within such a pair, move it back to the request.
      if (all_messages[split_index].data.block.type === 'tool_use_err' || all_messages[split_index].data.block.type === 'tool_use_res') {
        split_index -= 1;
        if (all_messages[split_index]?.data.block.type !== 'tool_use_req') {
          throw new Error(`invalid tool use request/result pair at index ${split_index}`);
        }
      }

      const to_summarize = all_messages.slice(0, split_index);
      const to_retain = all_messages.slice(split_index);

      this.#logger.info('compacting session %d: %d messages to summarize, %d to retain',
        session_id, to_summarize.length, to_retain.length);

      // Build conversation text for the compactor model
      const conversation_text = this.#formatMessagesForCompaction(to_summarize);

      // Run the compactor model
      const model = this._ctx.managers.models.compaction;
      const system_prompt = makeCompactionPrompt();
      const { messages: raw_res_messages, input_size, output_size } = await model.query({
        messages: [model.format({
          role: 'user',
          block: { type: 'text', text: conversation_text },
        })],
        tools: [],
        session_id: `compactor-${session_id}`,
        system_prompt,
      });

      // Extract the summary text from the model's response
      const parsed = model.parse(raw_res_messages[0]);
      const summary_text = parsed.map(p => p[1].block)
        .filter((b: AgentBlock) => b.type === 'text')
        .map((b: TextBlock) => b.text)
        .join('\n');

      this.#logger.info('compaction summary: %d chars, input %d tokens, output %d tokens',
        summary_text.length, input_size, output_size);

      // Delete the summarized messages (by ID)
      const summarised_ids = to_summarize.map(m => m.id);
      await trx
        .deleteFrom('messages')
        .where('id', 'in', summarised_ids)
        .execute();

      // Regenerate the system prompt for constitutional changes
      const new_system_prompt = await this._ctx.managers.prompts.getSystemPrompt();
      await updateSessionSystemPrompt(trx, session_id, new_system_prompt);

      // Insert the summary message just before the first retained message
      const summary_created_at = new Date(to_retain[0].created_at.getTime() - 1);
      await insertMessage(trx, {
        session_id,
        data: {
          role: 'user',
          block: {
            type: 'text',
            text: `[Compaction summary — ${new Date().toISOString()}]\n\n${summary_text}`,
          },
        },
        created_at: summary_created_at,
        processed_at: summary_created_at,
        role: 'user',
        raw: null,
      });

      this.#logger.info('compaction complete for session %d', session_id);
    });
  }

  /**
   * Format messages as a readable conversation transcript for the
   * compactor model. Uses raw message data, not the model-specific format.
   */
  #formatMessagesForCompaction(messages: ASelectableDBMessage[]): string {
    const formatted: string[] = [];
    for (const m of messages) {
      const role = m.data.role === 'agent' ? 'Sage' : m.data.role === 'user' ? 'User' : m.role;
      let data: string = '';
      switch (m.data.block.type) {
        case 'text':
          data = m.data.block.text || '';
          break;
        case 'thinking':
          data = m.data.block.text || '';
          break;
        case 'tool_use_req':
          data = `🔧 ${m.data.block.tool}(${JSON.stringify(m.data.block.params)})`;
          break;
        case 'tool_use_res':
          data = `↗ ${m.data.block.tool}(${JSON.stringify(m.data.block.result)})`;
          break;
        case 'tool_use_err':
          data = `↗ ${m.data.block.tool}(${JSON.stringify(m.data.block.error)})`;
          break;
      }
      if (data) {
        formatted.push(`${role}: ${data}`);
      }
    }
    return formatted.join('\n\n');
  }

}
