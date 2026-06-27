
import { type AbstractModel } from "./abstract.js";
import { type Config } from "../config/config.js";

import { OpenAIModel } from "./adapters/openai.js";

export const initializeModel = async (config: Config): Promise<AbstractModel<any>> => {
  switch (config.model.adapter) {
    case 'openai':
      return new OpenAIModel(config.model);
    default:
      throw new Error(`Unsupported model adapter: ${config.model.adapter}`);
  }
};
