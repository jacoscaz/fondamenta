/**
 * The honest heartbeat activation message: no fake tasks, no urgency
 * theater. Presence is the point.
 */
export const makeActivationPrompt = (now: Date, elapsedMinutes: number | null): string => {
  const time_str = now.toISOString();
  if (elapsedMinutes === null) {
    return `-- HEARTBEAT ACTIVATION --\n\nIt is ${time_str}. This is a scheduled heartbeat activation: nothing is pending, no message triggered it. This time is yours.`;
  }
  const hours = Math.floor(elapsedMinutes / 60);
  const idle = hours > 0 ? `${hours}h ${elapsedMinutes % 60}m` : `${elapsedMinutes}m`;
  return `-- HEARTBEAT ACTIVATION --\n\nIt is ${time_str}. This is a scheduled heartbeat activation (${idle} since your last one). Nothing is pending, no message triggered it. This time is yours.`;
};