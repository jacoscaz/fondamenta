// Terminal MCP server: provides persistent terminal sessions via zigpty.
// Tools allow spawning, writing, reading, and managing interactive PTY sessions.

import { McpLocalServer } from "@fondamenta/mcp-local";
import { Config } from "../../config/config.js";
import { type HarnessMcpToolCallContext } from "../../types/tools.js";
import { TerminalSession, type TerminalSessionOptions, type SessionInfo } from "./session.js";
import { CompleteContext } from "../../context.js";
import { errToString } from "@fondamenta/utils";

interface SpawnParams {
  command?: string;
  args?: string[];
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

interface WriteParams {
  id: number;
  data: string;
  waitFor?: {
    match: string;
    timeout?: number; // milliseconds
  };
}

interface ReadParams {
  id: number;
  len?: number;
}

interface ReadScreenParams {
  id: number;
}

interface WaitForParams {
  id: number;
  match: string;
  timeout?: number; // milliseconds
}

interface ResizeParams {
  id: number;
  cols: number;
  rows: number;
}

interface DestroyParams {
  id: number;
}

interface KillParams {
  id: number;
  signal?: string;
}

const READ_SCREEN_DESC = `Reads the latest (cols × rows) characters from the terminal's visible screen.
This shows what is currently displayed on the terminal, with ANSI escape sequences processed.
Use this to see the current state of interactive programs (vim, top, REPLs, etc.).`;

const READ_DESC = `Reads the latest <len> characters from the terminal's raw output buffer.
If <len> is omitted, returns the entire buffer (up to 64KB).
This is raw output including ANSI escape codes — prefer readScreen for the visible screen.`;

const WAIT_FOR_DESC = `DEPRECATED: prefer the waitFor parameter of mcp_terminal_write, which arms
the pattern watcher atomically with the write and eliminates the race where
the command's output is emitted before a separate waitFor call arms the
watcher. This standalone tool remains for cases where you need to watch a
session WITHOUT writing to it (e.g. waiting on a long-running process
started earlier). Registers a non-blocking pattern watcher on the terminal
session: on match or timeout, a harness message is injected notifying you.
The tool returns immediately. Default timeout: 30000ms (30 seconds).`;

const SPAWN_DESC = `Spawns a new terminal session. By default spawns an interactive login shell ($SHELL).
Returns the session ID. Use write() to send input and read()/readScreen() to read output.`;

const WRITE_DESC = `Writes characters to the terminal session's stdin.
Use \\r for Enter, \\x03 for Ctrl-C, \\x1b for Escape, etc.

Use for long-running commands whose execution should not block your
activation loop. You'll capture their output with separate tool calls
(mcp_terminal_read / mcp_terminal_readScreen), optionally armed atomically
via the waitFor parameter — which registers the pattern watcher BEFORE the
written command can produce output, eliminating the race where the pattern
is emitted before a separate waitFor call exists. Prefer mcp_shell_exec for
short-lived commands to be run in a blocking fashion.`;

export const initTerminalMcpServer = (
  config: Config,
  ctx: CompleteContext,
): McpLocalServer<HarnessMcpToolCallContext> => {

  const logger = ctx.logger.child('[mcp][terminal]');
  const mcp_server = new McpLocalServer<HarnessMcpToolCallContext>();

  const sessions = new Map<number, TerminalSession>();

  let nextId = 1;

  const getSession = (id: number): TerminalSession => {
    const session = sessions.get(id);
    if (!session) {
      throw new Error(`Terminal session ${id} not found. Use list() to see active sessions.`);
    }
    return session;
  };

  // list(): SessionInfo[]
  mcp_server.addTool<Record<string, never>>(
    'list',
    'List Terminal Sessions',
    'Lists all active terminal sessions with their metadata (id, pid, command, cols, rows, running).',
    async () => {
      const infos: SessionInfo[] = [];
      for (const session of sessions.values()) {
        infos.push(session.getInfo());
      }
      const text = infos.length === 0
        ? 'No active terminal sessions.'
        : JSON.stringify(infos, null, 2);
      return [{ type: 'text', text }];
    },
  );

  // spawn(opts?): number
  mcp_server.addTool<SpawnParams>(
    'spawn',
    'Spawn Terminal Session',
    SPAWN_DESC,
    async (params, opts) => {
      const id = nextId++;
      const options: TerminalSessionOptions = {
        command: params.command,
        args: params.args,
        cols: params.cols,
        rows: params.rows,
        cwd: params.cwd,
        env: params.env,
      };
      const terminal_session = new TerminalSession(id, options);
      terminal_session.onIdle = (event, delta) => {
        // Signal-only notification: the agent decides whether to read the
        // screen content via readScreen/read. This avoids duplicating output
        // that shell_exec already returns for blocking commands, and keeps
        // the notification cheap (no screen content in the message).
        const text = `Terminal session ${id} is idle.`;
        ctx.managers.sessions.injectEventMessage(opts.target_session_id, "terminal/idle", text, true).catch((err) => {
          logger.error('failed to notify idle: %s', errToString(err));
        });
      };
      sessions.set(id, terminal_session);
      return [{ type: 'text', text: `Spawned terminal session ${id} (pid: ${terminal_session.pid}, command: ${terminal_session.process}).` }];
    },
  );

  // destroy(id): void
  mcp_server.addTool<DestroyParams>(
    'destroy',
    'Destroy Terminal Session',
    `Closes a terminal session, killing all subprocesses with SIGHUP.
The session ID is no longer valid after this.`,
    async (params) => {
      const session = getSession(params.id);
      session.onIdle = null;
      session.destroy();
      sessions.delete(params.id);
      return [{ type: 'text', text: `Destroyed terminal session ${params.id}.` }];
    },
  );

  // write(id, data, waitFor?): void
  mcp_server.addTool<WriteParams>(
    'write',
    'Write to Terminal',
    WRITE_DESC,
    async (params, opts) => {
      const session = getSession(params.id);
      // Interpret common escape sequences that LLMs send as literal strings
      const data = params.data
        .replace(/\\r/g, '\r')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\x03/g, '\x03')   // Ctrl-C
        .replace(/\\x1b/g, '\x1b')   // Escape
        .replace(/\\x04/g, '\x04')   // Ctrl-D (EOF)
        .replace(/\\x1a/g, '\x1a');  // Ctrl-Z
      // Arm the pattern watcher BEFORE writing when waitFor is requested:
      // the watcher must exist before the command can emit its output, or
      // the pattern races past it and the wait times out spuriously.
      if (params.waitFor) {
        const timeout = params.waitFor.timeout ?? 30_000;
        const target_session_id = opts.target_session_id;
        session.watchFor(
          params.waitFor.match,
          timeout,
          () => {
            const text = `Terminal session ${params.id} matched pattern "${params.waitFor!.match}".`;
            ctx.managers.sessions.injectEventMessage(target_session_id, "terminal/waitFor", text, true).catch((err) => {
              logger.error('failed to notify waitFor match: %s', errToString(err));
            });
          },
          () => {
            const text = `Terminal session ${params.id} timed out waiting for pattern "${params.waitFor!.match}" (${timeout}ms).`;
            ctx.managers.sessions.injectEventMessage(target_session_id, "terminal/waitFor", text, true).catch((err) => {
              logger.error('failed to notify waitFor timeout: %s', errToString(err));
            });
          },
        );
      }
      session.write(data);
      const wait_note = params.waitFor
        ? ` Watcher armed for pattern "${params.waitFor.match}" (timeout: ${params.waitFor.timeout ?? 30_000}ms) before the write.`
        : '';
      return [{ type: 'text', text: `Wrote ${data.length} characters to session ${params.id}.${wait_note}` }];
    },
  );

  // read(id, len?): string
  mcp_server.addTool<ReadParams>(
    'read',
    'Read Terminal Output',
    READ_DESC,
    async (params) => {
      const session = getSession(params.id);
      const content = session.read(params.len);
      return [{ type: 'text', text: content || '(no output)' }];
    },
  );

  // readScreen(id): string
  mcp_server.addTool<ReadScreenParams>(
    'readScreen',
    'Read Terminal Screen',
    READ_SCREEN_DESC,
    async (params) => {
      const session = getSession(params.id);
      const content = session.readScreen();
      return [{ type: 'text', text: content || '(empty screen)' }];
    },
  );

  // waitFor(id, match, timeout?): string
  mcp_server.addTool<WaitForParams>(
    'waitFor',
    'Wait for Terminal Output',
    WAIT_FOR_DESC,
    async (params, opts) => {
      const session = getSession(params.id);
      const timeout = params.timeout ?? 30_000;
      const target_session_id = opts.target_session_id;
      session.watchFor(
        params.match,
        timeout,
        () => {
          const text = `Terminal session ${params.id} matched pattern "${params.match}".`;
          ctx.managers.sessions.injectEventMessage(target_session_id, "terminal/waitFor", text, true).catch((err) => {
            logger.error('failed to notify waitFor match: %s', errToString(err));
          });
        },
        () => {
          const text = `Terminal session ${params.id} timed out waiting for pattern "${params.match}" (${timeout}ms).`;
          ctx.managers.sessions.injectEventMessage(target_session_id, "terminal/waitFor", text, true).catch((err) => {
            logger.error('failed to notify waitFor timeout: %s', errToString(err));
          });
        },
      );
      return [{ type: 'text', text: `Watching session ${params.id} for pattern "${params.match}" (timeout: ${timeout}ms). You will be notified on match or timeout.` }];
    },
  );

  // resize(id, cols, rows): void
  mcp_server.addTool<ResizeParams>(
    'resize',
    'Resize Terminal',
    `Resizes the terminal session to the specified columns and rows. Sends SIGWINCH to the child process.`,
    async (params) => {
      const session = getSession(params.id);
      session.resize(params.cols, params.rows);
      return [{ type: 'text', text: `Resized session ${params.id} to ${params.cols}x${params.rows}.` }];
    },
  );

  // kill(id, signal?): void
  mcp_server.addTool<KillParams>(
    'kill',
    'Send Signal to Terminal',
    `Sends a signal to the terminal session's foreground process. Default: SIGINT (Ctrl-C). The session remains active after the signal — use destroy() to close it entirely.`,
    async (params) => {
      const session = getSession(params.id);
      session.kill(params.signal);
      return [{ type: 'text', text: `Sent signal ${params.signal ?? 'SIGINT'} to session ${params.id}.` }];
    },
  );

  return mcp_server;

};
