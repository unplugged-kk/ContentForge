/**
 * Content quality signals — deterministic, offline, model-free.
 *
 * This is an INTELLIGENCE provider: it produces evidence about a piece of
 * generated content and decides nothing. The `quality_gate` decision consumes
 * these signals and returns approve / revise / reject.
 *
 * Every number here is a heuristic proxy, and the tests pin the direction that
 * matters rather than an exact value: boilerplate raises `boilerplateDensity`,
 * repeated phrasing raises `repetition`, vague copy lowers `specificity`, and
 * text beyond the format's cap sets `overLimit`. Nothing here reads the network
 * or a model, so it is cheap, deterministic and safe to run on every draft.
 */

export interface QualityProfile {
  maxCharacters?: number;
  maxUnits?: number;
  minUnits?: number;
  hookFirst?: boolean;
  cta?: boolean;
}

export interface QualityInput {
  text: string;
  units: string[];
  hook: string;
  cta: string;
}

export interface QualitySignals {
  wordCount: number;
  charCount: number;
  unitCount: number;
  avgSentenceWords: number;
  /** 0 = no repeated phrasing, 1 = heavily repeated. */
  repetition: number;
  /** 0 = none of the LLM filler phrases, 1 = saturated. */
  boilerplateDensity: number;
  /** 0 = assertive, 1 = every other clause hedged. */
  hedgingDensity: number;
  /** 0 = no links, 1 = link-stuffed. */
  linkDensity: number;
  emojiDensity: number;
  /** 0 = pure generality, 1 = dense with concrete/technical tokens. */
  specificity: number;
  /** Share of the format's character cap used (1 = exactly at the cap). */
  lengthFit: number;
  overLimit: boolean;
  hookPresent: boolean;
  ctaPresent: boolean;
  flags: string[];
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
  "is", "are", "was", "were", "be", "been", "being", "to", "of", "in", "on", "for", "with", "as",
  "at", "by", "from", "it", "its", "you", "your", "we", "our", "they", "their", "he", "she", "i",
  "not", "no", "so", "do", "does", "did", "can", "will", "would", "should", "could", "have", "has",
]);

const BOILERPLATE: RegExp[] = [
  /\bin today'?s (fast[- ]paced|ever[- ]changing|digital|modern) world\b/gi,
  /\blet'?s (dive|jump) in\b/gi,
  /\bgame[- ]chang(er|ing)\b/gi,
  /\bunlock(ing)? the (power|potential|secrets)\b/gi,
  /\bdelve into\b/gi,
  /\btapestry\b/gi,
  /\bin the (realm|landscape|world) of\b/gi,
  /\bit'?s not just .{0,40}?, it'?s\b/gi,
  /\bmoreover\b/gi,
  /\bfurthermore\b/gi,
  /\bwhen it comes to\b/gi,
  /\bthat being said\b/gi,
  /\bin conclusion\b/gi,
  /\bnavigate the\b/gi,
  /\bthe future of \w+ is\b/gi,
];

const HEDGES: RegExp[] = [
  /\bmight\b/gi, /\bmay\b/gi, /\bcould\b/gi, /\bperhaps\b/gi, /\barguably\b/gi,
  /\bit seems\b/gi, /\bsomewhat\b/gi, /\bpossibly\b/gi, /\bgenerally\b/gi,
  /\bi think\b/gi, /\bkind of\b/gi, /\bsort of\b/gi, /\btends? to\b/gi,
];

/** Surrogate-pair emoji + common BMP symbols (no `u` flag: the target is ES5). */
const EMOJI = /[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/g;
const LINK = /https?:\/\/\S+|www\.\S+/gi;
const CTA_HINT = /(link|comment|share|follow|subscribe|reply|thoughts|agree|disagree|try it|read more)/i;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number, places = 4): number {
  return Number(clamp01(value).toFixed(places));
}

function tokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter(Boolean);
}

function countMatches(text: string, patterns: RegExp[]): number {
  let total = 0;
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) total += matches.length;
  }
  return total;
}

/** Repeated-phrasing share: the most common word bigram's share of all bigrams. */
function repetitionShare(words: string[]): number {
  if (words.length < 12) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i + 1 < words.length; i += 1) {
    const key = `${words[i]} ${words[i + 1]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let max = 0;
  counts.forEach((value) => {
    if (value > max) max = value;
  });
  // Share within a normal range is ~1-3%; ×8 puts noticeable repetition near 1.
  return clamp01((max / Math.max(1, words.length - 1)) * 8);
}

/** Concrete/technical token share — digits, acronyms, camelCase, hyphenated, dotted. */
function specificityShare(words: string[]): number {
  if (words.length === 0) return 0;
  const concrete = words.filter(
    (word) =>
      /\d/.test(word) ||
      /^[A-Z]{2,}$/.test(word) ||
      /[a-z][A-Z]/.test(word) ||
      /[-_/.]/.test(word),
  ).length;
  return clamp01(concrete / words.length);
}

function sentenceStats(text: string): { count: number; avgWords: number } {
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return { count: 0, avgWords: 0 };
  const totalWords = sentences.reduce((sum, s) => sum + tokens(s).length, 0);
  return { count: sentences.length, avgWords: totalWords / sentences.length };
}

export function computeQualitySignals(input: QualityInput, profile: QualityProfile = {}): QualitySignals {
  const text = input.text ?? "";
  const words = tokens(text);
  const wordCount = words.length;
  const charCount = text.length;
  const per100 = (count: number) => clamp01((count / Math.max(20, wordCount)) * 8);

  const boilerplateHits = countMatches(text, BOILERPLATE);
  const hedgeHits = countMatches(text, HEDGES);
  const linkHits = (text.match(LINK) ?? []).length;
  const emojiHits = (text.match(EMOJI) ?? []).length;
  const sentences = sentenceStats(text);

  const repetition = round(repetitionShare(words));
  const boilerplateDensity = round(per100(boilerplateHits));
  const hedgingDensity = round(per100(hedgeHits));
  const linkDensity = round(per100(linkHits));
  const emojiDensity = round(per100(emojiHits));
  const specificity = round(specificityShare(words));

  const maxCharacters = profile.maxCharacters;
  const overLimit = typeof maxCharacters === "number" ? charCount > maxCharacters : false;
  const lengthFit = typeof maxCharacters === "number" && maxCharacters > 0
    ? round(charCount / maxCharacters)
    : 1;

  const hookWords = tokens(input.hook ?? "").length;
  const hookPresent = profile.hookFirst ? hookWords > 0 && hookWords <= 30 : hookWords > 0;
  const ctaPresent = profile.cta ? CTA_HINT.test(input.cta || input.units.at(-1) || "") : true;

  const duplicateUnits =
    input.units.length > 1 && new Set(input.units.map((u) => u.trim().toLowerCase())).size < input.units.length;

  const flags: string[] = [];
  if (overLimit) flags.push("over_limit");
  if (profile.hookFirst && !hookPresent) flags.push("no_hook");
  if (profile.cta && !ctaPresent) flags.push("missing_cta");
  if (repetition >= 0.5 || duplicateUnits) flags.push("repetitive");
  if (boilerplateDensity >= 0.4) flags.push("boilerplate_heavy");
  if (hedgingDensity >= 0.5) flags.push("hedging_heavy");
  if (specificity < 0.05 && wordCount >= 30) flags.push("no_specifics");
  if (typeof profile.minUnits === "number" && input.units.length < profile.minUnits) {
    flags.push("too_few_units");
  }
  if (typeof profile.maxUnits === "number" && input.units.length > profile.maxUnits) {
    flags.push("too_many_units");
  }

  return {
    wordCount,
    charCount,
    unitCount: input.units.length,
    avgSentenceWords: round(sentences.avgWords / 40),
    repetition,
    boilerplateDensity,
    hedgingDensity,
    linkDensity,
    emojiDensity,
    specificity,
    lengthFit,
    overLimit,
    hookPresent,
    ctaPresent,
    flags,
  };
}

/** The numeric slice handed to the decision layer (flags stay separate). */
export function qualitySignalRecord(signals: QualitySignals): Record<string, number> {
  return {
    word_count: signals.wordCount,
    char_count: signals.charCount,
    unit_count: signals.unitCount,
    avg_sentence_words: signals.avgSentenceWords,
    repetition: signals.repetition,
    boilerplate: signals.boilerplateDensity,
    hedging: signals.hedgingDensity,
    link_density: signals.linkDensity,
    emoji_density: signals.emojiDensity,
    specificity: signals.specificity,
    length_fit: signals.lengthFit,
    over_limit: signals.overLimit ? 1 : 0,
    hook_present: signals.hookPresent ? 1 : 0,
    cta_present: signals.ctaPresent ? 1 : 0,
  };
}
