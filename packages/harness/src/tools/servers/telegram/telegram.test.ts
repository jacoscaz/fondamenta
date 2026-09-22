import { test } from 'node:test';
import assert from 'node:assert';
import { TelegramClient } from './client.js';
import { processUpdateWithRetry } from './notifier.js';
import { type TelegramUpdate } from './types/message.js';

// ── client: at-least-once offset semantics ──────────────────────────────────

const apiJson = (result: unknown) =>
  new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });

test('fetchUpdates does not advance the offset; confirmUpdates does', async () => {
  const calls: Array<{ url: string; body: any }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return apiJson([{ update_id: 100 }, { update_id: 101 }]);
  }) as any;
  try {
    const client = new TelegramClient('TESTTOKEN');
    const updates = await client.fetchUpdates(1);
    assert.strictEqual(updates.length, 2);
    // First call carries no offset — nothing confirmed yet.
    assert.strictEqual(calls[0].body.offset, undefined);

    // Calling again without confirming MUST redeliver the same updates.
    await client.fetchUpdates(1);
    assert.strictEqual(calls[1].body.offset, undefined);

    // Confirming up to 101 advances the offset to 102.
    client.confirmUpdates(101);
    await client.fetchUpdates(1);
    assert.strictEqual(calls[2].body.offset, 102);
    assert.ok(calls[2].url.includes('/getUpdates'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── processUpdateWithRetry: bounded retries, loud dead-letter ───────────────

const fakeUpdate = { update_id: 7 } as TelegramUpdate;
const silentSleep = async () => {};

test('processUpdateWithRetry: success on first attempt', async () => {
  let calls = 0;
  const outcome = await processUpdateWithRetry(
    { handleUpdate: async () => { calls++; }, log: fakeLogger(), sleep: silentSleep },
    fakeUpdate,
  );
  assert.strictEqual(outcome, 'processed');
  assert.strictEqual(calls, 1);
});

test('processUpdateWithRetry: transient failure then success', async () => {
  let calls = 0;
  const outcome = await processUpdateWithRetry(
    {
      handleUpdate: async () => { calls++; if (calls < 3) throw new Error('db hiccup'); },
      log: fakeLogger(),
      sleep: silentSleep,
    },
    fakeUpdate,
  );
  assert.strictEqual(outcome, 'processed');
  assert.strictEqual(calls, 3);
});

test('processUpdateWithRetry: permanently poisoned update dead-letters after max attempts', async () => {
  let calls = 0;
  const outcome = await processUpdateWithRetry(
    {
      handleUpdate: async () => { calls++; throw new Error('poison'); },
      log: fakeLogger(),
      max_attempts: 3,
      sleep: silentSleep,
    },
    fakeUpdate,
  );
  assert.strictEqual(outcome, 'dead-lettered');
  assert.strictEqual(calls, 3); // bounded, no infinite loop
});

const fakeLogger = () => ({
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  child: () => fakeLogger(),
} as any);
