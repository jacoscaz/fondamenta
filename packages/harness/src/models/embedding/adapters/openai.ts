import { AbstractEmbeddingModel, type EmbeddingResult } from "../abstract.js";
import { type ConfigEmbeddingsModelOpenAI } from "../../../config/config.js";
import OpenAI from 'openai';
import { EMBEDDING_DIMENSIONS } from "../../../constants.js";

export class OpenAIEmbeddingModel extends AbstractEmbeddingModel {

  #model: string;
  #client: OpenAI;
  #extras: Record<string, any>;

  constructor(opts: ConfigEmbeddingsModelOpenAI) {
    super(opts);
    this.#model = opts.options.model;
    this.#extras = opts.options.extras ?? {};
    this.#client = new OpenAI({
      apiKey: opts.options.api_key,
      baseURL: opts.options.base_url,
    });
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const response = await this.#client.embeddings.create({
      input: text,
      model: this.#model,
      dimensions: EMBEDDING_DIMENSIONS,
      ...(this.#extras ?? {}),
    } as any);
    return {
      embedding: response.data[0].embedding,
      tokens: response.usage.prompt_tokens,
    };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const response = await this.#client.embeddings.create({
      input: texts,
      model: this.#model,
      dimensions: EMBEDDING_DIMENSIONS,
      ...(this.#extras ?? {}),
    } as any);
    // OpenAI returns embeddings in the same order as the input texts
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => ({
        embedding: d.embedding,
        tokens: Math.round(response.usage.prompt_tokens / texts.length),
      }));
  }
}
