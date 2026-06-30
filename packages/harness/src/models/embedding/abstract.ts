import { type ConfigEmbeddingsModelBase } from "../../config/config.js";

export interface EmbeddingResult {
  embedding: number[];
  tokens: number;
}

export abstract class AbstractEmbeddingModel {

  readonly #dimensions: number;

  constructor(opts: ConfigEmbeddingsModelBase) {
    this.#dimensions = opts.options.dimensions ?? 1536;
  }

  get dimensions(): number {
    return this.#dimensions;
  }

  abstract embed(text: string): Promise<EmbeddingResult>;

  abstract embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
}
