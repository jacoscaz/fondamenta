/**
 * Races `fn()` against a timeout. On expiry, the returned promise rejects
 * with a descriptive error and `onTimeout` is invoked (e.g. to abort the
 * underlying request), while the abandoned promise is caught and discarded:
 * whatever it eventually settles with — including an error thrown by the
 * aborted request — must never surface as an unhandled rejection (which, on
 * modern Node, terminates the process by default).
 */
export const withTimeout = <T>(
  fn: () => Promise<T>,
  ms: number,
  opts: {
    /** Human-readable subject for the timeout error, e.g. a model id. */
    subject?: string,
    /** Invoked once, when the timeout fires (e.g. abort an HTTP request). */
    onTimeout?: () => void,
  } = {},
): Promise<T> => {
  let timer: NodeJS.Timeout;
  const promise = fn();
  // The abandoned promise must never become an unhandled rejection: after
  // the timeout fires, nobody else is awaiting `promise`, so any eventual
  // error (e.g. the aborted request failing) would crash the process.
  promise.catch(() => { /* abandoned: handled via `race` below, or timed out */ });
  const race = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      opts.onTimeout?.();
      reject(new Error(`Timed out after ${ms}ms${opts.subject ? ` (${opts.subject})` : ''}`));
    }, ms);
    promise.then(resolve, reject);
  });
  return race.finally(() => clearTimeout(timer));
};
