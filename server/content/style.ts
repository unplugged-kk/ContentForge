/**
 * Real-post style intelligence primitives (Phase 11).
 *
 * `AuthoredContent -> StyleAnalyzerPort -> StyleObservation` — the exact same
 * shape as Phase 3's `VisualGenerationRequest -> VisualProviderPort ->
 * VisualGenerationOutput`. Observed style is EVIDENCE, not truth: it never
 * overwrites the user's stable `user_profile` fields (brandVoice, niche,
 * audienceDescription, contentGoals, writingStyleNotes, messagingPillars —
 * Phase 10's "profile" context source), and it enters generation ONLY
 * through Phase 10's existing `ContextStorageReader` / `assembleContext()`
 * seam (`styleService.ts` extends the reader that already exists; this file
 * never talks to `assembleContext` directly).
 *
 * The durable result is a `style_profiles` row (Phase 10 already reads this
 * table via `isFavorite`); Phase 11 generalizes it with a structured,
 * versioned, provenance-carrying observation rather than introducing a
 * parallel table.
 */

import { z } from "zod";

// ── Confidence (Ticket 11 §13) — explicit, documented, never a magic number ──
/**
 * `strong`   — the source gave clear, repeated signal for this observation.
 * `weak`     — some signal, but thin or mixed; treat as a hint, not a rule.
 * `insufficient` — the source did not give enough material to say anything;
 *                  the analyzer must return this rather than invent a trait.
 */
export const styleConfidenceEnum = z.enum(["strong", "weak", "insufficient"]);
export type StyleConfidence = z.infer<typeof styleConfidenceEnum>;

// ── Structured, bounded observation (Ticket 11 §5) — never a raw LLM blob ───
const shortText = z.string().trim().max(300);
const shortList = z.array(z.string().trim().max(120)).max(6);

export const styleDimensionsSchema = z.object({
  tone: shortText,
  sentenceRhythm: shortText,
  verbosity: shortText,
  formattingTendencies: shortText,
  punctuationTendencies: shortText,
  vocabularyRegister: shortText,
  hookPatterns: shortList,
  paragraphStructure: shortText,
  questionUsage: shortText,
  listUsage: shortText,
  emojiTendencies: shortText,
  ctaPatterns: shortList,
  rhetoricalPatterns: shortList,
  recurringTraits: shortList,
});
export type StyleDimensions = z.infer<typeof styleDimensionsSchema>;

export const styleObservationSchema = z.object({
  confidence: styleConfidenceEnum,
  /** One line explaining WHY that confidence — never a bare number. */
  confidenceReason: z.string().trim().max(300),
  dimensions: styleDimensionsSchema,
});
export type StyleObservation = z.infer<typeof styleObservationSchema>;

export class InvalidStyleObservationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid style observation: ${issues.join("; ")}`);
    this.name = "InvalidStyleObservationError";
    this.issues = issues;
  }
}

/** Validate untrusted analyzer output BEFORE anything durable. */
export function validateStyleObservation(raw: unknown): StyleObservation {
  const result = styleObservationSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidStyleObservationError(result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  return result.data;
}

// ── Analyzer contract (Phase 11 §5/§6) — one canonical abstraction ──────────
export type AuthoredSourceType = "x_post" | "linkedin_post" | "manual";

export interface AuthoredContent {
  /** Normalized text — platform mechanics stay in metadata, never a branch here. */
  text: string;
  sourceType: AuthoredSourceType;
  correlationId: string;
}

export interface StyleAnalyzerOutput {
  observation: StyleObservation;
  model: string;
  provider: string;
  usage: Record<string, unknown>;
}

export interface StyleAnalyzerPort {
  readonly providerId: string;
  readonly providerVersion: string;
  analyze(content: AuthoredContent): Promise<StyleAnalyzerOutput>;
}

export class StyleAnalyzerNotRegisteredError extends Error {
  constructor(providerId: string) {
    super(`No style analyzer registered for "${providerId}"`);
    this.name = "StyleAnalyzerNotRegisteredError";
  }
}

const analyzerRegistry = new Map<string, StyleAnalyzerPort>();

/** Deterministic selection: exact analyzer id, never inferred. */
export function registerStyleAnalyzer(analyzer: StyleAnalyzerPort): void {
  analyzerRegistry.set(analyzer.providerId, analyzer);
}
export function getStyleAnalyzer(providerId: string): StyleAnalyzerPort {
  const analyzer = analyzerRegistry.get(providerId);
  if (!analyzer) throw new StyleAnalyzerNotRegisteredError(providerId);
  return analyzer;
}
export function hasStyleAnalyzer(providerId: string): boolean {
  return analyzerRegistry.has(providerId);
}
export function resetStyleAnalyzers(): void {
  analyzerRegistry.clear();
}

// ── Minimum bar for analysis (Ticket 11 §13 — "insufficient evidence") ──────
export const MIN_AUTHORED_TEXT_LENGTH = 20;
export const MAX_AUTHORED_TEXT_LENGTH = 10_000;

export class InvalidAuthoredContentError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid authored content: ${issues.join("; ")}`);
    this.name = "InvalidAuthoredContentError";
    this.issues = issues;
  }
}

/** Normalize + bound-check untrusted authored text before it ever reaches an analyzer. */
export function normalizeAuthoredText(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const issues: string[] = [];
  if (text.length < MIN_AUTHORED_TEXT_LENGTH) issues.push(`too short (${text.length} chars) to analyze meaningfully`);
  if (text.length > MAX_AUTHORED_TEXT_LENGTH) issues.push(`exceeds ${MAX_AUTHORED_TEXT_LENGTH} chars`);
  if (issues.length > 0) throw new InvalidAuthoredContentError(issues);
  return text;
}
