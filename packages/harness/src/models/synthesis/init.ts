import { type AbstractSynthesisModel } from "./abstract.js";
import { type ConfigSynthesisModel } from "../../config/config.js";
import { OpenAISynthesisModel } from "./adapters/openai.js";
import { KokoroSynthesisModel } from "./adapters/kokoro.js";

export const initializeSynthesisModel = async (config: ConfigSynthesisModel): Promise<AbstractSynthesisModel> => {
  switch (config.adapter) {
    case 'openai':
      return new OpenAISynthesisModel(config);
    case 'kokoro':
      return new KokoroSynthesisModel(config);
    default:
      throw new Error(`Unsupported synthesis model adapter: ${(config as { adapter: string }).adapter}`);
  }
};
