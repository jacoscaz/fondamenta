
// import { McpLocalServer } from "@fondamenta/mcp-local";
// import { registerMemoryTools } from "./memories.js";
// import { registerIdentityAnchorTools } from "../anchors.js";
// import { registerLogTools } from "../logs.js";
// import { registerNotesTools } from "../notes.js";
// import { type CompleteContext } from "../../context.js";
// import { type HarnessMcpToolCallContext } from "../types.js";

// export const initContinuityMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

//   const logger = ctx.logger.child('[continuity]');

//   const mcp_server_local = new McpLocalServer<HarnessMcpToolCallContext>(logger);

//   registerLogTools(ctx.db, mcp_server_local);
//   registerNotesTools(ctx.db, mcp_server_local);
//   registerMemoryTools(ctx.db, mcp_server_local);
//   registerIdentityAnchorTools(ctx.db, mcp_server_local);

//   return mcp_server_local;

// };
