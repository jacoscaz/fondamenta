
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { McpLocalServer } from "@fondamenta/mcp-local";
import { type TelegramConfig } from "./config.js";
import { TelegramClient } from "./client.js";
import { startTelegramNotifier } from "./notifier.js";


// ── Server ──

/**
 * Media directory for downloaded photos. Set by initTelegramMcpServer;
 * defaults to <cwd>/media/telegram when the tool is called before
 * configuration is known (defensive; init always sets it first).
 */
let mediaDir = join(process.cwd(), 'media', 'telegram');

export const initTelegramMcpServer = (config: TelegramConfig): McpLocalServer<any> => {

  if (config?.media_dir) {
    mediaDir = config.media_dir;
  }

  const mcp = new McpLocalServer<{}>();

  const client = new TelegramClient(config.api_token);
  const notifier = startTelegramNotifier(mcp, client, config, console.log, mediaDir);

  mcp.destroy = () => {
    notifier.stop();
  };

  mcp.addTool<{ text: string, chat_id: number }>(
    'send',
    'Send Telegram Message',
    'Send a plain-text Telegram message to a chat (use the chat_id from an incoming message event).',
    async ({ text, chat_id }) => {
      const message = await client.sendMessage(chat_id, text);
      return `Sent — message_id: ${message.message_id}`;
    },
  );

  mcp.addTool<{}>(
    'me',
    'Bot Identity',
    'Get this bot\'s Telegram identity (id, username) — useful to share with users.',
    async ({}) => {
      const me = await client.getMe();
      return `Bot: @${me.username ?? me.id} (id ${me.id}, "${me.first_name}")`;
    },
  );

  mcp.addTool<{ file_id: string; file_name?: string }>(
    'file',
    'Download Telegram File',
    'Download any incoming Telegram media (photo, voice note, document, video note, audio) by its file_id into the media directory. Returns the saved path — view images with the file-reading tool, process other media with CLI tools.',
    async ({ file_id, file_name }) => {
      const dir = mediaDir;
      await mkdir(dir, { recursive: true });
      const ext = file_name?.includes('.') ? `.${file_name.split('.').pop()}` : '';
      const path = join(dir, `${file_id.slice(-16)}-${Date.now()}${ext}`);
      await client.downloadFile(file_id, path);
      return `File saved to ${path}`;
    },
  );

  return mcp;
};
