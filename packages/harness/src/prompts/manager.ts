import { makeHeartbeatPrompt } from "./heartbeat.js";
import { makeSystemPrompt } from "./system.js";
import { type InitContext, WithContext } from "../context.js";

export class PromptManager extends WithContext {

  constructor(ctx: InitContext) {
    super(ctx);
  }

  async getSystemPrompt(): Promise<string> {
    return await makeSystemPrompt({
      ctx: this._ctx,
    });
  }

  async getHeartbeatPrompt(): Promise<string> {
    return await makeHeartbeatPrompt();
  }

}
