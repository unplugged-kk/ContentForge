/**
 * Expertise profile — deterministic, model-free.
 *
 * Answers "what does this creator have standing to talk about?", assembled from
 * what ContentForge already knows: the profile's niche and messaging pillars,
 * stated content goals, and the topics of content actually published. Nothing is
 * invented — an empty profile reports `insufficient` rather than guessing.
 *
 * Intelligence only: this produces evidence. Decisions about positioning,
 * audience and angle belong to the decision layer.
 */

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "you", "are", "was", "were",
  "has", "have", "had", "not", "but", "its", "it's", "how", "why", "what", "when", "who", "will",
  "can", "should", "would", "could", "about", "over", "under", "more", "most", "less", "than",
  "then", "them", "they", "their", "there", "here", "also", "just", "very", "much", "many", "some",
  "any", "all", "each", "every", "other", "another", "such", "only", "own", "same", "too", "via",
  "using", "use", "used", "make", "makes", "made", "get", "gets", "got", "one", "two", "new",
]);

export type ExpertiseConfidence = "strong" | "weak" | "insufficient";

export interface ExpertiseInput {
  niche?: string | null;
  pillars?: string[] | null;
  goals?: string | null;
  audienceDescription?: string | null;
  /** Titles of content actually published / produced — the strongest signal. */
  publishedTitles?: string[] | null;
}

export interface ExpertiseProfile {
  /** Phrases the creator has standing in: niche, pillars, recurring published topics. */
  domains: string[];
  audiences: string[];
  goals: string[];
  confidence: ExpertiseConfidence;
  /** How much real evidence the profile rests on (pillars + published titles). */
  sourceCount: number;
}

export const PROFILE_BOUNDS = {
  maxDomains: 12,
  maxAudiences: 6,
  maxGoals: 6,
  maxPhraseChars: 80,
  minTokenLength: 4,
  recurringTopicMinCount: 2,
} as const;

export function normalizePhrase(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > PROFILE_BOUNDS.maxPhraseChars
    ? trimmed.slice(0, PROFILE_BOUNDS.maxPhraseChars)
    : trimmed;
}

/** Split a free-text field on the separators people actually type. */
export function splitList(value: unknown, maxItems: number): string[] {
  if (typeof value !== "string") return [];
  const parts = value
    .split(/[,;\n]|\band\b|\bplus\b/gi)
    .map((part) => normalizePhrase(part))
    .filter((part): part is string => part !== null);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function profileTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.-]+/)
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((token) => token.length >= PROFILE_BOUNDS.minTokenLength && !STOPWORDS.has(token));
}

/** Topics the creator keeps returning to — the published-titles signal. */
function recurringTopics(titles: string[]): string[] {
  const counts = new Map<string, number>();
  for (const title of titles) {
    for (const token of Array.from(new Set(profileTokens(title)))) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= PROFILE_BOUNDS.recurringTopicMinCount)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, PROFILE_BOUNDS.maxDomains)
    .map(([token]) => token);
}

export function buildExpertiseProfile(input: ExpertiseInput = {}): ExpertiseProfile {
  const niche = normalizePhrase(input.niche);
  const pillars = (input.pillars ?? [])
    .map((pillar) => normalizePhrase(pillar))
    .filter((pillar): pillar is string => pillar !== null)
    .slice(0, PROFILE_BOUNDS.maxDomains);
  const titles = (input.publishedTitles ?? []).filter((title) => typeof title === "string");

  const domains: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [...(niche ? [niche] : []), ...pillars, ...recurringTopics(titles)]) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    domains.push(candidate);
    if (domains.length >= PROFILE_BOUNDS.maxDomains) break;
  }

  const sourceCount = pillars.length + titles.length;
  const confidence: ExpertiseConfidence =
    domains.length === 0
      ? "insufficient"
      : domains.length >= 3 && sourceCount >= 5
        ? "strong"
        : "weak";

  return {
    domains,
    audiences: splitList(input.audienceDescription, PROFILE_BOUNDS.maxAudiences),
    goals: splitList(input.goals, PROFILE_BOUNDS.maxGoals),
    confidence,
    sourceCount,
  };
}
