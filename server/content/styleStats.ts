/**
 * Deterministic style statistics (Phase 24).
 *
 * Measurable text properties are computed here, never by the model.
 * Semantic interpretation stays in StyleAnalyzerPort. Absence in a tiny
 * sample is not a strong negative conclusion.
 */

export const STYLE_ANALYSIS_VERSION = "style-analysis-v1";
export const MIN_SAMPLE_FOR_STRONG = 8;
export const MIN_SAMPLE_FOR_NEGATIVE = 5;
export const MIN_CHANNEL_OVERLAY = 2;
export const MAX_REFERENCES_PER_ANALYSIS = 40;

export type StyleConfidenceLevel = "strong" | "weak" | "insufficient";

export interface TextStatistics {
  charCount: number;
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  averageSentenceLength: number;
  averageParagraphLength: number;
  shortSentenceFrequency: number;
  longSentenceFrequency: number;
  questionMarkFrequency: number;
  exclamationFrequency: number;
  colonUsage: number;
  dashUsage: number;
  semicolonUsage: number;
  ellipsisUsage: number;
  uppercaseRatio: number;
  emojiFrequency: number;
  listUsage: number;
  lineBreakFrequency: number;
  hashtagFrequency: number;
}

export interface SampleQuality {
  referenceCount: number;
  channels: string[];
  analysisVersion: string;
  confidenceCeiling: StyleConfidenceLevel;
}

export interface NegativeStyleSignal {
  key: string;
  value: string;
  confidence: StyleConfidenceLevel;
}

export interface BoundedPhrasePatterns {
  openings: string[];
  closings: string[];
  recurring: string[];
}

const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "your", "you", "are",
  "was", "were", "have", "has", "had", "not", "but", "its", "our", "out",
  "about", "into", "just", "like", "than", "then", "them", "they", "what",
  "when", "which", "will", "would", "could", "should", "their",
]);

const EMOJI_RE = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function computeTextStatistics(text: string): TextStatistics {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const sentences = splitSentences(normalized);
  const paragraphs = splitParagraphs(normalized);
  const sentenceCount = Math.max(sentences.length, 1);
  const paragraphCount = Math.max(paragraphs.length, 1);
  const wordCount = words.length;
  const sentenceLengths = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const short = sentenceLengths.filter((n) => n > 0 && n <= 8).length;
  const long = sentenceLengths.filter((n) => n >= 25).length;
  const letters = normalized.replace(/[^A-Za-z]/g, "");
  const uppers = letters.replace(/[^A-Z]/g, "");
  const perThousand = (count: number) => (wordCount === 0 ? 0 : Number(((count / wordCount) * 1000).toFixed(2)));

  return {
    charCount: normalized.length,
    wordCount,
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
    averageSentenceLength: Number((wordCount / sentenceCount).toFixed(2)),
    averageParagraphLength: Number((wordCount / paragraphCount).toFixed(2)),
    shortSentenceFrequency: Number((short / sentenceCount).toFixed(3)),
    longSentenceFrequency: Number((long / sentenceCount).toFixed(3)),
    questionMarkFrequency: perThousand((normalized.match(/\?/g) ?? []).length),
    exclamationFrequency: perThousand((normalized.match(/!/g) ?? []).length),
    colonUsage: perThousand((normalized.match(/:/g) ?? []).length),
    dashUsage: perThousand((normalized.match(/—|--| – /g) ?? []).length),
    semicolonUsage: perThousand((normalized.match(/;/g) ?? []).length),
    ellipsisUsage: perThousand((normalized.match(/\.{3}|…/g) ?? []).length),
    uppercaseRatio: letters.length === 0 ? 0 : Number((uppers.length / letters.length).toFixed(3)),
    emojiFrequency: perThousand((normalized.match(EMOJI_RE) ?? []).length),
    listUsage: perThousand((normalized.match(/^\s*(?:[-*]|\d+\.)\s+/gm) ?? []).length),
    lineBreakFrequency: perThousand((normalized.match(/\n/g) ?? []).length),
    hashtagFrequency: perThousand((normalized.match(/#[A-Za-z0-9_]+/g) ?? []).length),
  };
}

export function aggregateTextStatistics(samples: TextStatistics[]): TextStatistics {
  if (samples.length === 0) {
    return computeTextStatistics("");
  }
  if (samples.length === 1) return samples[0];
  const sum = samples.reduce(
    (acc, s) => {
      for (const key of Object.keys(s) as (keyof TextStatistics)[]) {
        acc[key] = (acc[key] ?? 0) + s[key];
      }
      return acc;
    },
    {} as Record<keyof TextStatistics, number>,
  );
  const n = samples.length;
  const averaged = {} as TextStatistics;
  for (const key of Object.keys(sum) as (keyof TextStatistics)[]) {
    averaged[key] = Number((sum[key] / n).toFixed(key === "charCount" || key === "wordCount" || key === "sentenceCount" || key === "paragraphCount" ? 0 : 3));
  }
  return averaged;
}

export function confidenceCeiling(sampleCount: number): StyleConfidenceLevel {
  if (sampleCount <= 0) return "insufficient";
  if (sampleCount < MIN_SAMPLE_FOR_STRONG) return "weak";
  return "strong";
}

export function capConfidence(observed: StyleConfidenceLevel, sampleCount: number): StyleConfidenceLevel {
  if (observed === "insufficient") return "insufficient";
  // A single reference keeps the analyzer's own call; corpus samples are capped.
  if (sampleCount <= 1) return observed;
  const ceiling = confidenceCeiling(sampleCount);
  const rank = { insufficient: 0, weak: 1, strong: 2 };
  return rank[observed] <= rank[ceiling] ? observed : ceiling;
}

export function sampleQuality(input: { referenceCount: number; channels: string[] }): SampleQuality {
  const channels = Array.from(new Set(input.channels)).sort();
  return {
    referenceCount: input.referenceCount,
    channels,
    analysisVersion: STYLE_ANALYSIS_VERSION,
    confidenceCeiling: confidenceCeiling(input.referenceCount),
  };
}

export function deriveNegativeSignals(stats: TextStatistics, sampleCount: number): NegativeStyleSignal[] {
  if (sampleCount < MIN_SAMPLE_FOR_NEGATIVE) return [];
  const signals: NegativeStyleSignal[] = [];
  const weakOrStrong: StyleConfidenceLevel = sampleCount >= MIN_SAMPLE_FOR_STRONG ? "strong" : "weak";
  if (stats.emojiFrequency === 0) {
    signals.push({ key: "rarely_uses_emojis", value: "no emojis observed in the sample", confidence: weakOrStrong });
  }
  if (stats.hashtagFrequency === 0) {
    signals.push({ key: "rarely_uses_hashtags", value: "no hashtags observed in the sample", confidence: weakOrStrong });
  }
  if (stats.questionMarkFrequency === 0) {
    signals.push({ key: "avoids_rhetorical_questions", value: "no question marks observed in the sample", confidence: "weak" });
  }
  if (stats.longSentenceFrequency === 0 && stats.averageParagraphLength <= 40) {
    signals.push({ key: "avoids_long_paragraphs", value: "long paragraphs were not observed", confidence: "weak" });
  }
  return signals.slice(0, 6);
}

function firstSentence(text: string): string {
  return splitSentences(text)[0]?.slice(0, 120) ?? "";
}

function lastSentence(text: string): string {
  const sentences = splitSentences(text);
  return sentences[sentences.length - 1]?.slice(0, 120) ?? "";
}

function ngrams(text: string, n: number): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const out: string[] = [];
  for (let i = 0; i <= words.length - n; i += 1) {
    out.push(words.slice(i, i + n).join(" "));
  }
  return out;
}

export function extractBoundedPhrases(texts: string[]): BoundedPhrasePatterns {
  const openings = texts.map(firstSentence).filter(Boolean);
  const closings = texts.map(lastSentence).filter(Boolean);
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const gram of Array.from(new Set(ngrams(text, 2).concat(ngrams(text, 3))))) {
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  }
  const recurring = Array.from(counts.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 6)
    .map(([phrase]) => phrase);

  const uniqueOpenings = Array.from(new Set(openings)).slice(0, 6);
  const uniqueClosings = Array.from(new Set(closings)).slice(0, 6);
  return { openings: uniqueOpenings, closings: uniqueClosings, recurring };
}

export function channelFromSourceType(sourceType: string | null | undefined, sourcePlatform?: string | null): string {
  if (sourcePlatform && sourcePlatform.trim()) return sourcePlatform.trim().toLowerCase();
  switch (sourceType) {
    case "x_post":
    case "x_thread":
      return "x";
    case "linkedin_post":
      return "linkedin";
    case "instagram_caption":
      return "instagram";
    default:
      return "other";
  }
}

export function renderStatisticsSnippet(stats: TextStatistics, quality: SampleQuality): string {
  return [
    `Sample: ${quality.referenceCount} refs (${quality.channels.join(", ") || "unspecified"}; ceiling ${quality.confidenceCeiling})`,
    `Avg sentence ${stats.averageSentenceLength} words`,
    `Short-sentence rate ${stats.shortSentenceFrequency}`,
    `Questions/1k ${stats.questionMarkFrequency}`,
    `Emoji/1k ${stats.emojiFrequency}`,
    `Hashtags/1k ${stats.hashtagFrequency}`,
  ].join("; ");
}
