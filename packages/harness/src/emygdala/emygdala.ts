
import { type InitContext, WithContext } from "../context.js";
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

/**
 * While the session sits at a non-zero pressure level, the level's
 * message is re-injected (as a reminder) at most once per this
 * interval. The re-injection is not a transition event: the agent may
 * have correctly deferred compaction, but experience shows deferred
 * compactions are rarely revisited spontaneously. Periodic reminders
 * surface the strategy again at plausible topic-change boundaries
 * (gaps between activations), without needing a dedicated model call
 * to detect topic changes.
 */
const REMINDER_INTERVAL_MS = 3_600_000; // 1 hour

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

  #last_active_at?: Date;
  #currentPressureLevel: number;
  /** When the current level's message was last injected (transition or reminder). */
  #current_level_message_at?: Date;

  constructor(init: InitContext) {
    super(init);
    this.#currentPressureLevel = 0;
  }

  async initialize() {
    const { main_session_id } = this._ctx.managers.sessions;
    const { prompt_size } = await this._ctx.db.selectFrom('sessions')
      .where('id', '=', main_session_id)
      .select(['prompt_size'])
      .executeTakeFirstOrThrow();
    this.#evaluateContextPressure(prompt_size, []);
    this._ctx.managers.sessions.addPreQueryListener(
      this._ctx.managers.sessions.main_session_id,
      this.#onPreQuery,
    );
  }

  #onPreQuery = async () => {
    const { main_session_id } = this._ctx.managers.sessions;
    const { prompt_size } = await this._ctx.db.selectFrom('sessions')
      .where('id', '=', main_session_id)
      .select(['prompt_size'])
      .executeTakeFirstOrThrow();
    const injected_messages: string[] = [];
    this.#evaluatePassingOfTime(injected_messages);
    this.#evaluateContextPressure(prompt_size, injected_messages);
    for (const text of injected_messages) {
      await this._ctx.managers.sessions.injectEventMessage(main_session_id, 'context', text, false);
    }
  };

  #evaluateContextPressure(prompt_size: number, injected_messages: string[]) {
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
      this.#current_level_message_at = new Date();
      if (PRESSURE_LEVELS[newLevel].message) {
        injected_messages.push(PRESSURE_LEVELS[newLevel].message!);
      }
    } else if (newLevel < this.#currentPressureLevel) {
      // Dropped below current level (e.g. after compaction)
      this.#currentPressureLevel = newLevel;
      this.#current_level_message_at = undefined;
    } else if (newLevel > 0 && PRESSURE_LEVELS[newLevel].message) {
      // Same level as before: re-inject the level's message as a
      // reminder if it has not surfaced recently. Activation gaps
      // suggest potential topic changes — good moments to reconsider
      // deferred compaction decisions.
      const now = new Date();
      const last = this.#current_level_message_at?.valueOf() ?? 0;
      if (now.valueOf() - last > REMINDER_INTERVAL_MS) {
        this.#current_level_message_at = now;
        injected_messages.push(`Reminder — ${PRESSURE_LEVELS[newLevel].message}`);
      }
    }

    return null;
  }

  #evaluatePassingOfTime(injected_messages: string[]) {
    const now = new Date();
    if (this.#last_active_at) {
      const THRESHOLD_MS = 1_800_000; // 30 minutes
      const gap_ms = now.valueOf() - this.#last_active_at.valueOf();
      if (gap_ms > THRESHOLD_MS) {
        const gap_str = formatDistanceStrict(now.valueOf(), this.#last_active_at.valueOf());
        injected_messages.push(`It is ${now.toISOString()}. It has has been ${gap_str} since your last activation.`);
      }
    } else {
      injected_messages.push(`It is ${now.toISOString()}. Your harness has just been started.`);
    }
    this.#last_active_at = now;
  }

}
