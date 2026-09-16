import { type AbstractSessionModel } from "../models/session/abstract.js";
import { type Logger } from "pinetto";
import { errToString } from "@fondamenta/utils";

/**
 * Recollection query gate + contextual subject extraction (phase I.5,
 * design Note #2967).
 *
 * One call classifies the message's conversational role AND extracts the
 * subjects worth querying. The intelligence is in the extraction —
 * "which client operates in the energy sector?" names no entity — while
 * the gate itself is bookkeeping: elaborations, acknowledgments and
 * meta-discussion do not trigger queries even when subjects are present.
 *
 * The extractor sees only the message text, which the session model
 * already receives in full; same provider, zero new data flows.
 */

export interface ExtractionResult {
  query_worthy: boolean;
  subjects: string[];
}

const EXTRACTION_SYSTEM_PROMPT = `You are the memory-recall gate for an AI agent with a persistent knowledge store about its work, projects and relationships.

Given a user message, decide whether searching that store could add anything the conversation doesn't already have, and extract the subjects worth querying.

Respond with ONLY a JSON object, no other text:
{"query_worthy": <bool>, "subjects": ["...", ...]}

Rules:
- query_worthy=true when the message asks a question, introduces a new person, organization, project or topic, or shifts to a topic where past knowledge could matter.
- query_worthy=false for elaborations, acknowledgments, meta-discussion about the conversation itself, greetings, and generic statements — even when they mention subjects. If searching the memory store could not change what happens next, it is not query-worthy.
- subjects: 0-3 short phrases — people's names, organizations, projects, technical topics — phrased as they would appear in stored records.
- When query_worthy=false, subjects must be [].

Examples:

USER: "It is 2026-09-16T09:09Z. Your harness has just been started."
{"query_worthy": false, "subjects": []}

USER: "in compactor.ts there are direct uses of kysely's query builder. It would be better to implement those as database access functions"
{"query_worthy": true, "subjects": ["compactor", "database access layer", "kysely"]}

USER: "What if I mention the name 'Lorenzo'?"
{"query_worthy": true, "subjects": ["Lorenzo"]}

USER: "what do we think of lichens?"
{"query_worthy": true, "subjects": ["lichens"]}

USER: "which client of mine operates in the energy sector?"
{"query_worthy": true, "subjects": ["clients", "energy sector"]}

USER: "However, the current recalling mechanism will for sure query facts and might even find matches."
{"query_worthy": false, "subjects": []}

USER: "Are there cloud-hosted models that can deliver sub-second responses with higher degrees of intelligence?"
{"query_worthy": true, "subjects": ["cloud inference providers", "low-latency language models"]}`;

/** Parse the model output into an ExtractionResult; null when the output
 *  is not a well-formed result (caller falls back to raw-message query). */
export const parseExtraction = (text: string): ExtractionResult | null => {
  // Tolerate JSON fenced in prose or code fences: take the first {...} block.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed.query_worthy !== 'boolean') return null;
  if (!Array.isArray(parsed.subjects) || parsed.subjects.some((s: any) => typeof s !== 'string')) return null;
  return {
    query_worthy: parsed.query_worthy,
    subjects: (parsed.subjects as any[])
      .slice(0, 3)
      .map((s: any) => String(s).trim())
      .filter((s: string) => s.length > 0),
  };
};

/** Run the extractor. Returns null on timeout, transport or parse failure —
 *  the caller falls back to raw-message querying. Never throws. */
export const runExtractor = async (
  model: AbstractSessionModel,
  message_text: string,
  logger: Logger,
): Promise<ExtractionResult | null> => {
  try {
    const { messages: res_messages } = await model.query({
      messages: [{
        role: 'user',
        type: 'input',
        blocks: [{ type: 'text', text: message_text }],
      }],
      tools: [],
      session_id: 'recollection-extractor',
      system_prompt: EXTRACTION_SYSTEM_PROMPT,
    });
    const text = res_messages
      .flatMap(m => m.type === 'input' ? m.blocks : [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => String((b as any).text ?? ''))
      .join('\n');
    const result = parseExtraction(text);
    if (!result) {
      logger.warn('extractor returned unparseable output (%d chars) — falling back', text.length);
    }
    return result;
  } catch (err: any) {
    logger.warn('extractor call failed: %s — falling back', errToString(err));
    return null;
  }
};
