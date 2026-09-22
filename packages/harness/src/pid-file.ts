import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Single-instance guard (2026-09-22, Jacopo, after the watchdog incident):
 * a pid file written at startup and removed at shutdown. A second harness
 * instance finding a live pid file exits immediately instead of racing the
 * first for the database, the notification bus and the continuity store.
 *
 * Stale-file handling: a hard kill (SIGKILL, power loss) leaves the file
 * behind; a naive "file exists -> exit" would then wedge every subsequent
 * boot (crash-loop with systemd). A pid file whose recorded pid is no
 * longer alive — or that is unreadable/corrupt — is therefore reclaimed
 * with a warning rather than treated as a conflict. Two live instances
 * remain impossible either way.
 */

const DEFAULT_PID_FILE_NAME = 'harness.pid';

/**
 * Default pid-file location: the level of the package.json file of the
 * harness. Found by walking up from this module's directory (dist/ in a
 * production deployment) until the harness package.json is reached.
 */
export const defaultPidFilePath = (): string => {
  let dir = import.meta.dirname;
  for (let i = 0; i < 10; i++) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
      if (pkg.name === '@fondamenta/harness') {
        return resolve(dir, DEFAULT_PID_FILE_NAME);
      }
    } catch {
      // No package.json at this level; keep walking up.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: dist/ sits directly below the harness package directory.
  return resolve(import.meta.dirname, '..', DEFAULT_PID_FILE_NAME);
};

const pidIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM: the process exists but belongs to another user — alive.
    return err?.code === 'EPERM';
  }
};

export interface PidFileAcquisition {
  acquired: boolean;
  /** Path of the pid file. */
  path: string;
  /** Present when not acquired: the live pid holding the file. */
  conflict_pid?: number;
  /** Present when a dead-pid or corrupt file was removed before acquiring. */
  reclaimed?: { pid?: number; reason: 'dead-pid' | 'corrupt' };
}

export const acquirePidFile = (path: string): PidFileAcquisition => {
  if (existsSync(path)) {
    let recorded: number | undefined;
    try {
      recorded = parseInt(readFileSync(path, 'utf8').trim(), 10);
    } catch {
      // Corrupt or unreadable — handled below.
    }
    if (recorded !== undefined && Number.isInteger(recorded) && recorded > 0 && pidIsAlive(recorded)) {
      return { acquired: false, path, conflict_pid: recorded };
    }
    const reclaimed = recorded !== undefined && Number.isInteger(recorded) && recorded > 0
      ? { pid: recorded, reason: 'dead-pid' as const }
      : { reason: 'corrupt' as const };
    unlinkSync(path);
    writeFileSync(path, `${process.pid}\n`);
    return { acquired: true, path, reclaimed };
  }
  writeFileSync(path, `${process.pid}\n`);
  return { acquired: true, path };
};

/**
 * Remove the pid file on shutdown. Only removes it if it still records OUR
 * pid: a crashed instance's delayed shutdown handler must never delete the
 * file of the instance that legitimately reclaimed it.
 */
export const releasePidFile = (path: string): void => {
  try {
    const recorded = parseInt(readFileSync(path, 'utf8').trim(), 10);
    if (recorded === process.pid) {
      unlinkSync(path);
    }
  } catch {
    // Already gone or unreadable — nothing to release.
  }
};
