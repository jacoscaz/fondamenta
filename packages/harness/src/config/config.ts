
import { cast, ValidationError} from '@runtyped/type';
import { validationErrsToString, fillEnvVarsPlaceholders } from "@fondamenta/utils";
import { resolve } from "node:path";
import JSON5 from 'json5';
import { readFile } from "node:fs/promises";
import assert from "node:assert";

export interface ConfigPostgres {
  username?: string;
  password?: string;
  hostname?: string;
  port?: number;
  database: string;
}

/**
 * Content modalities a model can consume/produce. Defaults to text-only when
 * absent. The session runner filters content blocks unsupported by the active
 * model before sending (e.g., images to a text-only model are replaced with
 * placeholder notices rather than sent).
 */
export interface ConfigModalities {
  images?: boolean;
}

export interface ConfigModelBase {
  /** Unique model identifier internal to the harness (e.g. 'z-ai/glm-5.3-flash'). */
  id: string;
  adapter: string;
  options?: Record<string, any>;
  max_output_size: number;
  max_context_size: number;
  modalities?: ConfigModalities;
}

export interface ConfigEmbeddingsModelBase {
  adapter: string;
  options: Record<string, any>;
}

export interface ConfigModelOpenAI extends ConfigModelBase {
  adapter: 'openai';
  options: {
    model: string;
    api_key: string;
    base_url?: string;
    reasoning?: { effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'; };
    extras?: Record<string, any>;
  };
};

export type ConfigSessionModel = ConfigModelOpenAI;

/**
 * Reasoning-effort vocabulary: the harness's common language for how hard
 * a session model should think. Adapters translate these to their native
 * equivalents (the OpenAI adapter passes them through unchanged); adapters
 * with no notion of reasoning effort no-op the request (log + false).
 */


export interface ConfigEmbeddingsModelOpenAI extends ConfigEmbeddingsModelBase {
  adapter: 'openai';
  options: {
    model: string;
    api_key: string;
    base_url?: string;
    extras?: Record<string, any>;
  };
}

export type ConfigEmbeddingModel = ConfigEmbeddingsModelOpenAI;

/**
 * Transcription (speech-to-text) model configuration. Optional in the
 * Config root: when absent, the harness performs no automatic
 * transcription and audio-artifact notifications pass through
 * untouched.
 */
export interface ConfigTranscriptionModelOpenAI {
  adapter: 'openai';
  options: {
    model: string;
    /** Optional; some local endpoints (whisper-server) need no key. */
    api_key?: string;
    base_url?: string;
    /** ISO-639-1 hint; omit to let the model auto-detect. */
    language?: string;
    /** Initial prompt biasing transcription (names, vocabulary). */
    prompt?: string;
  };
}

export type ConfigTranscriptionModel = ConfigTranscriptionModelOpenAI;

export interface ConfigLogging {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  /**
   * Directory for the monologue log (the human-facing mirror of the
   * session stream) and its rotated files. Defaults to
   * /var/log/fondamenta.
   */
  monologue_dir?: string;
}

/**
 * JMAP mail server configuration. Structurally identical to JmapConfig
 * in @fondamenta/mcp-jmap (which owns the semantic definition).
 *
 * NOTE: declared structurally, NOT as `interface ConfigMail extends
 * JmapConfig`. runtyped's runtime cast encodes cross-package type
 * references by name only; the harness's compiled config.js cannot
 * resolve a name it doesn't import as a value, and cast() then
 * silently strips every key (config.mail becomes an empty object at
 * runtime while type-checking happily passes). Keep in sync with
 * JmapConfig.
 */
export interface ConfigMail {
  api_url: string;
  session_url: string;
  api_token: string;
  email_address: string;
  /** Senders that trigger a mail/arrived notification. */
  allowlist: string[];
  /** Inbox polling interval in milliseconds. */
  poll_interval_ms?: number;
}

/**
 * Telegram server configuration. Structurally identical to
 * TelegramConfig in @fondamenta/mcp-telegram (which owns the semantic
 * definition). Declared structurally — cross-package type references
 * do not survive runtyped's compiled cast() and get silently stripped
 * (see ConfigMail's note; same trap).
 */
export interface ConfigTelegram {
  api_token: string;
  /** Telegram user ids allowed to interact with the bot (fail closed). */
  allowed_user_ids: number[];
  /** Long-poll timeout in seconds. */
  poll_timeout_seconds?: number;
}

export interface ConfigHeartbeat {
  /** Heartbeat (check) interval in milliseconds — how often the runner polls for pending work */
  interval: number;
  /** Minimum time between heartbeat-driven activations, in milliseconds.
   *  This is the agent's presence rhythm: how often the agent activates
   *  when nothing external triggers it. Independent of `interval`, which
   *  is only the cheap internal check cadence.
   *  Note: effectively "X ms of quiet", not "X ms of clock time" —
   *  heartbeat activations are suppressed while the quiet period below
   *  keeps deferring them during ongoing activity. */
  activation_interval_ms: number;
  /** Quiet period after ANY activation, in milliseconds, during which
   *  heartbeat-driven activations are suppressed. Prevents the synthetic
   *  activation prompt from landing in the middle of an ongoing exchange
   *  with a slow-typing human (or a long-working agent). Pending messages
   *  are still drained; only the heartbeat prompt is deferred. 0 disables. */
  quiet_after_ms: number;
}

export interface Config {
  tz: string;
  models: {
    /**
     * Session models, in priority order. The FIRST entry is the default
     * every session starts on; sessions may switch to any other entry at
     * runtime via the session MCP server's switch tool. Restarts reset to
     * the first entry (V1: switch state is not persisted).
     */
    session: ConfigSessionModel[];
    embedding: ConfigEmbeddingModel;
    transcription?: ConfigTranscriptionModel;
    /** Dedicated model for distillation (continuity maintenance). Static — not switchable. */
    distillation: ConfigSessionModel;
    /** Dedicated model for compaction. Static — not switchable. */
    compaction: ConfigSessionModel;
  };
  logging: ConfigLogging;
  /** JMAP mail server configuration (owned by @fondamenta/mcp-jmap). */
  mail: ConfigMail;
  /** Telegram server configuration (owned by @fondamenta/mcp-telegram). */
  telegram: ConfigTelegram;
  heartbeat: ConfigHeartbeat;
  postgres: ConfigPostgres;
}

export const getConfigFromProcessArgv = async (): Promise<Config> => {
  let file_path = process.argv[2];
  assert(file_path, 'Missing config file path');
  file_path = resolve(process.cwd(), file_path);
  try {
    const as_string = await readFile(file_path, 'utf8');
    const as_json = JSON5.parse(as_string);
    fillEnvVarsPlaceholders(as_json, process.env);
    return cast<Config>(as_json);
  } catch (err) {
    if (err instanceof ValidationError) {
      throw new Error(`Failed to parse config file ${file_path}: ${validationErrsToString(err.errors)}`);
    }
    throw err;
  }
};
