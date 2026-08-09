// Heartbeat: a generic internal trigger that fires on a configurable interval.
//
// Other components subscribe to the 'heartbeat' event. The main session
// runner subscribes and calls run() on each beat — if already running or
// if there's nothing to process, it's a no-op.
//
// In the future, the interval can be dynamically adjusted by other
// components (e.g. Emygdala) to control activation frequency.

import { type InitContext, WithContext } from "./context.js";
import { type Logger } from "pinetto";

export class Heartbeat extends WithContext<HeartbeatEvents> {
  #logger: Logger;
  #timer: NodeJS.Timeout | null = null;
  #intervalMs: number;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[heartbeat]');
    this.#intervalMs = ctx.config.heartbeat?.interval ?? 30_000;
  }

  initialize(): void {
    this.#timer = setInterval(() => {
      this.emit('beat');
    }, this.#intervalMs);
    this.#logger.info('heartbeat every %dms', this.#intervalMs);
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** Dynamically adjust the heartbeat interval. */
  setInterval(ms: number): void {
    this.#intervalMs = ms;
    if (this.#timer) {
      this.stop();
      this.initialize();
    }
  }
}

export interface HeartbeatEvents extends Record<string, any[]> {
  beat: [];
}
