import { AbstractSynthesisModel, type SynthesisResult } from "../abstract.js";
import { type ConfigSynthesisModel, type ConfigSynthesisModelOpenAI } from "../../../config/config.js";

/**
 * Adapter for OpenAI-compatible speech-synthesis endpoints
 * (POST /audio/speech, JSON body, audio bytes response). Works with
 * any service implementing the standard: OpenAI, kokoro-fastapi-style
 * wrappers, etc.
 *
 * The caller (speech server) allocates the destination path via the
 * FileManager and passes it in; the adapter writes raw response bytes
 * there and derives duration from WAV headers when available. For
 * non-WAV formats without a duration header (mp3), duration is
 * estimated from bitrate-independent heuristics — endpoints that
 * report duration in response headers are preferred when present
 * (X-Duration-Seconds).
 */
export class OpenAISynthesisModel extends AbstractSynthesisModel {

  #endpoint: string;

  constructor(opts: ConfigSynthesisModel & { adapter: 'openai' }) {
    super(opts);
    if (opts.adapter !== 'openai') {
      throw new Error('OpenAISynthesisModel requires adapter "openai"');
    }
    const base = (opts.options.base_url ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.#endpoint = `${base}/audio/speech`;
  }

  async synthesize(text: string, out_path?: string): Promise<SynthesisResult> {
    const opts = this.opts as ConfigSynthesisModelOpenAI;
    const format = opts.options.response_format ?? 'mp3';
    const body: Record<string, unknown> = {
      model: opts.options.model,
      input: text,
      voice: opts.options.voice,
      response_format: format,
    };
    if (opts.options.speed !== undefined) {
      body.speed = opts.options.speed;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.options.api_key) {
      headers['Authorization'] = `Bearer ${opts.options.api_key}`;
    }

    const res = await fetch(this.#endpoint, { method: 'POST', body: JSON.stringify(body), headers });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Synthesis request failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) {
      throw new Error('Synthesis response body is empty');
    }

    const target = out_path ?? this.#defaultPath(format);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(target, bytes);

    return {
      path: target,
      duration: this.#deriveDuration(bytes, format, res.headers),
      format,
    };
  }

  #defaultPath(format: string): string {
    return `/tmp/fondamenta-synthesis-${Date.now()}.${format}`;
  }

  /**
   * Duration in seconds. WAV: parsed from the header (exact).
   * Otherwise: X-Duration-Seconds response header when the endpoint
   * provides it. Otherwise: mp3/opus estimate at 24kbps mono is too
   * unreliable — throw rather than return a wrong duration, since
   * duration is mandatory and a wrong duration is worse than a failed
   * synthesis (the caller can retry with a WAV-requesting format).
   */
  #deriveDuration(bytes: Uint8Array, format: string, headers: Headers): number {
    if (format === 'wav') {
      return wavDurationSeconds(bytes);
    }
    const header_value = headers.get('x-duration-seconds');
    if (header_value) {
      const parsed = Number(header_value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    throw new Error(`Cannot derive audio duration for format '${format}'. Request response_format 'wav' or use an endpoint that reports X-Duration-Seconds.`);
  }
}

/**
 * Exact duration from a canonical 44-byte-header WAV file:
 * data_size / byte_rate. Falls back to size-based approximation for
 * non-standard headers; WAV from TTS endpoints is reliably canonical.
 */
function wavDurationSeconds(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, len: number) => String.fromCharCode(...bytes.slice(offset, offset + len));
  if (bytes.length < 44 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') {
    throw new Error('Synthesis produced a non-WAV payload despite requesting wav format');
  }
  // Walk chunks to find 'data' (header layout can vary).
  let offset = 12;
  let data_size = 0;
  let byte_rate = 0;
  while (offset + 8 <= bytes.length) {
    const chunk_id = ascii(offset, 4);
    const chunk_size = view.getUint32(offset + 4, true);
    if (chunk_id === 'fmt ') {
      byte_rate = view.getUint32(offset + 16, true);
    } else if (chunk_id === 'data') {
      data_size = Math.min(chunk_size === 0xFFFFFFFF ? 0 : chunk_size, bytes.length - offset - 8);
      if (data_size === 0) data_size = bytes.length - offset - 8;
      break;
    }
    offset += 8 + chunk_size + (chunk_size % 2);
  }
  if (data_size <= 0 || byte_rate <= 0) {
    throw new Error('WAV header missing fmt/data chunk information needed for duration');
  }
  return data_size / byte_rate;
}
