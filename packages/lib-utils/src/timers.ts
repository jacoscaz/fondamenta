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
  /** A human-readable description of the operation being timed out. */
  subject: string,
  /** Invoked once, when the timeout fires (e.g. abort an HTTP request). */
  onTimeout?: () => void,
): Promise<T> => {
  let timer: NodeJS.Timeout;
  const promise = fn();
  // The abandoned promise must never become an unhandled rejection: after
  // the timeout fires, nobody else is awaiting `promise`, so any eventual
  // error (e.g. the aborted request failing) would crash the process.
  promise.catch(() => { /* abandoned: handled via `race` below, or timed out */ });
  const race = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`${subject} timed out after ${ms}ms`));
    }, ms);
    promise.then(resolve, reject);
  });
  return race.finally(() => clearTimeout(timer));
};
