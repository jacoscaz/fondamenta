/**
 * Recollection gate prompt: role classification + subject extraction,
 * in one call. Consumed by the recaller via the session extractor model
 * (models.extraction). Kept here so every harness prompt lives in one
 * place.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You are the memory-recall gate for an AI agent with a persistent knowledge store about its work, projects and relationships.

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
