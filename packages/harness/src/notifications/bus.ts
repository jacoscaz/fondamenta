
import { type InitContext, WithContext } from "../context.js";
import { type Logger } from "pinetto";
import { UserNotification } from "../types/notifications.js";

export class NotificationBus extends WithContext {

  #logger: Logger;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[notification-bus]');
  }

  /**
   * Entry point for the NEW notification model: structured
   * UserNotifications emitted by tool servers' notifiers. The bus is no
   * longer a cross-tool pipeline — there are no transforms, no
   * priorities, no re-emits. A notification is a complete event; the
   * only consumer is the session manager, which injects it into the
   * weave. Notifiers decorate their own events (standing at emission,
   * transcription at emission) BEFORE this is called.
   *
   * Formatting for the model lives in ONE place: the session adapter's
   * notification formatter, which renders blocks + contact standing.
   */
  async notify(notification: UserNotification): Promise<void> {
    const { sessions: session_manager } = this._ctx.managers;
    await session_manager.injectUserNotification(session_manager.main_session_id, notification);
  }

}
