import { AbstractTranscriptionModel, type TranscriptionResult } from "../abstract.js";
import { type ConfigTranscriptionModelOpenAI } from "../../../config/config.js";

/**
 * Adapter for OpenAI-compatible transcription endpoints
 * (POST /audio/transcriptions, multipart form-data). Works with any
 * service implementing the standard: OpenAI, whisper.cpp's
 * whisper-server, faster-whisper-server, etc.
 *
 * OGG/Opus note: the OpenAI API standard only guarantees WAV/MP3;
 * whisper-server handles arbitrary formats when built with --convert
 * (delegates to ffmpeg). Other endpoints may require pre-conversion —
 * that is a service capability, not an adapter concern.
 */
export class OpenAITranscriptionModel extends AbstractTranscriptionModel {

  #endpoint: string;

  constructor(opts: ConfigTranscriptionModelOpenAI) {
    super(opts);
    const base = (opts.options.base_url ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.#endpoint = `${base}/audio/transcriptions`;
  }

  async transcribe(filePath: string): Promise<TranscriptionResult> {
    const started = Date.now();
    const form = new FormData();
    const bytes = await (await import('node:fs/promises')).readFile(filePath);
    form.append('file', new Blob([new Uint8Array(bytes)]), filePath.split('/').pop() ?? 'audio');
    form.append('model', this.opts.options.model);
    if (this.opts.options.language) {
      form.append('language', this.opts.options.language);
    }
    if (this.opts.options.prompt) {
      form.append('prompt', this.opts.options.prompt);
    }
    form.append('response_format', 'json');

    const headers: Record<string, string> = {};
    if (this.opts.options.api_key) {
      headers['Authorization'] = `Bearer ${this.opts.options.api_key}`;
    }

    const res = await fetch(this.#endpoint, { method: 'POST', body: form, headers });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Transcription request failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
    }
    const json = await res.json() as { text?: string, language?: string };
    if (typeof json.text !== 'string') {
      throw new Error('Transcription response missing text field');
    }
    return {
      text: json.text,
      language: json.language,
      duration_ms: Date.now() - started,
    };
  }
}
