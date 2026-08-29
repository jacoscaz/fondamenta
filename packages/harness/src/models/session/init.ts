
import { type AbstractSessionModel } from "./abstract.js";
import { ConfigSessionModel, type Config } from "../../config/config.js";

import { OpenAISessionModel } from "./adapters/openai.js";

export const initializeSessionModel = async (config: ConfigSessionModel): Promise<AbstractSessionModel> => {
  switch (config.adapter) {
    case 'openai':
      return new OpenAISessionModel(config);
    default:
      throw new Error(`Unsupported model adapter: ${config.adapter}`);
  }
};
