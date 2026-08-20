
/**
 * Milliepoch timestamp of the last monotonic date returned by
 * `getMonotonicDate()`.
 */
let last_monotonic_millis: number = 0;

/**
 * Equivalent to `new Date()` but with monotonic clock semantics.
 *
 * Returns a Date object representing the current time that is guaranteed to be
 * at least 1ms ahead of the last returned date.
 */
export const getMonotonicDate = (): Date => {
  const now = Date.now();
  const diff = now - last_monotonic_millis;
  if (diff > 0) {
    // If the current time is strictly ahead of the last monotonic date, update
    // the latter to the current time.
    last_monotonic_millis = now;
  } else {
    if (diff < -200) {
      // If the current time is more than 200ms behind the last monotonic date,
      // throw an error to prevent excessive clock skew.
      throw new Error('Monotonic clock has gone ahead by more than 200ms');
    }
    // If the current time is within 200ms behind the last monotonic date,
    // advance the latter by 1ms.
    last_monotonic_millis = last_monotonic_millis + 1;
  }
  return new Date(last_monotonic_millis);
};
