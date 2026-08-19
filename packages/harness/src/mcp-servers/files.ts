
import { Config } from "../config/config.js";
import { McpLocalServer } from "@fondamenta/mcp-local";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { HarnessMcpToolCallContext } from "../types.js";

interface ReadFileParams {
  path: string;
  char_limit?: number;
  char_offset?: number;
  line_limit?: number;
  line_offset?: number;
}

interface EditFileParams {
  path: string;
  pattern: string;
  replacement: string;
}

interface WriteFileParams {
  path: string;
  content: string;
}

const registerTools = (mcpLocalServer: McpLocalServer<HarnessMcpToolCallContext>) => {

  mcpLocalServer.addTool<ReadFileParams>(
    'read',
    'Read File',
    `Reads a file, optionally with a character or line offset and limit.

If both are provided, the line-based offset and limit are applied before
their character-based equivalents.

WARNING: this tool does not enforce limits on the number of tokens that may
enter your context. ALWAYS employ token economy principles when using it.

Usage:

  // Read the first 10 lines of a file starting from line 132
  { "path": "file.ts", "line_limit": 10, "line_offset": 132 }

  // Read the entirety of a file
  { "path": "file.ts" }`,
    async (params, ctx) => {
      const { path, char_limit, char_offset, line_limit, line_offset } = params;
      let content: string | string[] = await readFile(path, 'utf-8');
      if (line_offset || line_limit) {
        content = content.split('\n');
        if (line_offset) {
          content = content.slice(line_offset);
        }
        if (line_limit) {
          content = content.slice(0, line_limit);
        }
        content = content.join('\n');
      }
      if (char_offset) {
        content = content.slice(char_offset);
      }
      if (char_limit) {
        content = content.slice(0, char_limit);
      }
      return [{ type: 'text', text: content }];
    },
  );

  mcpLocalServer.addTool<WriteFileParams>(
    'write',
    'Write File',
    `Write the provided content to the specified file. If the file does not exist, it will be created.
Note that this tool will overwrite the file if it already exists.`,
    async (args) => {
      const { path, content } = args;
      await writeFile(path, content, 'utf-8');
      return [{ type: 'text', text: `Wrote ${content.length} characters to ${path}` }];
    }
  );

  mcpLocalServer.addTool<EditFileParams>(
    'edit',
    'Edit File',
    `Applies a targeted edit to a file by finding and replacing text.

Finds the specified pattern in the file and replaces it with the replacement text.
The pattern must match exactly (including whitespace) and must be unique in the file.

Usage:
  { "path": "file.ts", "pattern": "old text", "replacement": "new text" }

The pattern must be unique - if it appears multiple times, the edit will fail
with a count of occurrences, asking you to be more specific.`,
    async (args) => {
      const { path, pattern, replacement } = args;

      // Handle file creation case
      if (!existsSync(path)) {
        throw new Error(`File ${path} does not exist. Use the write tool to create it.`);
      }

      const content = await readFile(path, 'utf-8');

      // Count occurrences
      let count = 0;
      let searchPos = 0;
      while (true) {
        const pos = content.indexOf(pattern, searchPos);
        if (pos === -1) break;
        count++;
        searchPos = pos + 1;
      }

      if (count === 0) {
        throw new Error(`Pattern not found in ${path}. Make sure the pattern matches exactly (including whitespace and newlines).`);
      }

      if (count > 1) {
        throw new Error(`Pattern appears ${count} times in ${path}. Please make the pattern more specific so it matches exactly once.`);
      }

      // Single occurrence - perform replacement
      const newContent = content.replace(pattern, replacement);
      await writeFile(path, newContent, 'utf-8');

      return [{ type: 'text', text: `Replaced pattern in ${path}` }];
    },
  );

};

export const initFilesMcpServer = (config: Config): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp_server = new McpLocalServer<HarnessMcpToolCallContext>();

  registerTools(mcp_server);

  return mcp_server;

};
