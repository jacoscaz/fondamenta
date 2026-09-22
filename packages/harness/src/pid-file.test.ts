import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquirePidFile, releasePidFile, defaultPidFilePath } from './pid-file.js';

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'fondamenta-pid-file-'));

test('acquire writes our pid and a second acquire reports a conflict', () => {
  const dir = tempDir();
  const path = join(dir, 'harness.pid');

  const first = acquirePidFile(path);
  assert.strictEqual(first.acquired, true);
  assert.strictEqual(first.reclaimed, undefined);
  assert.strictEqual(parseInt(readFileSync(path, 'utf8').trim(), 10), process.pid);

  const second = acquirePidFile(path);
  assert.strictEqual(second.acquired, false);
  assert.strictEqual(second.conflict_pid, process.pid);

  releasePidFile(path);
  assert.strictEqual(existsSync(path), false);
});

test('release is a no-op when the file records another pid', async () => {
  const dir = tempDir();
  const path = join(dir, 'harness.pid');

  const child = spawn('true');
  await once(child, 'exit');
  assert.ok(child.pid);
  writeFileSync(path, `${child.pid}\n`);

  // Our release must not delete a file recording someone else's pid.
  releasePidFile(path);
  assert.strictEqual(existsSync(path), true);

  // A dead recorded pid is reclaimed by acquire.
  const acquired = acquirePidFile(path);
  assert.strictEqual(acquired.acquired, true);
  assert.deepStrictEqual(acquired.reclaimed, { pid: child.pid, reason: 'dead-pid' });
  assert.strictEqual(parseInt(readFileSync(path, 'utf8').trim(), 10), process.pid);

  releasePidFile(path);
  assert.strictEqual(existsSync(path), false);
});

test('a corrupt pid file is reclaimed', () => {
  const dir = tempDir();
  const path = join(dir, 'harness.pid');

  writeFileSync(path, 'not-a-pid');
  const acquired = acquirePidFile(path);
  assert.strictEqual(acquired.acquired, true);
  assert.deepStrictEqual(acquired.reclaimed, { reason: 'corrupt' });
  assert.strictEqual(parseInt(readFileSync(path, 'utf8').trim(), 10), process.pid);

  releasePidFile(path);
});

test('release after the file was already removed is a silent no-op', () => {
  const dir = tempDir();
  const path = join(dir, 'harness.pid');
  acquirePidFile(path);
  writeFileSync(path, `${process.pid}\n`);
  releasePidFile(path);
  releasePidFile(path); // must not throw
  assert.strictEqual(existsSync(path), false);
});

test('default path resolves to the harness package.json level', () => {
  const path = defaultPidFilePath();
  assert.ok(path.endsWith('harness.pid'));
  // Walking up from dist/ (or src/ in tests) must land at the directory
  // whose package.json is the harness package.
  const pkg = JSON.parse(readFileSync(join(path, '..', 'package.json'), 'utf8'));
  assert.strictEqual(pkg.name, '@fondamenta/harness');
});
