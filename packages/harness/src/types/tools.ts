
import { type DB } from "../database/client.js";
import { type SessionRunner } from "../sessions/runner.js";
import { type CompleteContext } from "../context.js";

export interface ToolCallContext extends CompleteContext {
  db: DB;
  runner: SessionRunner;
  origin_session_id: number;
  target_session_id: number;
}
