/**
 * Notification kind registry — the bus's type system.
 *
 * HARD-CODED by design (Jacopo's ruling, 2026-09-02): supported kinds
 * are baked in and strictly validated. Non-conforming notifications
 * are DISCARDED — no quarantine, no pass-through, no config to loosen.
 * Adding a new kind is a code change and therefore a review moment.
 *
 * Kinds follow `<server>/<artifact>` naming. Each kind declares:
 * - `ingestible`: whether the notification may be injected into the
 *   agent's context as-is. Non-ingestible kinds target subsystems
 *   (e.g. the transcription pipeline) and NEVER reach the weave —
 *   the bus routes them to registered handlers instead.
 * - `validate`: strict structural check. Return the validated
 *   payload (possibly enriched) or throw to discard.
 *
 * Monotonic-information principle: each processing step may only ADD
 * information, never remove it. Handlers receiving a payload can rely
 * on every field added by prior steps being present.
 */

export interface AudioAvailablePayload {
  /** Absolute path of the downloaded audio file on disk. */
  path: string;
  /** Telegram chat the message came from. */
  chat_id: number;
  /** Telegram user id of the sender. */
  from_id: number;
  /** Sender display form (e.g. @username), as rendered in events. */
  sender: string;
  /** Voice-note duration in seconds, when known. */
  duration_seconds?: number;
}

export interface TranscriptReadyPayload extends AudioAvailablePayload {
  /** The transcribed text. Non-empty on success. */
  text: string;
  /** Detected or forced language ('en', 'it', ...), when known. */
  language?: string;
  /** Transcription wall-clock time in ms. */
  transcription_ms: number;
  /** Identifier of the transcription model used. */
  transcribed_by: string;
}

export interface ProcessingErrorPayload {
  /** Which pipeline step failed (e.g. 'transcription'). */
  step: string;
  /** Human-readable error summary. */
  error: string;
  /** Everything prior steps knew, preserved monotonically. */
  original: Record<string, unknown>;
}

export type NotificationKind =
  | 'audio/available'          // non-ingestible → transcription pipeline
  | 'transcript/ready'         // ingestible → the weave
  | 'processing/error';        // ingestible → the weave

interface KindSpec {
  ingestible: boolean;
  validate: (params: unknown) => unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const requireString = (o: Record<string, unknown>, key: string): string => {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`notification payload missing required string field '${key}'`);
  }
  return v;
};

const optionalNumber = (o: Record<string, unknown>, key: string): number | undefined => {
  const v = o[key];
  return typeof v === 'number' ? v : undefined;
};

const asAudioAvailable = (params: unknown): AudioAvailablePayload => {
  if (!isRecord(params)) throw new Error('audio/available payload must be an object');
  return {
    path: requireString(params, 'path'),
    chat_id: optionalNumber(params, 'chat_id') ?? (() => { throw new Error("audio/available payload missing 'chat_id'"); })(),
    from_id: optionalNumber(params, 'from_id') ?? (() => { throw new Error("audio/available payload missing 'from_id'"); })(),
    sender: requireString(params, 'sender'),
    duration_seconds: optionalNumber(params, 'duration_seconds'),
  };
};

const asTranscriptReady = (params: unknown): TranscriptReadyPayload => {
  const base = asAudioAvailable(params);
  if (!isRecord(params)) throw new Error('unreachable');
  const text = requireString(params, 'text');
  return {
    ...base,
    text,
    language: typeof params.language === 'string' ? params.language : undefined,
    transcription_ms: optionalNumber(params, 'transcription_ms') ?? 0,
    transcribed_by: requireString(params, 'transcribed_by'),
  };
};

const asProcessingError = (params: unknown): ProcessingErrorPayload => {
  if (!isRecord(params)) throw new Error('processing/error payload must be an object');
  return {
    step: requireString(params, 'step'),
    error: requireString(params, 'error'),
    original: isRecord(params.original) ? params.original : {},
  };
};

export const NOTIFICATION_KINDS: Record<NotificationKind, KindSpec> = {
  'audio/available': {
    ingestible: false,
    validate: asAudioAvailable,
  },
  'transcript/ready': {
    ingestible: true,
    validate: asTranscriptReady,
  },
  'processing/error': {
    ingestible: true,
    validate: asProcessingError,
  },
};
