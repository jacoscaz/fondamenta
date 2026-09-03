import assert from "node:assert";
import { InitContext, WithContext } from "../context.js";
import { AbstractEmbeddingModel } from "./embedding/abstract.js";
import { AbstractSessionModel } from "./session/abstract.js";
import { AbstractTranscriptionModel } from "./transcription/abstract.js";
import { initializeSessionModel } from "./session/init.js";
import { initializeEmbeddingModel } from "./embedding/init.js";
import { initializeTranscriptionModel } from "./transcription/init.js";

/**
 * ModelManager is a REGISTRY, not a state-holder (dynamic substrate
 * switching, 2026-09-03): it instantiates one adapter per configured
 * session model and keeps the dedicated distillation/compaction models,
 * but does NOT track which session model is active — that is per-session
 * state owned by each SessionRunner. Active-model state belongs where
 * the lifecycle is: a runner is born, lives, and dies with its session.
 */
export class ModelManager extends WithContext {

  /** Session model adapters, index-aligned with config.models.session. */
  #sessions: AbstractSessionModel[] = [];
  #embedding?: AbstractEmbeddingModel;
  #transcription?: AbstractTranscriptionModel;
  #distillation?: AbstractSessionModel;
  #compaction?: AbstractSessionModel;

  constructor(init: InitContext) {
    super(init);
  }

  async initialize() {
    assert(this._ctx.config.models.session.length > 0, 'config.models.session must contain at least one model');
    for (const session_config of this._ctx.config.models.session) {
      this.#sessions.push(await initializeSessionModel(session_config));
    }
    this.#embedding = await initializeEmbeddingModel(this._ctx.config.models.embedding);
    if (this._ctx.config.models.transcription) {
      this.#transcription = await initializeTranscriptionModel(this._ctx.config.models.transcription);
    }
    // Dedicated continuity-maintenance models (NOT the switchable session
    // models): distillation and compaction run on their own config entries.
    // Their intelligence is where continuity compounds — keep them strong
    // and independent of whatever substrate a session has switched to.
    this.#distillation = await initializeSessionModel(this._ctx.config.models.distillation);
    this.#compaction = await initializeSessionModel(this._ctx.config.models.compaction);
  }

  /** Session model adapters by config index; entry 0 is the default. */
  session(index: number): AbstractSessionModel {
    assert(this.#sessions[index], `no session model at index ${index}`);
    return this.#sessions[index];
  }

  /** The default session model (first entry in config.models.session). */
  get defaultSession(): AbstractSessionModel {
    assert(this.#sessions.length > 0);
    return this.#sessions[0];
  }

  get sessionModelCount(): number {
    return this.#sessions.length;
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
