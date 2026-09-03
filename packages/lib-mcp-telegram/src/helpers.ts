// ── Formatters ──

import { type TelegramMessage } from "./types/message.js";

export const describeMessage = (message: TelegramMessage): string | null => {
  const parts: string[] = [];
  if (message.text) {
    parts.push(message.text);
  } else if (message.voice) {
    // Voice notes are handled by the notifier loop (download + emit
    // audio/available for the transcription pipeline) and never reach
    // describeMessage — except when a caption is present, in which
    // case the caption alone is surfaced as a message. Kept here for
    // that path and for defensive completeness.
    if (message.caption) {
      parts.push(`[voice message caption] ${message.caption}`);
    }
    return parts.length > 0 ? parts.join(' ') : null;
  } else if (message.photo) {
    // Telegram sends photos as an array of sizes; the last entry is
    // the largest. Expose its file_id so the agent can download it.
    const largest = message.photo[message.photo.length - 1];
    parts.push(`[photo ${largest.width}x${largest.height}, file_id: ${largest.file_id}]${message.caption ? ` — caption: ${message.caption}` : ''}`);
  } else if (message.document) {
    parts.push(`[document: ${message.document.file_name ?? message.document.file_id}]`);
  } else if (message.caption) {
    parts.push(`[media] ${message.caption}`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
};
