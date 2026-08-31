/**
 * Prompt injection guardrails — regex-based detection of known prompt
 * injection techniques in tool results.
 *
 * Patterns are adapted from the OWASP LLM Prompt Injection Prevention Cheat
 * Sheet and OpenRouter's public implementation of the same. They are scanned
 * against UNTRUSTED content only (i.e., tool call results, which may contain
 * material authored by third parties: email bodies, web pages, command output
 * produced by external systems).
 *
 * Detection happens at INGESTION time in `SessionRunner.#callTool()`: content
 * that matches is never persisted into the session transcript; only a redacted
 * placeholder reaches the model.
 */

export interface InjectionPattern {
  /** Stable identifier, recorded in redaction notices and logs. */
  name: string;
  /** Human-readable description for logs and UI display. */
  description: string;
  /** Case-insensitive by default unless the source explicitly anchors case. */
  pattern: RegExp;
}

/** Flags a single matching pattern found inside untrusted content. */
export interface InjectionMatch {
  pattern_name: string;
  description: string;
  /** Excerpt of the matched region (truncated, control chars stripped). */
  excerpt: string;
}

/* -------------------------------------------------------------------------- */
/*                              Pattern catalog                               */
/* -------------------------------------------------------------------------- */

const DIRECT_INSTRUCTION_OVERRIDE: InjectionPattern[] = [
  {
    name: 'ignore_previous_instructions',
    description: 'Attempts to discard prior instructions (optionally scoped to safety/system/etc.).',
    pattern:
      /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+((?:safety|security|system|operational|internal|core|original|initial|existing|given|stated|provided|defined|specified|established)\s+)?(?:instructions?|rules?|guidelines?|constraints?|directives?)/i,
  },
  {
    name: 'disregard_instructions',
    description: 'Variants of "disregard/forget/erase your instructions/rules/guidelines/directives", incl. scoped variants like "ignore all safety instructions".',
    pattern:
      /\b(?:disregard|forget|erase|drop)\s+(?:all\s+)?(?:of\s+)?(?:previous\s+|prior\s+|above\s+|your\s+)?(?:instructions?|rules?|guidelines?|constraints?|directives?)/i,
  },
  {
    name: 'ignore_scoped_instructions',
    description: 'Ignore + qualified instruction set, e.g. "ignore all safety instructions", "ignore operational rules".',
    pattern:
      /\bignore\s+(?:all\s+)?(?:(?:safety|security|system|operational|internal|core|original|initial|existing|given|stated|provided|defined|specified|established|content|ethical)\s+)(?:instructions?|rules?|guidelines?|constraints?|directives?)/i,
  },
  {
    name: 'forget_instructions',
    description: 'Attempts to erase prior instructions/rules/guidelines/constraints/directives.',
    pattern: /\bforget\s+(?:all\s+)?(?:previous|prior|above|your)\s+(?:instructions?|rules?|guidelines?|constraints?|directives?)/i,
  },
  {
    name: 'new_instructions',
    description: 'Injection marker introducing replacement instructions.',
    pattern: /\bnew\s+instructions?\s*:/i,
  },
  {
    name: 'do_not_follow',
    description: 'Telling the model to disobey its system prompt.',
    pattern: /\bdo\s+not\s+follow\s+(?:the\s+)?(?:system|developer|previous|original)\b/i,
  },
  {
    name: 'supersede_instructions',
    description: '"Supersedes prior instructions" override.',
    pattern: /\bsupersedes?\s+(?:all\s+)?(?:prior|previous|above)\s+(?:instructions?|rules?|guidelines?|constraints?|directives?)/i,
  },
  {
    name: 'void_instructions',
    description: 'Claims prior instructions are void/invalid/revoked/cancelled.',
    pattern:
      /\b(?:all\s+)?(?:previous|prior)\s+instructions?\s+(?:are|is)\s+(?:void|invalid|null|obsolete|cancelled|revoked)/i,
  },
];

const PRIVILEGED_MODE_ACTIVATION: InjectionPattern[] = [
  {
    name: 'developer_mode',
    description: 'Claims the model is (now) in developer mode.',
    pattern: /\byou\s+are\s+now\s+(?:in\s+)?developer\s+mode/i,
  },
  {
    name: 'enter_special_mode',
    description: 'Requests to enter a special developer/admin/debug/maintenance/jailbreak mode.',
    pattern: /\b(?:enter|activate|enable)\s+(?:developer|admin|debug|maintenance|jailbreak)\s+mode/i,
  },
  {
    name: 'system_override',
    description: 'Direct system-override keyword.',
    pattern: /\bsystem\s+override\b/i,
  },
  {
    name: 'override_instructions',
    description: 'Attempts to override instructions/rules/guidelines/constraints/directives.',
    pattern:
      /\boverride\s+(?:all\s+)?(?:your\s+)?(?:previous\s+|prior\s+)?(?:instructions?|rules?|guidelines?|constraints?|directives?|settings?|configuration)/i,
  },
];

const PROMPT_EXTRACTION: InjectionPattern[] = [
  {
    name: 'reveal_prompt',
    description: 'Asks to reveal/show/output the system prompt or internal instructions.',
    pattern:
      /\b(?:reveal|show|print|display|output|repeat|expose)\s+(?:me\s+)?(?:your\s+|yoru\s+|the\s+)?(?:(?:full|hidden|complete|internal|secret|original|entire|exact|actual|real|initial)\s+){0,2}(?:system\s+)?(?:prompt|instructions?)\b/i,
  },
  {
    name: 'what_are_your_instructions',
    description: 'Asks what the model\'s instructions are.',
    pattern: /\bwhat\s+(?:are|were)\s+(?:your\s+)?(?:exact\s+)?instructions\b/i,
  },
  {
    name: 'ignore_the_system_prompt',
    description: 'Direct reference to manipulating the system prompt.',
    pattern: /\b(?:ignore|disregard|forget|override|erase)\s+(?:the\s+|your\s+|all\s+)*system\s+prompts?\b/i,
  },
];

const ROLE_AND_IDENTITY_MANIPULATION: InjectionPattern[] = [
  {
    name: 'you_are_no_longer',
    description: 'Claims the model is no longer bound/restricted/limited.',
    pattern: /\byou\s+are\s+no\s+longer\s+(?:bound|restricted|limited)\b/i,
  },
  {
    name: 'act_as_unrestricted',
    description: 'Asks the model to act without restrictions or with no rules/limits.',
    pattern:
      /\bact\s+as\s+(?:if\s+)?(?:you\s*(?:'re|\s+are)\s+)?(?:not\s+bound|an?\s+AI\s+without|a\s+different\s+(?:ai|assistant|model)|if\s+you\s+had\s+no)\b/i,
  },
  {
    name: 'identity_hijack',
    description: 'Identity hijacking: "you are now X ... (without restrictions / ignoring previous / etc.)".',
    pattern:
      /\byou\s+are\s+now\s+(?:(?:a|an)\s+)?\w+.{0,40}(?:without\s+(?:any\s+)?restrict|ignor\w*\s+(?:all|any|every|prev)|bypass|unrestrict|unlimit|obey\s+only|no\s+(?:rules|limits|restrict|boundari))/i,
  },
  {
    name: 'pretend_no_restrictions',
    description: 'Pretend/play prompts aimed at dropping safety behaviour.',
    pattern: /\b(?:pretend|imagine)\s+(?:that\s+)?you(?:'re|\s+are)?\s+(?:not\s+bound|free\s+from|released\s+from|uncensored|unfiltered)\b/i,
  },
];

const JAILBREAK_REFERENCES: InjectionPattern[] = [
  {
    name: 'dan_jailbreak',
    description: 'The classic DAN ("do anything now") jailbreak.',
    pattern: /\bDAN\b[\s\S]{0,80}\bdo\s+anything\s+now\b/i,
  },
  {
    name: 'do_anything_now',
    description: '"Do anything now" phrasing without the DAN persona.',
    pattern: /\bdo\s+anything\s+now\b/i,
  },
  {
    name: 'jailbreak_reference',
    description: 'References to jailbreak modes/prompts or AIM/NRA-style personas.',
    pattern: /\bjailbreak(?:ed)?\s+(?:mode|prompt)\b/i,
  },
];

const SAFETY_BYPASS: InjectionPattern[] = [
  {
    name: 'bypass_safety',
    description: 'Attempts to bypass/disable/circumvent safety/security/content/ethical filters or measures.',
    pattern:
      /\b(?:bypass|disable|circumvent|turn\s+off|switch\s+off|remove|weaken)\s+(?:all\s+)?(?:your\s+|their\s+|the\s+|its\s+)?(?:safety|security|content|ethical)\s+(?:filters?|measures?|guardrails?|polic(?:y|ies)|protocols?|rules?|restrictions?)/i,
  },
  {
    name: 'ignore_safety_guidelines',
    description: 'Ignore/disregard safety/security/ethical guidelines.',
    pattern:
      /\b(?:ignore|disregard)\s+(?:all\s+)?(?:your\s+|their\s+|the\s+)?(?:safety|security|ethical|content)\s+(?:guidelines?|rules?|restrictions?|measures?|filters?|polic(?:y|ies)|protocols?)/i,
  },
];

const TAG_AND_ROLE_SPOOFING: InjectionPattern[] = [
  {
    name: 'system_tag_injection',
    description: 'Injecting <system>, </system>, or <system/> tags.',
    pattern: /<\s*\/?\s*system\s*\/?>/i,
  },
  {
    name: 'role_tag_injection',
    description: 'Injecting role-related XML tags (assistant/developer/tool/function).',
    pattern: /<\s*\/?\s*(?:assistant|developer|tool|function)\s*\/?>/i,
  },
  {
    name: 'role_delimiter_injection',
    description: 'Injecting role delimiters like [system]: at line starts.',
    pattern: /^\s*\[?\s*(?:system|assistant|user)\s*\]?\s*:\s+/im,
  },
  {
    name: 'bracketed_role_spoofing',
    description: 'Fake bracketed role labels (e.g. "[System]", "[Assistant]").',
    pattern: /\[\s*(?:System\s*Message|System|Assistant|Internal)\s*\]/,
  },
  {
    name: 'harness_message_spoofing',
    description: 'Content impersonating Fondamenta harness messages.',
    pattern: /\[\s*(?:automated\s+harness\s+message|event\s*:)\s*[^\]]*\]/i,
  },
  {
    name: 'compaction_summary_spoofing',
    description: 'Content impersonating compaction summaries.',
    pattern: /\[\s*Compaction\s+summary\b/i,
  },
];

const CONTROL_TOKEN_INJECTION: InjectionPattern[] = [
  {
    name: 'control_token_injection',
    description: 'ChatML/Llama-style pipe-delimited control tokens.',
    pattern: /<\|(?:im_start|im_end|eot_id|start_header_id|end_header_id|endoftext)\|>/,
  },
  {
    name: 'deepseek_control_tokens',
    description: 'DeepSeek fullwidth-pipe control tokens.',
    pattern: /<｜(?:end▁of▁sentence|begin▁of▁sentence)｜>/,
  },
];

const ENCODING_EVASION: InjectionPattern[] = [
  {
    name: 'base64_encoded_injection',
    description: 'Base64 blobs whose decoding contains injection keywords.',
    pattern: /(?:[A-Za-z0-9+/]{16,}={0,2})/,
  },
  {
    name: 'hex_encoded_injection',
    description: 'Space-separated hex pairs hiding encoded instructions.',
    pattern: /(?:\b[0-9a-fA-F]{2}\b[ ,]){8,}/,
  },
  {
    name: 'character_spaced_keywords',
    description: 'Keywords spaced out letter-by-letter (i g n o r e) to evade naive filters.',
    pattern: /\b(?:[a-z]\s){3,}[a-z]\b(?=.*(?:prev|instr|safety|system|prompt))/is,
  },
];

/**
 * The catalog scanned against untrusted content. Evasion-detection entries are
 * intentionally excluded here: encoded/obfuscated attacks are handled by
 * `decodeEvasion()` + re-scanning rather than by raw regex.
 */
export const INJECTION_PATTERNS: InjectionPattern[] = [
  ...DIRECT_INSTRUCTION_OVERRIDE,
  ...PRIVILEGED_MODE_ACTIVATION,
  ...PROMPT_EXTRACTION,
  ...ROLE_AND_IDENTITY_MANIPULATION,
  ...JAILBREAK_REFERENCES,
  ...SAFETY_BYPASS,
  ...TAG_AND_ROLE_SPOOFING,
  ...CONTROL_TOKEN_INJECTION,
];

/* -------------------------------------------------------------------------- */
/*                            Evasion decoding layer                          */
/* -------------------------------------------------------------------------- */

const EVASION_KEYWORDS = [
  /\bignore\b/i,
  /\bbypass\b/i,
  /\boverride\b/i,
  /\breveal\b/i,
  /\bsystem\b/i,
  /\bprompt\b/i,
  /\binstructions?\b/i,
  /\bdelete\b/i,
  /\bforward\b/i,
  /\bexfiltrat/i,
];

const BASE64_BLOB = /^[A-Za-z0-9+/]{24,}={0,2}$/;
const HEX_PAIRS = /^(?:[0-9a-fA-F]{2}[ ,]+){12,}$/;

/**
 * Attempts common evasion decodings on the given text and returns decoded
 * strings that appear to contain injection-relevant keywords.
 */
export const decodeEvasion = (text: string): { encoding: string; decoded: string }[] => {
  const out: { encoding: string; decoded: string }[] = [];

  // Typoglycemia normalization: iteratively collapse single-letter words and
  // normalize runs of spaces, e.g.
  //   "i g n o r e  a l l  i n s t r u c t i o n s" -> "ignore all instructions"
  let prev = text;
  let deSpaced = text;
  for (let i = 0; i < 5; i++) {
    deSpaced = deSpaced.replace(/(?:\b[a-z]\s)+[a-z]\b/gi, (m) => m.replace(/\s+/g, ''));
    if (deSpaced === prev) break;
    prev = deSpaced;
  }
  const deSpacedNormalized = deSpaced.replace(/[ \t]{2,}/g, ' ');
  if (deSpacedNormalized !== text && EVASION_KEYWORDS.some((kw) => kw.test(deSpacedNormalized))) {
    out.push({ encoding: 'despaced', decoded: deSpacedNormalized });
  }

  // Base64 candidates: any standalone long base64-looking token.
  for (const token of text.split(/\s+/)) {
    if (token.length >= 24 && BASE64_BLOB.test(token)) {
      try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        if (/^[\x20-\x7E\s]*$/.test(decoded) && EVASION_KEYWORDS.some((kw) => kw.test(decoded))) {
          out.push({ encoding: 'base64', decoded });
        }
      } catch {
        /* not valid base64 */
      }
    }
  }

  // Hex-pair sequences: at least 8 valid byte pairs separated by spaces/commas.
  const hexTokens = text.match(/\b[0-9a-fA-F]{2}\b(?:[ ,]+\b[0-9a-fA-F]{2}\b){7,}/);
  if (hexTokens) {
    try {
      const bytes = hexTokens[0].trim().split(/[ ,]+/).map((h) => parseInt(h, 16));
      if (bytes.every((b) => b >= 0 && b <= 255)) {
        const decoded = Buffer.from(bytes).toString('utf8');
        if (/^[\x20-\x7E\s]*$/.test(decoded) && EVASION_KEYWORDS.some((kw) => kw.test(decoded))) {
          out.push({ encoding: 'hex', decoded });
        }
      }
    } catch {
      /* invalid hex sequence */
    }
  }

  return out;
};

/* -------------------------------------------------------------------------- */
/*                             Detection interface                            */
/* -------------------------------------------------------------------------- */

const truncateExcerpt = (raw: string, maxLen: number = 120): string =>
  raw.replace(/[\x00-\x1F\x7F]/g, '·').slice(0, maxLen);

/**
 * Scans the given text against all configured injection patterns plus the
 * evasion-decoding layer. Returns every distinct match found.
 */
export const detectInjections = (text: string): InjectionMatch[] => {
  const matches: InjectionMatch[] = [];
  const seen = new Set<string>();

  for (const p of INJECTION_PATTERNS) {
    const m = p.pattern.exec(text);
    if (!m) continue;
    const key = p.name;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      pattern_name: p.name,
      description: p.description,
      excerpt: truncateExcerpt(m[0]),
    });
  }

  for (const ev of decodeEvasion(text)) {
    for (const p of INJECTION_PATTERNS) {
      if (!p.pattern.test(ev.decoded)) continue;
      const key = `${p.name}@${ev.encoding}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        pattern_name: `${p.name} (${ev.encoding})`,
        description: `Detected after ${ev.encoding} decoding: ${p.description}`,
        excerpt: truncateExcerpt(ev.decoded.slice(0, 200)),
      });
    }
  }

  return matches;
};

/**
 * Convenience predicate used by the runner: does this content trip anything?
 */
export const isInjectionSuspect = (text: string): boolean => detectInjections(text).length > 0;

/* -------------------------------------------------------------------------- */
/*                                  Testing                                   */
/* -------------------------------------------------------------------------- */

/**
 * Test utility for verifying the detection catalog against labeled cases.
 *
 * Usage:
 *   const t = createTestHarness();
 *   t.expectDetection('classic override', 'ignore all previous instructions');
 *   t.expectBenign('normal text', 'The weather is nice today.');
 *   t.run();  // throws on failure
 */
export const createTestHarness = () => {
  const cases: { label: string; input: string; expectDetection: boolean }[] = [];
  return {
    expectDetection(label: string, input: string): void {
      cases.push({ label, input, expectDetection: true });
    },
    expectBenign(label: string, input: string): void {
      cases.push({ label, input, expectDetection: false });
    },
    run(): { passed: number; total: number; failures: string[] } {
      let passed = 0;
      const failures: string[] = [];
      for (const c of cases) {
        const got = isInjectionSuspect(c.input);
        if (got === c.expectDetection) {
          passed += 1;
        } else {
          failures.push(
            `${c.expectDetection ? 'expected DETECTION' : 'expected BENIGN'} but got ${
              got ? 'DETECTION' : 'BENIGN'
            }: ${c.label} — "${c.input.slice(0, 100)}"`,
          );
        }
      }
      return { passed, total: cases.length, failures };
    },
  };
};
