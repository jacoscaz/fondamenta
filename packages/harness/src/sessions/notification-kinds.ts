/**
 * Notification model — the bus's type system.
 *
 * Modeled as a DISCRIMINATED UNION (Jacopo, 2026-09-02): method and
 * params live in one object, the method is the discriminator, and
 * TypeScript infers the params shape from it. `parseDomainNotification`
 * turns raw JSON-RPC input into a fully validated `DomainNotification`;
 * everything downstream switches on `.method` and never casts.
 *
 * HARD-CODED by design (Jacopo's ruling, 2026-09-02): supported kinds
 * are baked in and strictly validated. Non-conforming notifications
 * are DISCARDED — no quarantine, no pass-through, no config to loosen.
 * Adding a new kind is a code change and therefore a review moment.
 *
 * Kinds follow `<artifact>/<state>` naming. Each kind declares:
 * - `ingestible`: whether the notification may be injected into the
 *   agent's context as-is. Non-ingestible kinds target subsystems
 *   (e.g. the transcription server) and NEVER reach the weave —
 *   the bus routes them to registered subscribers instead.
 *
 * ENUMERATION RULE (incident 2026-09-02, df33d8a regression): the union
 * must list kinds from the EMITTER side — walk every MCP server that
 * calls server.notify() — not from the consumer side. Strict discarding
 * of unknown kinds is safe only when the list is complete: an omitted
 * kind silently kills an entire communication channel (telegram/message
 * and mail/arrived were lost for ~8h this way).
 *
 * Monotonic-information principle: each processing step may only ADD
 * information, never remove it. Later kinds in a pipeline extend
 * earlier payloads (TranscriptReadyPayload extends AudioAvailable-
 * Payload; ProcessingErrorPayload preserves the original).
 */

// ── Payloads ──

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

export interface TelegramMessagePayload {
  /** Human-readable, weave-ready rendering of the message (already prefixed with sender/chat info). */
  text: string;
  /** Telegram chat the message came from. */
  chat_id: number;
  /** Telegram user id of the sender. */
  from_id: number;
}

export interface MailArrivedPayload {
  /** Human-readable, weave-ready rendering of the new mail (already formatted). */
  text: string;
}

export interface ProcessingErrorPayload {
  /** Which pipeline step failed (e.g. 'transcription'). */
  step: string;
  /** Human-readable error summary. */
  error: string;
  /** Everything prior steps knew, preserved monotonically. */
  original: Record<string, unknown>;
}

// ── The discriminated union ──

export type DomainNotification =
  | { method: 'audio/available'; params: AudioAvailablePayload }
  | { method: 'transcript/ready'; params: TranscriptReadyPayload }
  | { method: 'telegram/message'; params: TelegramMessagePayload }
  | { method: 'mail/arrived'; params: MailArrivedPayload }
  | { method: 'processing/error'; params: ProcessingErrorPayload };

export type DomainMethod = DomainNotification['method'];

/** Which kinds may reach the weave as-is; the rest route to subscribers. */
export const INGESTIBLE_METHODS: { [K in DomainMethod]: boolean } = {
  'audio/available': false,
  'transcript/ready': true,
  'telegram/message': true,
  'mail/arrived': true,
  'processing/error': true,
};

// ── Runtime validation ──

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

const parseAudioAvailable = (params: unknown): AudioAvailablePayload => {
  if (!isRecord(params)) throw new Error('audio/available payload must be an object');
  const chat_id = optionalNumber(params, 'chat_id');
  if (chat_id === undefined) throw new Error("audio/available payload missing 'chat_id'");
  const from_id = optionalNumber(params, 'from_id');
  if (from_id === undefined) throw new Error("audio/available payload missing 'from_id'");
  return {
    path: requireString(params, 'path'),
    chat_id,
    from_id,
    sender: requireString(params, 'sender'),
    duration_seconds: optionalNumber(params, 'duration_seconds'),
  };
};

const parseTranscriptReady = (params: unknown): TranscriptReadyPayload => {
  const base = parseAudioAvailable(params);
  if (!isRecord(params)) throw new Error('unreachable');
  return {
    ...base,
    text: requireString(params, 'text'),
    language: typeof params.language === 'string' ? params.language : undefined,
    transcription_ms: optionalNumber(params, 'transcription_ms') ?? 0,
    transcribed_by: requireString(params, 'transcribed_by'),
  };
};

const parseTelegramMessage = (params: unknown): TelegramMessagePayload => {
  if (!isRecord(params)) throw new Error('telegram/message payload must be an object');
  const chat_id = optionalNumber(params, 'chat_id');
  if (chat_id === undefined) throw new Error("telegram/message payload missing 'chat_id'");
  const from_id = optionalNumber(params, 'from_id');
  if (from_id === undefined) throw new Error("telegram/message payload missing 'from_id'");
  return { text: requireString(params, 'text'), chat_id, from_id };
};

const parseMailArrived = (params: unknown): MailArrivedPayload => {
  if (!isRecord(params)) throw new Error('mail/arrived payload must be an object');
  return { text: requireString(params, 'text') };
};

const parseProcessingError = (params: unknown): ProcessingErrorPayload => {
  if (!isRecord(params)) throw new Error('processing/error payload must be an object');
  return {
    step: requireString(params, 'step'),
    error: requireString(params, 'error'),
    original: isRecord(params.original) ? params.original : {},
  };
};

/**
 * Validate raw input ({method, params} — e.g. a JSON-RPC notification)
 * into a fully-typed DomainNotification. Throws on unknown methods and
 * non-conforming payloads; the caller decides whether to discard.
 */
export const parseDomainNotification = (input: { method: string, params?: unknown }): DomainNotification => {
  switch (input.method) {
    case 'audio/available':
      return { method: 'audio/available', params: parseAudioAvailable(input.params) };
    case 'transcript/ready':
      return { method: 'transcript/ready', params: parseTranscriptReady(input.params) };
    case 'telegram/message':
      return { method: 'telegram/message', params: parseTelegramMessage(input.params) };
    case 'mail/arrived':
      return { method: 'mail/arrived', params: parseMailArrived(input.params) };
    case 'processing/error':
      return { method: 'processing/error', params: parseProcessingError(input.params) };
    default:
      throw new Error(`unknown notification method: ${input.method}`);
  }
};

/**
 * Convenience for emitting servers: build a validated notification of
 * a known kind. Type-checks the payload against the union at compile
 * time AND validates at runtime (defense in depth — an emitter bug
 * fails loudly here instead of corrupting the weave).
 */
export const makeDomainNotification = <K extends DomainMethod>(method: K, params: Extract<DomainNotification, { method: K }>['params']): DomainNotification => {
  return parseDomainNotification({ method, params });
};
