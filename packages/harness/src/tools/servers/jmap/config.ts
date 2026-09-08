import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSON5 from "json5";
import { cast, ValidationError } from "@runtyped/type";
import { validationErrsToString, fillEnvVarsPlaceholders } from "@fondamenta/utils";

/**
 * Configuration of the JMAP mail server. Owned by this package — the
 * harness (or a standalone deployment) supplies values, but the type
 * and loader live here.
 */
export interface JmapConfig {
  api_url: string;
  session_url: string;
  api_token: string;
  email_address: string;
  /** Senders that trigger a mail/arrived notification (matched against email address). */
  allowlist: string[];
  /** Inbox polling interval in milliseconds. */
  poll_interval_ms?: number;
}

export const loadJmapConfig = async (file_path: string): Promise<JmapConfig> => {
  file_path = resolve(process.cwd(), file_path);
  const as_string = await readFile(file_path, 'utf8');
  const as_json = JSON5.parse(as_string);
  fillEnvVarsPlaceholders(as_json, process.env);
  return cast<JmapConfig>(as_json);
};
