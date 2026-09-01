import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSON5 from "json5";
import { cast } from "@runtyped/type";
import { validationErrsToString, fillEnvVarsPlaceholders } from "@fondamenta/utils";

/**
 * Configuration of the Telegram MCP server. Owned by this package.
 */
export interface TelegramConfig {
  /** Bot API token from @BotFather. */
  api_token: string;
  /**
   * Telegram user ids allowed to interact with the bot. Bots are
   * public by design; without this filter anyone finding the bot can
   * send messages into the agent's context. Empty list = nothing is
   * injected (fail closed).
   */
  allowed_user_ids: number[];
  /** Long-poll interval in seconds for getUpdates (Telegram timeout). */
  poll_timeout_seconds?: number;
  /**
   * Directory where downloaded media (photos) are stored. Created on
   * demand. Defaults to <cwd>/media/telegram.
   */
  media_dir?: string;
  /**
   * Path to the whisper-cli binary (whisper.cpp) used for local voice
   * note transcription. Voice STT runs on the machine — audio never
   * leaves it. Defaults to /root/whisper.cpp/build/bin/whisper-cli.
   */
  whisper_cli?: string;
  /**
   * Path to the whisper ggml model file. Defaults to
   * /root/whisper.cpp/models/ggml-base.bin (multilingual, good
   * speed/accuracy balance on 8 cores).
   */
  whisper_model?: string;
}

export const loadTelegramConfig = async (file_path: string): Promise<TelegramConfig> => {
  file_path = resolve(process.cwd(), file_path);
  const as_string = await readFile(file_path, 'utf8');
  const as_json = JSON5.parse(as_string);
  fillEnvVarsPlaceholders(as_json, process.env);
  return cast<TelegramConfig>(as_json);
};
