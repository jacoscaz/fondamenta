import { WithContext } from "../context.js";
import { type DB } from "../database/client.js";
import { type SelectableSession } from "../database/tables/sessions.js";
import { formatDistanceStrict } from "date-fns";
import { type InjectionProvider } from "../injection.js";

export interface EmotionalState {
  context: {
    length: number;
    max_length: number;
    pressure: number;
  };
}

/**
 * Parameters passed to Emygdala for injection message generation.
 * These describe the current harness state — what the runner knows,
 * the emygdala decides what to inject based on that state.
 */
export interface InjectionContext {
  /** The session being activated */
  session: SelectableSession;
  /** Database connection (may be a transaction from the activation loop) */
  db?: DB;
}

export class Emygdala extends WithContext implements InjectionProvider {

  readonly consumeOnCheck = false;

  /**
   * Returns synthetic messages to inject before the real conversation
   * messages in an activation. Emygdala provides intrinsic awareness:
   * time gap messages and context pressure guidance.
   *
   * Mail and terminal notifications are handled by their own providers.
   */
  async getInjectedMessages(ctx: InjectionContext): Promise<string[]> {
    const messages: string[] = [];

    const time_gap = await this.#getTimeGapMessage(ctx.session);
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
  async getEmotionalState(session_id: number, db?: DB): Promise<EmotionalState> {
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
    const state = await this.getEmotionalState(session_id, db);
    const pressure = Math.round(state.context.pressure * 100);
    if (state.context.pressure >= 85) {
      return `Context pressure is very high (${pressure}%). Compact this session as soon as possible.`;
    } else if (state.context.pressure >= 70) {
      return `Context pressure is moderately high (${pressure}%). Consider orienting toward clean pause points to give you a chance to compact this session.`;
    }
    return null;
  }

  async #getTimeGapMessage(session: SelectableSession): Promise<string | null> {
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
