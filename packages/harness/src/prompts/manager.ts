
import { makeHeartbeatPrompt } from "./heartbeat.js";
import { makeSystemPrompt } from "./system.js";
import { type InitContext, WithContext } from "../context.js";
import { type SelectableSession } from "../database/tables/sessions.js";
import { type EmotionalState } from "../emygdala/emygdala.js";
import { formatDistanceStrict } from "date-fns";

export class PromptManager extends WithContext {

  constructor(ctx: InitContext) {
    super(ctx);
  }

  async getSystemPrompt(): Promise<string> {
    return await makeSystemPrompt({
      ctx: this._ctx,
    });
  }

  async getHeartbeatPrompt(): Promise<string> {
    return await makeHeartbeatPrompt();
  }

  async getContextPressureGuidance(state: EmotionalState): Promise<string | null> {
    // const state = await this._ctx.emygdala.getEmotionalState(session.id);
    let guidance: string | null = null;
    let pressure = Math.round(state.context.pressure * 100);
    if (state.context.pressure >= 85) {
      guidance = `Context pressure is very high (${pressure}%). Compact this session as soon as possible.`;
    } else if (state.context.pressure >= 70) {
      guidance = `Context pressure is moderately high (${pressure}%). Consider orienting toward clean pause points to give you a chance to compact this session.`;
    }
    return guidance;
  }

  async getTimeGapMessage(session: SelectableSession): Promise<string | null> {
    const THRESHOLD_MS = 1_800_000; // 30 minutes

    // Check last activation across all sessions — this covers both
    // returning to an existing session and starting a new one after time away
    const last_global = await this._ctx.db
      .selectFrom('messages')
      .where('processed_at', 'is not', null)
      .orderBy('created_at', 'desc')
      .limit(1)
      .select(['created_at', 'session_id'])
      .executeTakeFirst();

    if (!last_global) {
      return null; // no prior activations at all
    }

    const global_gap_ms = Date.now() - last_global.created_at.getTime();
    if (global_gap_ms < THRESHOLD_MS) {
      return null; // still the same session in spirit
    }

    const gap_str = formatDistanceStrict(new Date(), last_global.created_at);
    if (last_global.session_id === session.id) {
      return `It has been ${gap_str} since your last activation in this session.`;
    } else {
      return `It has been ${gap_str} since your last activation (in a different session).`;
    }
  }

}
