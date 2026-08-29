import assert from "node:assert";
import { InitContext, WithContext } from "../context.js";
import { AbstractEmbeddingModel } from "./embedding/abstract.js";
import { AbstractSessionModel } from "./session/abstract.js";
import { initializeSessionModel } from "./session/init.js";
import { initializeEmbeddingModel } from "./embedding/init.js";

export class ModelManager extends WithContext {

  #session?: AbstractSessionModel;
  #embedding?: AbstractEmbeddingModel;
  #distillation?: AbstractSessionModel;
  #compaction?: AbstractSessionModel;

  constructor(init: InitContext) {
    super(init);
  }

  async initialize() {
    this.#session = await initializeSessionModel(this._ctx.config.models.session);
    this.#embedding = await initializeEmbeddingModel(this._ctx.config.models.embedding);
    this.#distillation = await initializeSessionModel(this._ctx.config.models.session);
    this.#compaction = await initializeSessionModel(this._ctx.config.models.session);
  }

  get session(): AbstractSessionModel {
    assert(this.#session);
    return this.#session;
  }

  get embedding(): AbstractEmbeddingModel {
    assert(this.#embedding);
    return this.#embedding;
  }

  get distillation(): AbstractSessionModel {
    assert(this.#distillation);
    return this.#distillation;
  }

  get compaction(): AbstractSessionModel {
    assert(this.#compaction);
    return this.#compaction;
  }

}
