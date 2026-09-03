
import { errToString } from "@fondamenta/utils";
import { type InitContext, WithContext } from "../context.js";
import { type HarnessNotification } from "./types.js";
import { type Logger } from "pinetto";

export type NotificationHandler = (notification: HarnessNotification) => Promise<boolean> | boolean;

export class NotificationBus extends WithContext {

  #logger: Logger;
  #subscribers: { name: string; handler: NotificationHandler; }[];

  constructor(ctx: InitContext) {
    super(ctx);
    this.#subscribers = [];
    this.#logger = ctx.logger.child('[notification-bus]');
  }

  /**
   * Register a notification subscriber for a specific kind of notifications.
   * Subscribers receive fully-validated notifications and are allowed to emit
   * additional notifications during processing of one.
   *
   * NOTE: Subscribers are called in the order they are registered.
   *       Subscription order is load-bearing but implicit.
   */
  subscribe(name: string, handler: NotificationHandler): void {
    this.#subscribers.push({ name, handler });
    this.#logger.info('subscriber %s registered', name);
  }

  /**
   * Entry point: called by notification producers to dispatch notifications
   * to subscribers.
   */
  async notify(notification: HarnessNotification): Promise<void> {
    for (const { name, handler } of this.#subscribers) {
      try {
        this.#logger.debug('dispatching notification %s to subscriber %s...', notification.method, name);
        if (await handler(notification)) {
          this.#logger.debug('subscriber %s reported successful handling of notification %s', name, notification.method);
          return;
        }
        this.#logger.debug('subscriber %s reported unable to handle notification %s', name, notification.method);
      } catch (err) {
        this.#logger.error('subscriber %s failed to handle notification %s with error %s', name, notification.method, errToString(err));
      }
    }
    await this.#warnOnUnhandledNotification(notification);
  }

  async #warnOnUnhandledNotification(notification: HarnessNotification): Promise<void> {
    const { sessions: session_manager } = this._ctx.managers;
    const text = `All subscribers to the notification bus failed or reported unable to handle notification ${notification.method}.`;
    const event = 'notification/processing_failure';
    this.#logger.warn(text + ' Notification details: %s', () => JSON.stringify(notification, null, 2));
    await session_manager.injectEventMessage(session_manager.main_session_id, event, text + ' Check the harness logs for details.', true);
  }

}
