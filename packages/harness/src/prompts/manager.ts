
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

  

}
