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

  #ringBuffer: string = '';
  #idleDetector: IdleDetector;
  #onIdle: ((event: IdleEvent) => void) | null = null;

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
      if (this.#ringBuffer.length > RING_BUFFER_MAX) {
        this.#ringBuffer = this.#ringBuffer.slice(-RING_BUFFER_MAX);
      }
      this.emulator.write(str);
    });

    // Set up the idle detector
    this.#idleDetector = new IdleDetector((event) => {
      if (event.type === 'idle' && this.#onIdle) {
        this.#onIdle(event);
      }
    }, {
      graceMs: idle.graceMs,
      activeThreshold: idle.activeThreshold,
      quietMs: idle.quietMs,
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

  set onIdle(handler: ((event: IdleEvent) => void) | null) {
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

  /** Wait for the PTY output to match a pattern, with timeout in ms. */
  async waitFor(pattern: string, timeout?: number): Promise<string> {
    // zigpty's waitFor matches against the raw stream which includes ANSI
    // escape codes. We match against the screen content instead, polling
    // until the visible output contains the pattern or the timeout fires.
    const deadline = Date.now() + (timeout ?? 30_000);
    const pollInterval = 200; // ms
    while (Date.now() < deadline) {
      const screen = this.readScreen();
      if (screen.includes(pattern)) {
        return this.#ringBuffer;
      }
      await new Promise(r => setTimeout(r, pollInterval));
    }
    throw new Error(`Timeout waiting for pattern "${pattern}" in session ${this.id}.`);
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
