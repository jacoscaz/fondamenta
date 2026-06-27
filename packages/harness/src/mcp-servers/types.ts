
import { type McpToolCallContext } from "@fondamenta/mcp-core";
import { type DB } from "../database/client.js";
import { type Logger } from "pinetto";

export interface HarnessMcpToolCallContext extends McpToolCallContext {
  db: DB;
  origin_session_id: number;
  target_session_id: number;
}
