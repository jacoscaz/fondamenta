import { type InitContext, WithContext } from "../context.js";
import { type DB } from "../database/client.js";
import { formatDistanceStrict } from "date-fns";
import { type TextBlock } from "../models/session/types/blocks.js";

export interface ContextSize {
  length: number;
  max_length: number;
  pressure: number;
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

export class Emygdala extends WithContext {

  #latest_updated_at: Date;
  #currentPressureLevel: number;

  constructor(init: InitContext) {
    super(init);
    this.#latest_updated_at = new Date(0);
    this.#currentPressureLevel = 0;
  }

  async initialize() {
    const { main_session_id } = this._ctx.managers.sessions;
    const { prompt_size, updated_at } = await this._ctx.db.selectFrom('sessions')
      .where('id', '=', main_session_id)
      .select(['prompt_size', 'updated_at'])
      .executeTakeFirstOrThrow();
    this.#latest_updated_at = new Date(updated_at);
    this.#evaluateContextPressure(prompt_size, []);
    this._ctx.managers.sessions.addPreQueryListener(
      this._ctx.managers.sessions.main_session_id,
      this.#onPreQuery,
    );
  }

  #onPreQuery = async (db: DB) => {
    const { main_session_id } = this._ctx.managers.sessions;
    const { prompt_size, updated_at } = await db.selectFrom('sessions')
      .where('id', '=', main_session_id)
      .select(['prompt_size', 'updated_at'])
      .executeTakeFirstOrThrow();
    const injected_message_blocks: TextBlock[] = [];
    this.#evaluateContextPressure(prompt_size, injected_message_blocks);
    this.#evaluatePassingOfTime(updated_at, injected_message_blocks);
    if (injected_message_blocks.length > 0) {
      await this._ctx.managers.sessions.addHarnessMessage(main_session_id, {
        role: 'user',
        blocks: injected_message_blocks,
      }, db);
    }
  };

  #evaluateContextPressure(prompt_size: number, injected_blocks: TextBlock[]) {
    const max_context_size = this._ctx.managers.models.session.max_context_size;
    const pressure = prompt_size / max_context_size;

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
      if (PRESSURE_LEVELS[newLevel].message) {
        injected_blocks.push({ type: 'text', text: PRESSURE_LEVELS[newLevel].message! });
      }
    } else if (newLevel < this.#currentPressureLevel) {
      // Dropped below current level (e.g. after compaction)
      this.#currentPressureLevel = newLevel;
    }

    return null;
  }

  #evaluatePassingOfTime(updated_at: Date, injected_blocks: TextBlock[]) {
    const THRESHOLD_MS = 1_800_000; // 30 minutes
    const current = new Date(updated_at);
    const global_gap_ms = current.valueOf() - this.#latest_updated_at.valueOf();
    if (global_gap_ms < THRESHOLD_MS) {
      return;
    }
    const gap_str = formatDistanceStrict(current.valueOf(), this.#latest_updated_at.valueOf());
    injected_blocks.push({ type: 'text', text: `It has been ${gap_str} since your last activation.` });
    this.#latest_updated_at = current;
  }

}
