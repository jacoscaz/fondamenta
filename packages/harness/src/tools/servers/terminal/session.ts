// Terminal session: wraps a zigpty PTY with a ring buffer and xterm-headless
// emulator for screen reading, plus an IdleDetector for awareness signaling.

import { spawn as spawnPty, type IPty, type IPtyOptions } from 'zigpty';
import { IdleDetector, type IdleEvent } from 'zigpty/idle';
// xterm-headless is CommonJS; use createRequire to load it in ESM context.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const xtermHeadless = require('@xterm/headless');
const XtermTerminal: typeof import('@xterm/headless').Terminal = xtermHeadless.Terminal;

const RING_BUFFER_MAX = 65_536; // 64 KB raw output ring buffer

export interface TerminalSessionOptions {
  command?: string;
  args?: string[];
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
  idle?: {
    graceMs?: number;
    activeThreshold?: number;
    quietMs?: number;
  };
}

export interface SessionInfo {
  id: number;
  pid: number;
  command: string;
  cols: number;
  rows: number;
  running: boolean;
}

export class TerminalSession {

  readonly id: number;
  readonly pty: IPty;
  readonly emulator: InstanceType<typeof XtermTerminal>;

  #idleBuffer: string = '';
  #ringBuffer: string = '';
  #idleDetector: IdleDetector;
  #onIdle: ((event: IdleEvent, delta: string) => void) | null = null;

  constructor(id: number, options: TerminalSessionOptions = {}) {
    const {
      command,
      args = [],
      cols = 80,
      rows = 24,
      cwd,
      env,
      idle = {},
    } = options;

    // Determine the shell if no command is specified
    const file = command ?? process.env.SHELL ?? '/bin/bash';
    const finalArgs = command ? args : ['-l']; // login shell for interactive use

    // Create the xterm-headless emulator
    this.emulator = new XtermTerminal({
      cols,
      rows,
      allowProposedApi: true,
    });

    // Create the PTY
    const ptyOptions: IPtyOptions = {
      cols,
      rows,
      cwd: cwd ?? process.cwd(),
      env: env ?? { ...process.env, TERM: 'xterm-256color' },
      name: 'xterm-256color',
    };

    this.pty = spawnPty(file, finalArgs, ptyOptions);
    this.id = id;

    // Set up the data handler: feed both the ring buffer and the emulator
    this.pty.onData((data: string | Buffer) => {
      const str = typeof data === 'string' ? data : data.toString('utf-8');
      this.#ringBuffer += str;
      this.#idleBuffer += str;
      if (this.#ringBuffer.length > RING_BUFFER_MAX) {
        this.#ringBuffer = this.#ringBuffer.slice(-RING_BUFFER_MAX);
      }
      this.emulator.write(str);
    });

    // Set up the idle detector. Defaults are tuned for agent use — lower
    // activeThreshold than zigpty's 512 default, since typical command
    // output in an interactive session rarely exceeds 100-200 bytes.
    this.#idleDetector = new IdleDetector((event) => {
      if (event.type === 'idle' && this.#onIdle) {
        this.#onIdle(event, this.#idleBuffer);
        this.#idleBuffer = '';
      }
    }, {
      graceMs: idle.graceMs ?? 1500,
      activeThreshold: idle.activeThreshold ?? 32,
      quietMs: idle.quietMs ?? 2000,
    });
    this.pty.attach(this.#idleDetector);
  }

  get pid(): number {
    return this.pty.pid;
  }

  get cols(): number {
    return this.pty.cols;
  }

  get rows(): number {
    return this.pty.rows;
  }

  get running(): boolean {
    return this.pty.exitCode === null;
  }

  get process(): string {
    return this.pty.process;
  }

  set onIdle(handler: ((event: IdleEvent, delta: string) => void) | null) {
    this.#onIdle = handler;
  }

  /** Write data to the PTY's stdin. */
  write(data: string): void {
    this.pty.write(data);
  }

  /** Read the latest `len` characters from the ring buffer, or all of it. */
  read(len?: number): string {
    if (len === undefined) {
      return this.#ringBuffer;
    }
    return this.#ringBuffer.slice(-len);
  }

  /** Read the visible screen content (cols × rows) from the emulator. */
  readScreen(): string {
    const buf = this.emulator.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < this.rows; i++) {
      const line = buf.getLine(i);
      lines.push(line ? line.translateToString(true) : '');
    }
    // Trim trailing empty lines but keep at least one
    while (lines.length > 1 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    return lines.join('\n');
  }

  /**
   * Register a non-blocking pattern watcher. The callback is invoked when
   * the screen content contains the pattern, or when the timeout expires
   * without a match. Returns a disposer to cancel the watcher early.
   */
  watchFor(pattern: string, timeout: number, onMatch: () => void, onTimeout: () => void): () => void {
    const deadline = Date.now() + timeout;
    const pollInterval = 200; // ms
    let cancelled = false;

    const poll = () => {
      if (cancelled) return;
      if (this.pty.exitCode !== null) return; // session ended
      const screen = this.readScreen();
      if (screen.includes(pattern)) {
        onMatch();
        return;
      }
      if (Date.now() >= deadline) {
        onTimeout();
        return;
      }
      setTimeout(poll, pollInterval);
    };

    setTimeout(poll, pollInterval);

    return () => { cancelled = true; };
  }

  /** Resize the terminal. */
  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
    this.emulator.resize(cols, rows);
  }

  /** Send a signal to the foreground process. Default: SIGINT (Ctrl-C). */
  kill(signal?: string): void {
    this.pty.kill(signal);
  }

  /** Destroy the session: kill the PTY and clean up. */
  destroy(): void {
    this.pty.kill('SIGHUP');
    this.pty.close();
    this.emulator.dispose();
  }

  getInfo(): SessionInfo {
    return {
      id: this.id,
      pid: this.pid,
      command: this.process,
      cols: this.cols,
      rows: this.rows,
      running: this.running,
    };
  }

}
