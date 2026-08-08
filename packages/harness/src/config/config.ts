
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

export interface ConfigModelBase {
  adapter: string;
  options: Record<string, any>;
  max_output_size: number;
  max_context_size: number;
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

export interface ConfigMail {
  api_url: string;
  session_url: string;
  api_token: string;
}

export interface ConfigActivation {
  /** Senders that trigger immediate activation (matched against email address) */
  mail_allowlist?: string[];
  /** Max autonomous activations per hour */
  max_per_hour: number;
  /** Minimum gap between activations in milliseconds */
  min_gap_ms: number;
  /** Batch window for non-allowlist mail in milliseconds */
  batch_window_ms: number;
  /** Poll interval for the activation gate in milliseconds */
  poll_interval_ms: number;
}

export interface Config {
  tz: string;
  io: ConfigIO;
  webui: ConfigWebUI;
  models: {
    session: ConfigSessionModel;
    embedding: ConfigEmbeddingModel;
    distillation?: ConfigSessionModel;
    compaction?: ConfigSessionModel;
  };
  logging: ConfigLogging;
  mail: ConfigMail;
  activation: ConfigActivation;
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
