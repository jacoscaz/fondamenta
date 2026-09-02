import assert from "node:assert";
import { InitContext, WithContext } from "../context.js";
import { AbstractEmbeddingModel } from "./embedding/abstract.js";
import { AbstractSessionModel } from "./session/abstract.js";
import { AbstractTranscriptionModel } from "./transcription/abstract.js";
import { initializeSessionModel } from "./session/init.js";
import { initializeEmbeddingModel } from "./embedding/init.js";
import { initializeTranscriptionModel } from "./transcription/init.js";

export class ModelManager extends WithContext {

  #session?: AbstractSessionModel;
  #embedding?: AbstractEmbeddingModel;
  #transcription?: AbstractTranscriptionModel;
  #distillation?: AbstractSessionModel;
  #compaction?: AbstractSessionModel;

  constructor(init: InitContext) {
    super(init);
  }

  async initialize() {
    this.#session = await initializeSessionModel(this._ctx.config.models.session);
    this.#embedding = await initializeEmbeddingModel(this._ctx.config.models.embedding);
    if (this._ctx.config.models.transcription) {
      this.#transcription = await initializeTranscriptionModel(this._ctx.config.models.transcription);
    }
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

  /** undefined when no transcription model is configured. */
  get transcription(): AbstractTranscriptionModel | undefined {
    return this.#transcription;
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
