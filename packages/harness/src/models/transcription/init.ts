import { type AbstractTranscriptionModel } from "./abstract.js";
import { type ConfigTranscriptionModel } from "../../config/config.js";
import { OpenAITranscriptionModel } from "./adapters/openai.js";

export const initializeTranscriptionModel = async (config: ConfigTranscriptionModel): Promise<AbstractTranscriptionModel> => {
  switch (config.adapter) {
    case 'openai':
      return new OpenAITranscriptionModel(config);
    default:
      throw new Error(`Unsupported transcription model adapter: ${config.adapter}`);
  }
};
