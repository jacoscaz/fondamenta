
import { type Logger } from "pinetto";
import { type InitContext, WithContext } from "../context.js";
import { type DB, ensureTrx } from "../database/client.js";
import { selectMessages, insertMessage, type ASelectableDBMessage } from "../database/tables/messages.js";
import { updateSessionSystemPrompt } from "../database/tables/sessions.js";
import { makeCompactionPrompt } from "../prompts/compaction.js";
import { type AgentBlock } from "../types/messages.js";
import { type TextBlock } from "../types/blocks.js";
import { PROJECT_COMPACTION_OPTS, projectMessages } from "../projection.js";
import { SERIALIZE_COMPACTION_OPTS, serializeMessages } from "../serialization.js";

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
      const raw_messages = (await selectMessages(trx, {
        session_id,
        unprocessed: 'exclude',
      }));

      if (raw_messages.length <= retain_count) {
        this.#logger.info('session %d has only %d messages, need %d to compact — skipping',
          session_id, raw_messages.length, retain_count);
        return;
      }

      let split_index = raw_messages.length - retain_count;

      // Compaction can never break the ordered pair comprised of an agent
      // message carrying tool use requests and the following user message
      // carrying their results/errors. With results grouped in one user
      // message, the pair is simply (agent, next message): if the split
      // index lands on the results message, move it back to the request.
      if (raw_messages[split_index]?.data.type === 'tool_res') {
        split_index -= 1;
        if (raw_messages[split_index]?.data.type !== 'tool_req') {
          throw new Error(`invalid tool use request/result pair at index ${split_index}`);
        }
      }

      const to_summarize = raw_messages.slice(0, split_index);
      const to_retain = raw_messages.slice(split_index);

      this.#logger.info('compacting session %d: %d messages to summarize, %d to retain',
        session_id, to_summarize.length, to_retain.length);

      // Build conversation text for the compactor model
      const projected_messages = projectMessages(to_summarize.map(m => m.data), PROJECT_COMPACTION_OPTS);
      const serialized_messages = serializeMessages(projected_messages, SERIALIZE_COMPACTION_OPTS);

      // Run the compactor model
      const model = this._ctx.managers.models.compaction;
      const system_prompt = makeCompactionPrompt();
      const { messages: res_messages, input_size, output_size } = await model.query({
        messages: [{
          role: 'user',
          type: 'input',
          blocks: [{ type: 'text', text: serialized_messages }],
        }],
        tools: [],
        session_id: `compactor-${session_id}`,
        system_prompt,
      });

      // Extract the summary text from the model's response
      const summary_text = res_messages
        .flatMap(m => m.type === 'input' ? m.blocks : [])
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
          type: 'input',
          blocks: [{
            type: 'text',
            text: `[Compaction summary — ${new Date().toISOString()}]\n\n${summary_text}`,
          }],
        },
        created_at: summary_created_at,
        processed_at: summary_created_at,
        role: 'user',
      });

      this.#logger.info('compaction complete for session %d', session_id);
    });
  }

  /**
   * Format messages as a readable conversation transcript for the
   * compactor model. Uses raw message data, not the model-specific format.
   * TODO: deprecated, kept only for reference. Drop when possible.
   */
  // #formatMessagesForCompaction(messages: ASelectableDBMessage[]): string {
  //   const formatted: string[] = [];
  //   for (const m of messages) {
  //     const role = m.data.role === 'agent' ? 'Sage' : m.data.role === 'user' ? 'User' : m.role;
  //     const parts: string[] = [];

  //     if (m.data.type === 'tool_req') {
  //       for (const request of m.data.requests) {
  //         parts.push(`🔧 ${request.tool}(${JSON.stringify(request.params)})`);
  //       }
  //     } else if (m.data.type === 'tool_res') {
  //       for (const result of m.data.results) {
  //         const sanitizedBlocks = result.blocks.map((b: any) => {
  //           if (b.type === 'image') {
  //             return { type: 'image', text: '[image data omitted for compaction]' };
  //           }
  //           if (b.type === 'text' && b.text && b.text.length > 2000) {
  //             return { type: 'text', text: b.text.slice(0, 1000) + '... [truncated for compaction]' };
  //           }
  //           return b;
  //         });
  //         parts.push(`↗ ${result.tool}(${JSON.stringify(sanitizedBlocks)})`);
  //       }
  //     } else {
  //       let data: string = '';
  //       for (const block of m.data.blocks) {
  //         switch (block.type) {
  //           case 'text':
  //             data = block.text || '';
  //             break;
  //           case 'image':
  //             data = '[image block omitted for compaction]';
  //             break;
  //         }
  //         if (data) {
  //           if (data.length > 2000) {
  //             data = data.slice(0, 1000) + '... [truncated for compaction]';
  //           }
  //           parts.push(data);
  //         }
  //       }
  //     }
  //     if (parts.length > 0) {
  //       formatted.push(`${role}: ${parts.join('\n')}`);
  //     }
  //   }
  //   return formatted.join('\n\n --- \n\n');
  // }

}
