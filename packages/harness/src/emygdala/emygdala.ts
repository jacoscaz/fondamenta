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

/**
 * Pressure levels for the Emygdala state machine.
 * Each level has a threshold (absolute token count or relative to
 * context window) and a message. The message is injected only when
 * transitioning *up* into a new level — not on every activation while
 * remaining at the same level.
 *
 * Level 0 is implicit (below the first threshold): no message.
 */
interface PressureLevel {
  /** Minimum prompt_size (in tokens) to enter this level */
  absoluteThreshold: number;
  /** Minimum pressure ratio (prompt_size / max_context_size) to enter this level. 
   *  Both absoluteThreshold AND relativeThreshold must be exceeded to enter. */
  relativeThreshold: number;
  /** Message to inject on level transition. Null for level 0 (no message). */
  message: string | null;
}

const PRESSURE_LEVELS: PressureLevel[] = [
  // Level 0: no message
  { absoluteThreshold: 0, relativeThreshold: 0, message: null },
  // Level 1: advisory nudge at ~100k tokens
  {
    absoluteThreshold: 100_000,
    relativeThreshold: 0.08, // 8% — low enough to fire on large context windows
    message: `Token pressure has grown above 100k tokens. If you are going through simple tasks that do not require much context, consider compacting the session for token economy. Ignore this message if you are in the midst of deep work that requires a lot of context.`,
  },
  // Level 2: moderate pressure at 70% of context window
  {
    absoluteThreshold: 0, // purely relative
    relativeThreshold: 0.70,
    message: `Context pressure is moderately high. Consider orienting toward clean pause points to give you a chance to compact this session.`,
  },
  // Level 3: high pressure at 85% of context window
  {
    absoluteThreshold: 0, // purely relative
    relativeThreshold: 0.85,
    message: `Context pressure is very high. Compact this session as soon as possible.`,
  },
];

export class Emygdala extends WithContext implements InjectionProvider {

  #currentPressureLevel: number = 0;

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
    const prompt_size = state.context.length;
    const pressure = state.context.pressure;

    // Determine which level we're at
    let newLevel = 0;
    for (let i = PRESSURE_LEVELS.length - 1; i > 0; i--) {
      const level = PRESSURE_LEVELS[i];
      const meetsAbsolute = prompt_size >= level.absoluteThreshold;
      const meetsRelative = pressure >= level.relativeThreshold;
      if (meetsAbsolute && meetsRelative) {
        newLevel = i;
        break;
      }
    }

    // Only inject on level transition UP
    if (newLevel > this.#currentPressureLevel) {
      this.#currentPressureLevel = newLevel;
      return PRESSURE_LEVELS[newLevel].message;
    }

    // If we dropped below the current level (e.g. after compaction),
    // reset the state so future increases will re-trigger
    if (newLevel < this.#currentPressureLevel) {
      this.#currentPressureLevel = newLevel;
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
