
import { cast } from "@runtyped/type";
import { it, describe } from "node:test";
import { deepStrictEqual } from "node:assert/strict";
import { HarnessNotification } from "./types.js";
import { type DueTodoNotification } from "../mcp-servers/continuity/types.js";
import {
  type McpNotification,
  type McpNewMessageNotification,
} from "@fondamenta/mcp-core";

describe('HarnessNotification casting', () => {

  const sources = [
    {
      method: 'todo/due',
      params: {
        text: 'test',
      },
    } satisfies DueTodoNotification,
    {
      method: 'message/new',
      params: {
        content: [{
          type: 'text',
          text: 'test',
        }],
        transport: {
          type: 'email',
          from: { name: 'test', address: 'test' },
        },
      },
    } satisfies McpNewMessageNotification,
  ] satisfies McpNotification[];

  sources.forEach((notification) => {
    it(`casting ${notification.method} to HarnessNotification should work`, () => {
      deepStrictEqual(cast<HarnessNotification>(notification), notification);
    });
  });

});
