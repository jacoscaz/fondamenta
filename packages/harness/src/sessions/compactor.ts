import { type Logger } from "pinetto";
import { type InitContext, WithContext } from "../context.js";
import { type DB, ensureTrx } from "../database/client.js";
import { selectMessages, insertMessage, type ASelectableDBMessage } from "../database/tables/messages.js";
import { updateSessionSystemPrompt } from "../database/tables/sessions.js";
import { makeCompactionPrompt } from "../prompts/compaction.js";

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

      const split_index = all_messages.length - retain_count;
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
        messages: model.format({
          role: 'user',
          blocks: [{ type: 'text', text: conversation_text }],
        }) as any,
        tools: [],
        session_id: `compactor-${session_id}`,
        system_prompt,
      });

      // Extract the summary text from the model's response
      const summary_message = model.parse(raw_res_messages[0], []);
      const summary_text = summary_message.blocks
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
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
          blocks: [{
            type: 'text',
            text: `[Compaction summary — ${new Date().toISOString()}]\n\n${summary_text}`,
          }],
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
    return messages.map(msg => {
      const role = msg.data.role === 'agent' ? 'Sage' : msg.data.role === 'user' ? 'User' : msg.role;
      const text_blocks = msg.data.blocks
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');
      const tool_blocks = msg.data.blocks
        .filter((b: any) => b.type === 'tool_use_req')
        .map((b: any) => `🔧 ${b.tool}(${JSON.stringify(b.params)})`)
        .join('\n');
      const tool_res_blocks = msg.data.blocks
        .filter((b: any) => b.type === 'tool_use_res')
        .map((b: any) => `← ${b.tool}: ${(b.result || []).map((r: any) => r.type === 'text' ? r.text : '').join('')}`)
        .join('\n');

      const parts = [text_blocks, tool_blocks, tool_res_blocks].filter(Boolean);
      return `[${role}]\n${parts.join('\n')}`;
    }).join('\n\n');
  }

}
