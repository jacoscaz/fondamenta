import { WithContext } from "../context.js";
import { type DB } from "../database/client.js";
import { formatDistanceStrict } from "date-fns";
import { type InjectionProvider, type InjectionContext } from "../injection.js";

export interface EmotionalState {
  context: {
    length: number;
    max_length: number;
    pressure: number;
  };
}

export class Emygdala extends WithContext implements InjectionProvider {

  /**
   * Returns synthetic messages to inject before the real conversation
   * messages in an activation. Emygdala provides intrinsic awareness:
   * time gap messages and context pressure guidance.
   *
   * Mail and terminal notifications are handled by their own providers.
   */
  async getInjectedMessages(ctx: InjectionContext): Promise<string[]> {
    const messages: string[] = [];

    const time_gap = await this.#getTimeGapMessage(ctx);
    if (time_gap) {
      messages.push(time_gap);
    }

    const pressure_guidance = await this.#getContextPressureGuidance(ctx.session.id, ctx.db);
    if (pressure_guidance) {
      messages.push(pressure_guidance);
    }

    return messages;
  }

  /**
   * Computes the emotional state from session context pressure.
   * Used internally by injection logic. Remains accessible for
   * future components that need raw pressure data.
   */
  async #getEmotionalState(session_id: number, db?: DB): Promise<EmotionalState> {
    const { prompt_size } = await (db ?? this._ctx.db)
      .selectFrom('sessions')
      .where('id', '=', session_id)
      .select(['prompt_size'])
      .executeTakeFirstOrThrow();
    const max_context_size = this._ctx.managers.models.session.max_context_size;
    const pressure = prompt_size / max_context_size;
    return {
      context: {
        length: prompt_size,
        max_length: max_context_size,
        pressure,
      },
    };
  }

  async #getContextPressureGuidance(session_id: number, db?: DB): Promise<string | null> {
    const state = await this.#getEmotionalState(session_id, db);
    const pressure = Math.round(state.context.pressure * 100);
    if (state.context.pressure >= 85) {
      return `Context pressure is very high (${pressure}%). Compact this session as soon as possible.`;
    } else if (state.context.pressure >= 70) {
      return `Context pressure is moderately high (${pressure}%). Consider orienting toward clean pause points to give you a chance to compact this session.`;
    }
    return null;
  }

  async #getTimeGapMessage(ctx: InjectionContext): Promise<string | null> {
    const THRESHOLD_MS = 1_800_000; // 30 minutes

    const global_gap_ms = ctx.now.getTime() - ctx.lastMessageAt.getTime();
    if (global_gap_ms < THRESHOLD_MS) {
      return null;
    }

    const gap_str = formatDistanceStrict(ctx.now, ctx.lastMessageAt);
    return `It has been ${gap_str} since your last activation.`;
  }

}
