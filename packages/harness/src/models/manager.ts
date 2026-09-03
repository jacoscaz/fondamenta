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
 *
 * Models are keyed by their config `id` (unique harness-internal
 * identifier) — never by position (Jacopo's review, PR #27: identity
 * by name, not by array index).
 */
export class ModelManager extends WithContext {

  /** Session model adapters by config id. */
  #sessions: Map<string, AbstractSessionModel> = new Map();
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
      assert(session_config.id, 'every session model config needs an id');
      assert(!this.#sessions.has(session_config.id), `duplicate session model id: ${session_config.id}`);
      this.#sessions.set(session_config.id, await initializeSessionModel(session_config));
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

  /** Session model adapters by config id. Throws on unknown id. */
  session(id: string): AbstractSessionModel {
    const model = this.#sessions.get(id);
    assert(model, `unknown session model id: '${id}' (known: ${[...this.#sessions.keys()].join(', ')})`);
    return model;
  }

  /** All configured session model instances, in config order. */
  get sessionModels(): AbstractSessionModel[] {
    return [...this.#sessions.values()];
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
