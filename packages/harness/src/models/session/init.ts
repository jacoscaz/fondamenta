import { type AbstractSessionModel } from "./abstract.js";
import { ConfigSessionModel, type ConfigModelBase, type Config } from "../../config/config.js";

import { OpenAISessionModel } from "./adapters/openai/openai.js";
import { AnthropicSessionModel } from "./adapters/anthropic/anthropic.js";

export const initializeSessionModel = async (config: ConfigSessionModel): Promise<AbstractSessionModel> => {
  switch (config.adapter) {
    case 'openai':
      return new OpenAISessionModel(config);
    case 'anthropic':
      return new AnthropicSessionModel(config);
    default: {
      // With every adapter case covered, config narrows to never here;
      // cast back to the base shape for the error message.
      const unknown = config as ConfigModelBase;
      throw new Error(`Unsupported model adapter: ${unknown.adapter}`);
    }
  }
};
