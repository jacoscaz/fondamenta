
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

export interface ConfigIO {
  addr: string;
  port: number;
  path: string;
}

export interface ConfigWebUI {
  addr: string;
  port: number;
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

export interface ConfigLogging {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
}

export interface ConfigJMAP {
  api_url: string;
  api_token: string;
  session_url: string;
  email_address: string;
}

export interface ConfigHeartbeat {
  /** Senders that trigger immediate activation (matched against email address) */
  mail_allowlist?: string[];
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
  io: ConfigIO;
  webui: ConfigWebUI;
  models: {
    session: ConfigSessionModel;
    embedding: ConfigEmbeddingModel;
  };
  logging: ConfigLogging;
  jmap: ConfigJMAP;
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
