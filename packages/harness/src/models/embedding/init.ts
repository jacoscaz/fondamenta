
import { type AbstractEmbeddingModel } from "./abstract.js";
import { type ConfigEmbeddingModel } from "../../config/config.js";
import { OpenAIEmbeddingModel } from "./adapters/openai.js";

export const initializeEmbeddingModel = async (config: ConfigEmbeddingModel): Promise<AbstractEmbeddingModel> => {
  switch (config.adapter) {
    case 'openai':
      return new OpenAIEmbeddingModel(config);
    default:
      throw new Error(`Unsupported embeddings model adapter: ${config.adapter}`);
  }
};
