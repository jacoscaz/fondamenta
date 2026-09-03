
import { cast } from "@runtyped/type";
import { it, describe } from "node:test";
import { deepStrictEqual } from "node:assert/strict";
import { HarnessNotification } from "./types.js";
import { type DueTodoNotification } from "../mcp-servers/continuity/types.js";
import { type TelegramNotification } from "@fondamenta/mcp-telegram";
import { type JMAPNotification } from "@fondamenta/mcp-jmap";
import { type TranscriptionNotification } from "../mcp-servers/transcription/types.js";
import { type McpNotification } from "@fondamenta/mcp-core";

describe('HarnessNotification casting', () => {

  const sources = [
    {
      method: 'todo/due',
      params: {
        text: 'test',
      },
    } satisfies DueTodoNotification,
    {
      method: 'telegram/text_message',
      params: {
        text: 'test',
        sender: 'test',
        chat_id: 0,
        from_id: 0,
      },
    } satisfies TelegramNotification,
    {
      method: 'jmap/new_email',
      params: {
        text: 'test',
      },
    } satisfies JMAPNotification,
    {
      method: 'transcription/ready',
      params: {
        text: 'test',
        language: 'test',
        duration: 0,
        transcriber: 'test',
      },
    } satisfies TranscriptionNotification,
  ] satisfies McpNotification[];

  sources.forEach((notification) => {
    it(`casting ${notification.method} to HarnessNotification should work`, () => {
      deepStrictEqual(cast<HarnessNotification>(notification), notification);
    });
  });

});
