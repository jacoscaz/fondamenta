/**
 * Races `fn()` against a STALL timeout: the timer measures silence, not
 * total duration. `fn` receives an `on_activity` callback and must invoke
 * it on every sign of progress (e.g. each received stream chunk); each
 * invocation re-arms the timer. A query that streams steadily for an hour
 * is healthy; one that goes silent for `ms` is dead and rejected.
 *
 * On expiry, the returned promise rejects with a descriptive error and
 * `onTimeout` is invoked (e.g. to abort the underlying request), while the
 * abandoned promise is caught and discarded: whatever it eventually settles
 * with — including an error thrown by the aborted request — must never
 * surface as an unhandled rejection (which, on modern Node, terminates the
 * process by default).
 */
export const withTimeout = <T>(
  fn: (on_activity: () => void) => Promise<T>,
  ms: number,
  /** A human-readable description of the operation being timed out. */
  subject: string,
  /** Invoked once, when the timeout fires (e.g. abort an HTTP request). */
  onTimeout?: () => void,
): Promise<T> => {
  let timer: NodeJS.Timeout;
  let reject_race: (err: Error) => void;

  // Re-arms the stall timer. Passed to `fn` as the activity callback and
  // called once directly, to arm the timer before any activity arrives.
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      onTimeout?.();
      reject_race(new Error(`${subject} timed out after ${ms}ms without activity`));
    }, ms);
  };

  const promise = fn(arm);
  // The abandoned promise must never become an unhandled rejection: after
  // the timeout fires, nobody else is awaiting `promise`, so any eventual
  // error (e.g. the aborted request failing) would crash the process.
  promise.catch(() => { /* abandoned: handled via `race` below, or timed out */ });
  const race = new Promise<T>((resolve, reject) => {
    reject_race = reject;
    arm();
    promise.then(resolve, reject);
  });
  return race.finally(() => clearTimeout(timer));
};
