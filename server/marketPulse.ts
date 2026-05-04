/**
 * Market Pulse — runs before morning briefing ranking.
 *
 * Answers: "What is the tech/AI/DevOps world talking about RIGHT NOW?"
 * Result is injected into the idea-ranking AI call so breaking-news topics
 * get a boost and stale evergreen content is deprioritised on hot-news days.
 *
 * X Algorithm Intelligence (baked into prompts):
 *   - Replies/bookmarks in first 30 min signal virality → controversial hooks win
 *   - Threads with 4-7 tweets get more impressions than single tweets
 *   - Specific numbers + tool names → bookmarks (engineers save for later)
 *   - Ending with a question → reply rate × 2–3
 *   - Hot takes on TRENDING tools (whatever is in the news today) = max impressions
 *   - Posting during trending events (Nvidia launch, AWS outage, K8s release) → 5-10× reach
 */

import Parser from "rss-parser";

const rssParser = new Parser();

export type MarketPulseResult = {
  breakingTopics: string[];      // top HN stories right now
  trendingKeywords: string[];    // extracted keywords from today's front pages
  boostTopics: string[];         // topics that deserve extra score boost today
  xAlgorithmContext: string;     // prompt snippet injected into ranking AI call
  fetchedAt: Date;
};

/** Fetch HN front page (unfiltered top 15) to catch breaking news */
async function fetchHnFrontPage(): Promise<string[]> {
  try {
    const r = await fetch(
      "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=15",
      { signal: AbortSignal.timeout(6000) },
    );
    const d = (await r.json()) as any;
    return (d.hits || []).map((h: any) => h.title as string).filter(Boolean);
  } catch {
    return [];
  }
}

/** Fetch Google Trends daily RSS for trending topics */
async function fetchGoogleTrends(): Promise<string[]> {
  try {
    const parsed = await rssParser.parseURL(
      "https://trends.google.com/trending/rss?geo=US&hl=en-US",
    );
    return (parsed.items || []).slice(0, 15).map((i) => i.title || "").filter(Boolean);
  } catch {
    return [];
  }
}

/** Niche keywords that indicate a topic is relevant to Kishore's audience */
const NICHE_TECH_TERMS = [
  "nvidia", "gpu", "cuda", "ai model", "llm", "gpt", "claude", "gemini",
  "kubernetes", "k8s", "docker", "terraform", "aws", "gcp", "azure",
  "openai", "anthropic", "mistral", "llama", "deepseek",
  "devops", "platform engineering", "sre", "incident", "outage",
  "mlops", "rag", "agent", "agentic", "langchain", "vector",
  "security", "breach", "vulnerability", "zero-day",
  "open source", "cncf", "backstage", "argocd", "helm",
];

function extractNicheTopics(titles: string[]): string[] {
  const relevant: string[] = [];
  for (const title of titles) {
    const lower = title.toLowerCase();
    if (NICHE_TECH_TERMS.some((kw) => lower.includes(kw))) {
      relevant.push(title);
    }
  }
  return relevant;
}

function extractKeywords(titles: string[]): string[] {
  const freq: Record<string, number> = {};
  for (const title of titles) {
    const words = title.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
    for (const w of words) {
      freq[w] = (freq[w] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .filter(([, count]) => count >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([word]) => word);
}

/** Build the X algorithm context string injected into every ranking prompt */
function buildXAlgorithmContext(breaking: string[], trending: string[]): string {
  const breakingBlock = breaking.length
    ? `TODAY'S BREAKING TECH NEWS (prioritise ideas connected to these):\n${breaking.slice(0, 8).map((t, i) => `  ${i + 1}. ${t}`).join("\n")}`
    : "";

  const trendingBlock = trending.length
    ? `TRENDING SEARCH TERMS NOW: ${trending.slice(0, 10).join(", ")}`
    : "";

  return `
=== X ALGORITHM INTELLIGENCE (apply to every ranking decision) ===

HOW X REWARDS CONTENT IN DEVOPS/AI NICHE:
• Hook in first 2 lines = 80% of whether someone reads further. Specific claim > generic.
• Threads (4-7 tweets) get 2.5× impressions vs single tweets in tech niche.
• Numbers and tool names → engineers bookmark → bookmark rate is a top ranking signal.
• Ending with a question doubles reply count → replies = strong virality signal.
• Posting about a TRENDING event within 2-4 hours = 5-10× organic reach boost.
• Contrarian takes on popular tools (when backed by data) get shared by disagreers AND agreers.
• Technical hot takes on AI tools get 3× more engagement than generic "here are X tips" posts.
• Threads about REAL incidents/outages/failures outperform success stories 2:1.
• "We saved $X / reduced P95 by X%" = bookmark bait. Numbers stop the scroll.
• WORST performers: generic advice, no tool names, no numbers, no story.

BOOST MULTIPLIER: If an idea connects to today's breaking news → score × 1.5
PENALTY: If an idea is evergreen but today has a major breaking story → score × 0.8

${breakingBlock}
${trendingBlock}
=== END X ALGORITHM INTELLIGENCE ===
`.trim();
}

/** Main export — call this before morning briefing ranking */
export async function getMarketPulse(): Promise<MarketPulseResult> {
  const [hnTitles, trendTitles] = await Promise.all([
    fetchHnFrontPage(),
    fetchGoogleTrends(),
  ]);

  const allTitles = [...hnTitles, ...trendTitles];
  const breakingTopics = extractNicheTopics(allTitles);
  const trendingKeywords = extractKeywords(allTitles);

  // Topics that should get a score boost today
  const boostTopics = breakingTopics.slice(0, 5);

  return {
    breakingTopics,
    trendingKeywords,
    boostTopics,
    xAlgorithmContext: buildXAlgorithmContext(breakingTopics, trendingKeywords),
    fetchedAt: new Date(),
  };
}

/** Apply breaking-news boost to viral score before pillar-weighted ranking */
export function applyBreakingNewsBoost(
  viralScore: number,
  ideaText: string,
  boostTopics: string[],
): number {
  if (!boostTopics.length) return viralScore;
  const lower = ideaText.toLowerCase();
  const isBreaking = boostTopics.some((topic) =>
    topic.toLowerCase().split(/\W+/).filter((w) => w.length > 4).some((w) => lower.includes(w)),
  );
  return isBreaking ? viralScore * 1.5 : viralScore;
}
