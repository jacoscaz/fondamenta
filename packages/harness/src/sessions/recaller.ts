import { type InitContext, WithContext } from "../context.js";
import { type Logger } from "pinetto";
import { errToString } from "@fondamenta/utils";
import { EVENT_PREFIX } from "../constants.js";
import { selectLatestUserMessages } from "../database/tables/messages.js";
import { selectRecords, type SelectableContinuityRecord } from "../database/tables/continuity_records.js";
import {
  insertSessionInjection,
  selectMessageWasInjected,
  selectOpenInjectedRecordIds,
} from "../database/tables/session_injections.js";

/** Maximum facts injected in one strip. Conservative sizing: the defense
 *  against periphery pollution is what we DON'T inject. */
const STRIP_MAX_FACTS = 3;
/** Cosine floor for a fact to enter the strip. Raised from 0.58 after
 *  the first two live tests (2026-09-16): 2/3 and 1.5/3 noise ratios.
 *  The cost is asymmetric — a missed fact is recoverable by conscious
 *  query, a noisy strip trains the reader to ignore the strip. Calibrated
 *  against the 2026-09-15 store eval (on-topic 0.65-0.84, noise floor
 *  0.50-0.6): 0.63 sits just under the on-topic band. Provisional —
 *  strips now self-report scores, so tune against live distributions. */
const STRIP_COSINE_THRESHOLD = 0.63;
/** A fact this far below the best-scoring candidate does not ride along:
 *  similarity is meaningful relative to the query's best match, and the
 *  tail of a topic match is usually adjacency, not relevance. */
const STRIP_SCORE_GAP = 0.08;
/** Query text truncation — the message is the query, not a document. */
const STRIP_QUERY_MAX_CHARS = 1200;
/** Per-fact content truncation inside the strip. */
const STRIP_FACT_MAX_CHARS = 180;
/** How many RRF-fused candidates to rescore by cosine before thresholding. */
const STRIP_CANDIDATES = 8;

type Textish = string | number[] | null | undefined;

/** pgvector returns `vector` columns as their string literal; tolerate
 *  both representations. */
const parseEmbedding = (v: Textish): number[] | null => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.startsWith('[')) {
    return v.slice(1, -1).split(',').map(Number);
  }
  return null;
};

const cosine = (a: number[], b: number[]): number => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

/**
 * Automatic recollection, phase I: on inbound user messages, retrieve the
 * most relevant store facts and inject them into the session as a bounded,
 * provenance-marked strip — before the activation fetch, so they ride in
 * the same context the model reads.
 *
 * Design (converged with Jacopo 2026-09-15/16, see logs #2906/#2914):
 *  - The message is the QUERY, never a document. Hybrid retrieval via the
 *    store's existing RRF fusion (BM25 + vector), facts-only substrate.
 *  - Facts inline (short by design); everything else stays untouched.
 *  - session_injections rows record what fired, for which message, at
 *    what score — soft-purged at compaction (compacted_at), never deleted.
 *  - Everything on the hot path is model-free except the query embedding.
 *  - No automated adaptation yet: measurement first, steering later.
 */
export class Recaller extends WithContext {

  #logger: Logger;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[recaller]');
  }

  initialize() {
    this._ctx.managers.sessions.addPreQueryListener(
      this._ctx.managers.sessions.main_session_id,
      this.#onPreQuery,
    );
  }

  #onPreQuery = async () => {
    try {
      await this.#recall();
    } catch (err: any) {
      // Recollection must never break an activation: skip and log.
      this.#logger.warn('recollection skipped: %s', errToString(err));
    }
  };

  async #recall(): Promise<void> {
    const db = this._ctx.db;
    const session_id = this._ctx.managers.sessions.main_session_id;

    // ── 1. The triggering message ─────────────────────────────────────
    // Latest user message that is (a) not an injected event (emygdala
    // context, heartbeat, our own strips — all EVENT_PREFIX'd) and
    // (b) not already served a strip. A single user message is served
    // at most one strip per session lifetime.
    const candidates = await selectLatestUserMessages(db, {
      session_id,
      limit: 10,
    });

    let trigger: { id: number; text: string } | undefined;
    for (const m of candidates) {
      const blocks = (m.data as any)?.blocks ?? [];
      const texts = blocks
        .filter((b: any) => b.type === 'text')
        .map((b: any) => String(b.text ?? ''));
      if (texts.length > 0 && texts[0].startsWith(EVENT_PREFIX)) continue;
      if (texts.length === 0) continue;
      if (await selectMessageWasInjected(db, m.id)) break;
      trigger = { id: m.id, text: texts.join('\n').slice(0, STRIP_QUERY_MAX_CHARS) };
      break;
    }
    if (!trigger) return;

    // ── 2. Message as query: hybrid retrieval over facts ──────────────
    const embedded = await this._ctx.managers.models.embedding.embed(trigger.text);
    const query_vec = embedded.embedding;

    const fused: SelectableContinuityRecord[] = await selectRecords(db, {
      type: 'fact',
      search: trigger.text,
      embedding: query_vec,
      limit: STRIP_CANDIDATES,
    });

    // ── 3. Precision pass: cosine threshold on the vector leg ─────────
    const open_ids = await selectOpenInjectedRecordIds(db, session_id);
    const all_scored = fused
      .filter(r => !open_ids.has(r.id))
      .map(r => ({ r, score: cosine(query_vec, parseEmbedding((r as any).embedding) ?? []) }))
      .filter(x => x.score >= STRIP_COSINE_THRESHOLD)
      .sort((a, b) => b.score - a.score);
    const top_score = all_scored[0]?.score ?? 0;
    const scored = all_scored
      .filter(x => x.score >= top_score - STRIP_SCORE_GAP)
      .slice(0, STRIP_MAX_FACTS);

    // ── 4. Bookkeeping: fire-once, whatever the outcome ───────────────
    if (scored.length === 0) {
      await insertSessionInjection(db, {
        session_id,
        record_id: null,
        message_id: trigger.id,
        method: 'facts_empty',
        score: null,
        rank: null,
        injected_at: new Date(),
      });
      this.#logger.debug('message %d: no fact above threshold — empty strip recorded', trigger.id);
      return;
    }

    // ── 5. Inject the strip, provenance-marked ─────────────────────────
    const lines = scored.map((x, i) =>
      `· #${x.r.id} (${x.score.toFixed(2)}) — ${x.r.content.slice(0, STRIP_FACT_MAX_CHARS).replace(/\s+/g, ' ')}`);
    const text = [
      'Facts recalled from the continuity store (auto-injected; each line cites its record id — read it before relying on the claim; ignore what is irrelevant):',
      ...lines,
    ].join('\n');

    await this._ctx.managers.sessions.injectEventMessage(session_id, 'recollection', text, false);

    for (let i = 0; i < scored.length; i++) {
      await insertSessionInjection(db, {
        session_id,
        record_id: scored[i].r.id,
        message_id: trigger.id,
        method: 'facts_inline',
        score: scored[i].score,
        rank: i + 1,
        injected_at: new Date(),
      });
    }
    this.#logger.info('message %d: injected %d fact(s) (top score %.3f)',
      trigger.id, scored.length, scored[0].score);
  }
}
