// Terminal MCP server: provides persistent terminal sessions via zigpty.
// Tools allow spawning, writing, reading, and managing interactive PTY sessions.

import { McpLocalServer } from "@fondamenta/mcp-local";
import { Config } from "../../config/config.js";
import { type HarnessMcpToolCallContext } from "../types.js";
import { TerminalSession, type TerminalSessionOptions, type SessionInfo } from "./session.js";
import { TerminalNotifier } from "./notifier.js";

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

const WAIT_FOR_DESC = `Waits until the terminal's output matches the provided string pattern, or times out.
Returns the accumulated output so far. Default timeout: 30000ms (30 seconds).`;

const SPAWN_DESC = `Spawns a new terminal session. By default spawns an interactive login shell ($SHELL).
Returns the session ID. Use write() to send input and read()/readScreen() to read output.`;

const WRITE_DESC = `Writes characters to the terminal session's stdin.
Use \\r for Enter, \\x03 for Ctrl-C, \\x1b for Escape, etc.`;

export const initTerminalMcpServer = (
  config: Config,
  notifier?: TerminalNotifier,
): McpLocalServer<HarnessMcpToolCallContext> => {

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
    async (params) => {
      const id = nextId++;
      const options: TerminalSessionOptions = {
        command: params.command,
        args: params.args,
        cols: params.cols,
        rows: params.rows,
        cwd: params.cwd,
        env: params.env,
      };
      const session = new TerminalSession(id, options);

      if (notifier) {
        notifier.attach(session);
      }

      sessions.set(id, session);
      return [{ type: 'text', text: `Spawned terminal session ${id} (pid: ${session.pid}, command: ${session.process}).` }];
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
      session.destroy();
      sessions.delete(params.id);
      return [{ type: 'text', text: `Destroyed terminal session ${params.id}.` }];
    },
  );

  // write(id, data): void
  mcp_server.addTool<WriteParams>(
    'write',
    'Write to Terminal',
    WRITE_DESC,
    async (params) => {
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
      session.write(data);
      return [{ type: 'text', text: `Wrote ${data.length} characters to session ${params.id}.` }];
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
    async (params) => {
      const session = getSession(params.id);
      try {
        const output = await session.waitFor(params.match, params.timeout);
        return [{ type: 'text', text: output }];
      } catch (e: any) {
        return [{ type: 'text', text: `Timeout waiting for pattern "${params.match}" in session ${params.id}. ${e?.message ?? ''}` }];
      }
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
