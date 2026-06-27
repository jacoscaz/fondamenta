
import { formatRFC7231, format, formatDistanceStrict } from 'date-fns';
import assert from 'node:assert';

export const formatCurrentTime = (time: Date): string => {
  return `${formatRFC7231(time)} (local time: ${format(time, 'HH:mm X')})`;
};

export const formatPastTime = (then_time: Date, now_time: Date) => {
  assert(now_time >= then_time, 'Must be before or equal to current time');
  return `${formatRFC7231(then_time)}, ${formatDistanceStrict(now_time, then_time)} ago`;
};
