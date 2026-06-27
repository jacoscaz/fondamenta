import { Config } from "../config/config.js";
import pinetto from 'pinetto';
import { McpLocalServer } from "@fondamenta/mcp-local";
import { exec } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from 'node:path';
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { HarnessMcpToolCallContext } from "./types.js";

interface ExecParams {
  command: string;
  timeout?: number;
}

const MAX_OUTPUT_LEN = 10_000; // Characters before writing to temp file

const maybeWriteTemp = async (content: string, label: string): Promise<string> => {
  if (content.length <= MAX_OUTPUT_LEN) {
    return content || '--- no output ---';
  }
  const filename = `bash-${label}-${randomUUID()}.txt`;
  const filepath = resolve(tmpdir(), filename);
  await writeFile(filepath, content, 'utf-8');
  return content.slice(0, MAX_OUTPUT_LEN)
    + `\n\n --- Truncated to ${MAX_OUTPUT_LEN} out of ${content.length} chars, full output saved to: ${filepath} . Use the mcp_file_read tool to read the full output if necessary. ALWAYS apply token economy principles. ---`;
};

const registerTools = (mcpLocalServer: McpLocalServer<HarnessMcpToolCallContext>) => {

  mcpLocalServer.addTool<ExecParams>(
    'exec',
    'Execute',
    `Executes a command in a shell. On failure, includes both stdout and stderr in the output.
Exceedingly long outputs will be truncated and written to temp files. Timeout MUST be specified in SECONDS.`,
    async (args) => {
      const timeout = args.timeout ?? 10;
      return new Promise((resolve) => {
        exec(args.command, { timeout: timeout * 1000 }, async (err, stdout, stderr) => {
          if (err) {
            // Surface both the error, stdout, and stderr on failure
            // Write long outputs to temp files to avoid context overload
            const stdoutText = stdout ? await maybeWriteTemp(stdout, 'stdout') : '(no stdout)';
            const stderrText = stderr ? await maybeWriteTemp(stderr, 'stderr') : '(no stderr)';
            const output = [
              `Command failed: ${args.command}`,
              `Exit code: ${err.code ?? 'unknown'}`,
              `--- stdout ---\n${stdoutText}`,
              `--- stderr ---\n${stderrText}`,
            ];
            resolve([{ type: 'text', text: output.join('\n') }]);
            return;
          }

          // Also truncate stdout on success if too long
          const stdoutText = stdout ? await maybeWriteTemp(stdout, 'stdout') : '--- no output ---';
          resolve([{ type: 'text', text: stdoutText }]);
        });
      });
    },
  );
};

export const initBashMcpServer = (config: Config): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp_server = new McpLocalServer<HarnessMcpToolCallContext>();

  registerTools(mcp_server);

  return mcp_server;

};
