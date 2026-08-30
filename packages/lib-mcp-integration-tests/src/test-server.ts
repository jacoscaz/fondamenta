/**
 * STDIO server entrypoint for the integration suite. Run as a child
 * process by transport-stdio; serves the reference test tools over
 * newline-delimited JSON-RPC on stdin/stdout.
 */

import { serveStdio } from "@fondamenta/mcp-http-server";
import { makeTestServer } from "./server.js";

await serveStdio(makeTestServer());
