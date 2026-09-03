/**
 * STDIO transport: spawns the stdio server entrypoint as a child process
 * (exactly how a real external MCP server would run) and connects
 * McpStdioClient to it.
 */

// import { McpStdioClient } from "@fondamenta/mcp-stdio-client";
// import { type TransportFactory } from "./suite.js";

// const node = process.execPath;
// // dist/test-server.js sits next to this module's own dist output
// const entry = new URL('./test-server.js', import.meta.url).pathname;

// export const stdioTransport: TransportFactory = {
//   name: 'stdio',
//   async make() {
//     const client = new McpStdioClient(node, [entry]);
//     return {
//       client,
//       async close() {
//         await client.stop();
//       },
//     };
//   },
// };
