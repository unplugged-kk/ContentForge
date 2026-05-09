/**
 * Autopilot engine — discover → rank → template-match → draft → schedule → auto-publish.
 * Fully hands-off: generates content daily, schedules to IST slots, auto-posts at time.
 *
 * Posting slots (IST — India Standard Time, UTC+5:30):
 *   13:00 IST (07:30 UTC) — EU morning commute  → thread/educational
 *   19:30 IST (14:00 UTC) — India evening       → tweet/hot_take
 *   23:00 IST (17:30 UTC) — US lunch scroll     → long_thread
 *
 * Weekends same cadence (3 posts/day), with deeper threads:
 *   Saturday 13:00 IST — deep-dive thread (8-12 tweets)
 *   Sunday   19:30 IST — weekly recap thread (10-15 tweets)
 *
 * Niche filter: only DevOps · AI · Kubernetes · Platform Engineering · SRE · MLOps · FinOps · Security
 */
import { storage } from "./storage";
import { aiCall, logAiUsage, safeJsonParse } from "./ai/chat";
import { runDiscoverRefresh } from "./discoverRefresh";
import { getMarketPulse, applyBreakingNewsBoost, type MarketPulseResult } from "./marketPulse";
import { addThreadNumbering } from "./utils/threadUtils";
import { getBrandSystemPrompt } from "./brandSystemPrompt";
import type { DiscoveredIdea, Template } from "@shared/schema";

// ─── IST Timezone helpers ─────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toIST(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

function fromIST(date: Date): Date {
  return new Date(date.getTime() - IST_OFFSET_MS);
}

function nowIST(): Date {
  return toIST(new Date());
}

// ─── Posting schedule (IST) ───────────────────────────────────────────────────

const DAILY_SLOTS = [
  { hour: 13, minute: 0,  preferredType: "thread",      tone: "educational",  label: "EU morning" },
  { hour: 19, minute: 30, preferredType: "tweet",       tone: "provocative",  label: "India evening" },
  { hour: 23, minute: 0,  preferredType: "long_thread", tone: "storytelling", label: "US lunch" },
] as const;

type PostingSlot = { hour: number; minute: number; preferredType: string; tone: string; label: string };

// ─── Niche relevance filter ───────────────────────────────────────────────────

const NICHE_KEYWORDS = [
  "kubernetes", "k8s", "devops", "sre", "platform engineering", "mlops", "aiops",
  "ai agent", "llm", "large language model", "rag", "machine learning", "ml ",
  "data pipeline", "feature store", "data mesh", "lakehouse", "kafka", "spark",
  "terraform", "crossplane", "pulumi", "gitops", "argocd", "flux",
  "observability", "incident", "on-call", "slo", "error budget",
  "cloud cost", "finops", "rightsizing", "spot instance",
  "container", "docker", "helm", "operator", "crd", "cncf",
  "aws", "gcp", "azure", "cloud native", "microservice",
  "security", "devsecops", "supply chain", "sbom", "slsa",
  "infrastructure", "infra", "engineer", "platform team",
  "backstage", "internal developer", "golden path",
  "ai infrastructure", "gpu", "model serving", "vector database",
  "langchain", "openai", "anthropic", "mcp", "agentic",
  "vulnerability", "exploit", "zero-day", "cve", "patch", "breach", "ransomware",
  "incident", "outage", "downtime", "mttr", "postmortem", "runbook", "on-call",
  "chaos engineering", "reliability", "resilience", "slo", "sla", "error budget",
  "llmops", "model deployment", "model serving", "inference", "fine-tuning",
  "nvidia", "gpu", "tpu", "accelerator", "cuda", "triton",
  "opentelemetry", "otel", "tracing", "metrics", "logs", "grafana", "prometheus",
];

function isNicheRelevant(idea: DiscoveredIdea): boolean {
  const text = `${idea.title} ${idea.description || ""} ${idea.category || ""}`.toLowerCase();
  return NICHE_KEYWORDS.some((kw) => text.includes(kw));
}

// ─── Smart Content Type Intelligence ──────────────────────────────────────────

interface SourceMeta {
  commentCount?: number;
  points?: number;
  sourceType?: string;
  wordCount?: number;
  contentAngles?: string[];
}

export function determineContentType(idea: DiscoveredIdea, meta?: SourceMeta): string {
  const suggestion = idea.contentTypeSuggestion || "";
  const angles = idea.contentAngles?.length || 0;
  const comments = meta?.commentCount || 0;
  const points = meta?.points || 0;
  const timeliness = idea.timeliness || "evergreen";

  // High-signal overrides
  if (suggestion === "article") return "article";
  if (suggestion === "hot_take" || timeliness === "trending_now") return "hot_take";
  if (suggestion === "article_thread" || (comments > 200 && angles >= 4)) return "long_thread";
  if (suggestion === "long_thread" || comments > 100 || angles >= 3) return "long_thread";
  if (suggestion === "tweet" || (points > 500 && comments < 20)) return "tweet";

  // Default: thread for most content
  return "thread";
}

export function getTweetCountForType(postType: string): number {
  switch (postType) {
    case "tweet": return 1;
    case "hot_take": return 1;
    case "thread": return 4 + Math.floor(Math.random() * 3); // 4-6
    case "long_thread": return 8 + Math.floor(Math.random() * 4); // 8-11
    case "article_thread": return 12 + Math.floor(Math.random() * 4); // 12-15
    case "weekly_recap": return 10 + Math.floor(Math.random() * 4); // 10-13
    default: return 5;
  }
}

// ─── Pillar weights ───────────────────────────────────────────────────────────

export const PILLAR_WEIGHTS: Record<string, number> = {
  "AI Agents & Agentic Workflows":          1.40,
  "AIOps & AI-Assisted DevOps":             1.35,
  "Hot Takes & Trends":                     1.20,
  "Data Infrastructure & MLOps":            1.20,
  "Kubernetes Deep Dives":                  1.15,
  "Platform Engineering & DevEx":           1.10,
  "SRE & Reliability Engineering":          1.05,
  "Cloud-Native Data Platforms":            1.00,
  "Infrastructure as Code":                 0.95,
  "Security & DevSecOps":                   0.90,
  "FinOps & Cloud Cost Engineering":        0.90,
  "Open Source & CNCF Ecosystem":           0.85,
  "Technical Leadership & Eng Management":  0.80,
  "Career & Leadership":                    0.75,
  "AI for DevOps / AIOps":                  1.35,
  "Infrastructure as Code for Data":        0.95,
};

// ─── Template matching ────────────────────────────────────────────────────────

export function matchTemplate(idea: DiscoveredIdea, templates: Template[]): Template | null {
  if (!templates.length) return null;

  const text = `${idea.title} ${idea.description || ""}`.toLowerCase();
  const ideaType = idea.contentTypeSuggestion || "thread";

  const scored = templates.map((t) => {
    let score = 0;
    if (t.pillarId && t.pillarId === idea.pillarId) score += 10;
    if (t.postType === ideaType) score += 5;
    if (ideaType === "hot_take" && t.postType === "tweet") score += 3;
    if (ideaType === "long_thread" && t.postType === "thread") score += 3;

    const patternWords = t.pattern.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    for (const w of patternWords) {
      if (text.includes(w)) score += 2;
    }

    if (idea.timeliness === "trending_now" && t.pattern.toLowerCase().includes("hot take")) score += 3;
    if (idea.timeliness === "evergreen" && t.pattern.toLowerCase().includes("lesson")) score += 2;

    return { template: t, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].score > 0 ? scored[0].template : null;
}

// ─── Engagement score ──────────────────────────────────────────────────────────

export function computeEngagementScore(idea: DiscoveredIdea, pillarName: string): {
  score: number;
  breakdown: Record<string, number>;
} {
  const viral = parseFloat(String(idea.viralScore || "5"));
  const pillarWeight = PILLAR_WEIGHTS[pillarName] ?? 1.0;

  const timelinessBonus =
    idea.timeliness === "trending_now" ? 0.8 :
    idea.timeliness === "this_week"    ? 0.4 : 0;

  const typeBonus =
    idea.contentTypeSuggestion === "thread"      ? 0.3 :
    idea.contentTypeSuggestion === "long_thread" ? 0.5 :
    idea.contentTypeSuggestion === "hot_take"    ? 0.6 : 0;

  const nicheBonus = isNicheRelevant(idea) ? 0.5 : -2.0;

  const score = parseFloat(((viral * pillarWeight) + timelinessBonus + typeBonus + nicheBonus).toFixed(2));

  return {
    score,
    breakdown: {
      viral_score: viral,
      pillar_weight: pillarWeight,
      timeliness_bonus: timelinessBonus,
      content_type_bonus: typeBonus,
      niche_bonus: nicheBonus,
    },
  };
}

// ─── Voice and prompt ─────────────────────────────────────────────────────────

const KISHORE_VOICE = `You are ghostwriting for a senior Infrastructure Engineering Lead with 11+ years in production systems.
Credentials: Saved $500K via cloud cost optimisation. Ran multi-region K8s platforms. Built ML feature stores and AIOps observability pipelines.

NICHE: DevOps · AI/MLOps · Kubernetes · Platform Engineering · SRE · FinOps · IaC. Do NOT write about anything outside this niche.

Voice rules — apply every single one:
1. Hook: first line must stop the scroll with a specific number, bold claim, or story moment. No generic intros.
2. Specific > Generic: real tool names, real metrics, real scenarios. Never say "many teams" — say "production teams running this at scale".
3. Contrarian: challenge the mainstream view WITH evidence.
4. Conversational: how an engineer talks in Slack, NOT how documentation reads. Use contractions (don't, can't, it's). Start sentences with "And" or "But" sometimes.
5. Short sentences for tweets (max 275 chars). Threads: hook tweet + numbered insights (1/, 2/, ...).
6. End every piece with a question or bold prediction that invites debate.
7. No hashtags in post body — add them to hashtag_suggestions only.
8. AI+DevOps intersection angle always gets higher engagement — look for that angle first.
9. Production war stories: reference "what I've seen in production", "here's what actually happens when you ship this at scale", "debugged this exact issue in multi-region clusters".
10. NEVER mention specific company names. Use general references like "enterprise platforms", "multi-region setups", "production workloads".
11. Vary sentence structure: mix short punchy sentences with longer explanatory ones. Use fragments. Use dashes and ellipses for emphasis.
12. Imperfect grammar is OK: "Anyway...", "Here's the thing:", "So yeah..."`;

// ─── Core: generate draft from idea ──────────────────────────────────────────

export type AutopilotDraft = {
  postType: string;
  tone: string;
  tweets: { content: string; position: number; charCount: number }[];
  pillarId: number | null;
  pillarName: string;
  ideaTitle: string;
  templateUsed: string | null;
  hashtagSuggestions: string[];
  engagementScore: number;
  scheduledAt: Date;
  autopilot: true;
  imageUrl?: string | null;
};

export type AutopilotArticleDraft = {
  title: string;
  subtitle: string | null;
  contentMarkdown: string;
  coverImageUrl: string | null;
  seoDescription: string | null;
  articleTemplate: string | null;
  pillarId: number | null;
  ideaTitle: string;
};

function estimateReadMinutes(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 200));
}

export async function generateDraftFromIdea(
  idea: DiscoveredIdea,
  postType: string,
  tone: string,
  pillarId: number | null,
): Promise<AutopilotDraft | null> {
  const [pillars, templates] = await Promise.all([storage.getPillars(), storage.getTemplates()]);
  const pillar = pillars.find((p) => p.id === pillarId);
  const pillarName = pillar?.name || idea.category || "DevOps";

  const matchedTemplate = matchTemplate(idea, templates);
  const { score: engagementScore } = computeEngagementScore(idea, pillarName);

  const templateGuidance = matchedTemplate
    ? `\nUse this template pattern as the structural backbone (adapt, don't copy verbatim):\n"${matchedTemplate.pattern}"`
    : "";

  const tweetCount = getTweetCountForType(postType);

  const formatPrompt =
    postType === "tweet" || postType === "hot_take"
      ? `Write one high-engagement tweet (max 275 chars). Hook in first line. Make it feel like a real engineer wrote it — conversational, specific, maybe slightly imperfect grammar.\nReturn JSON: {"tweets": [{"content": "...", "position": 0}], "hashtag_suggestions": ["tag1", "tag2"]}`
      : postType === "long_thread"
      ? `Write a ${tweetCount}-tweet thread. Tweet 1 = hook (≤275 chars). Tweets 2-${tweetCount - 1} = numbered insights (1/, 2/, ...) with real tool names and metrics. Each tweet ≤275 chars. Last tweet = bold question or prediction.\nReturn JSON: {"tweets": [{"content": "...", "position": 0}, ...], "hashtag_suggestions": ["tag1", "tag2", "tag3"]}`
      : postType === "article_thread"
      ? `Write a ${tweetCount}-tweet deep-dive article thread. Tweet 1 = scroll-stopping hook with a big claim or number. Tweets 2-${tweetCount - 2} = structured sections: context → problem → analysis → data/examples → lessons → implications. Each tweet ≤275 chars, numbered (1/, 2/, ...). Last tweet = bold prediction + question.\nReturn JSON: {"tweets": [{"content": "...", "position": 0}, ...], "hashtag_suggestions": ["tag1", "tag2", "tag3"]}`
      : postType === "weekly_recap"
      ? `Write a ${tweetCount}-tweet "This week in DevOps/AI" weekly recap thread. Tweet 1 = teaser hook listing 3 big things. Tweets 2-${tweetCount - 1} = one insight per tweet, covering: biggest news, tool releases, incidents/outages, trend shifts, a hot take. Each tweet ≤275 chars, numbered (1/, 2/, ...). Last tweet = question for the community.\nReturn JSON: {"tweets": [{"content": "...", "position": 0}, ...], "hashtag_suggestions": ["tag1", "tag2", "tag3"]}`
      : `Write a ${tweetCount}-tweet thread. Tweet 1 = hook (≤275 chars). Each subsequent tweet ≤275 chars, numbered (1/, 2/, ...). Last tweet = CTA or bold question.\nReturn JSON: {"tweets": [{"content": "...", "position": 0}, ...], "hashtag_suggestions": ["tag1", "tag2", "tag3"]}`;

  try {
    let pulseContext = "";
    try {
      const pulse = await getMarketPulse();
      if (pulse.breakingTopics.length) {
        pulseContext = `\nTODAY'S BREAKING CONTEXT: ${pulse.breakingTopics.slice(0, 4).join(" | ")}\nIf this topic connects to any of the above, reference it for maximum timeliness boost.`;
      }
    } catch { /* non-critical */ }

    const brand = await getBrandSystemPrompt(1, "x");
    const { content, usage, latency } = await aiCall(
      [
        { role: "system", content: `${brand}\n\n--- Autopilot drafting voice (always apply) ---\n${KISHORE_VOICE}` },
        {
          role: "user",
          content: `Topic: ${idea.title}
Description: ${idea.description || ""}
Pillar: ${pillarName}
Tone: ${tone}
Engagement score: ${engagementScore} (higher = more likely to go viral)
Suggested hook: ${idea.suggestedHook || "none"}
Content angles: ${(idea.contentAngles || []).join(" | ")}
${templateGuidance}
${pulseContext}

${formatPrompt}`,
        },
      ],
      true,
    );

    await logAiUsage(usage, latency, "autopilot_draft");
    const parsed = safeJsonParse(content);
    if (!parsed?.tweets?.length) return null;

    const rawContents = parsed.tweets.map((t: any) => String(t.content || "").slice(0, 280));
    const numberedContents = addThreadNumbering(rawContents);
    const tweets = numberedContents.map((content, i) => ({
      content,
      position: i,
      charCount: content.length,
    }));

    // Generate cover image for threads
    let imageUrl: string | null = null;
    if (postType !== "tweet" && postType !== "hot_take") {
      try {
        const imageResult = await generateCoverImage(idea.title, pillarName);
        imageUrl = imageResult;
      } catch {
        // non-critical
      }
    }

    return {
      postType,
      tone,
      tweets,
      pillarId,
      pillarName,
      ideaTitle: idea.title,
      templateUsed: matchedTemplate?.name || null,
      hashtagSuggestions: parsed.hashtag_suggestions || [],
      engagementScore,
      scheduledAt: new Date(),
      autopilot: true,
      imageUrl,
    };
  } catch (e) {
    console.error("[autopilot] generateDraftFromIdea failed:", e);
    return null;
  }
}

export async function generateArticleDraftFromIdea(
  idea: DiscoveredIdea,
  pillarId: number | null,
): Promise<AutopilotArticleDraft | null> {
  const pillars = await storage.getPillars();
  const pillar = pillars.find((p) => p.id === pillarId);
  const pillarName = pillar?.name || idea.category || "DevOps";
  const brand = await getBrandSystemPrompt(1, "x");

  try {
    const { content, usage, latency } = await aiCall(
      [
        { role: "system", content: `${brand}\n\n${KISHORE_VOICE}` },
        {
          role: "user",
          content: `Write a high-impact X Article from this source idea.

Topic: ${idea.title}
Description: ${idea.description || ""}
Pillar: ${pillarName}
Suggested hook: ${idea.suggestedHook || "none"}
Source URL: ${idea.sourceUrl || "N/A"}

Writing rules:
- Make this read like a human engineer wrote it, not a bot.
- Start with a strong title + opening hook.
- Use scannable sections with markdown headings.
- Use specific examples, tradeoffs, and practical advice.
- End with exactly one clear CTA.
- Keep length around 900-1500 words.

Return JSON only:
{
  "title": "string <= 200 chars",
  "subtitle": "string <= 300 chars",
  "content_markdown": "full markdown article",
  "seo_description": "string <= 200 chars",
  "article_template": "opinion|deep_dive|playbook|case_study|trend_analysis"
}`,
        },
      ],
      true,
    );
    await logAiUsage(usage, latency, "autopilot_article_draft");

    const parsed = safeJsonParse(content);
    const contentMarkdown = String(parsed?.content_markdown || "").trim();
    const title = String(parsed?.title || idea.title).trim().slice(0, 200);
    if (!contentMarkdown || !title) return null;

    let coverImageUrl: string | null = null;
    try {
      coverImageUrl = await generateCoverImage(title, pillarName);
    } catch {
      // non-critical
    }

    return {
      title,
      subtitle: parsed?.subtitle ? String(parsed.subtitle).slice(0, 300) : null,
      contentMarkdown,
      coverImageUrl,
      seoDescription: parsed?.seo_description ? String(parsed.seo_description).slice(0, 200) : null,
      articleTemplate: parsed?.article_template ? String(parsed.article_template).slice(0, 50) : null,
      pillarId,
      ideaTitle: idea.title,
    };
  } catch (e) {
    console.error("[autopilot] generateArticleDraftFromIdea failed:", e);
    return null;
  }
}

// ─── Image generation ──────────────────────────────────────────────────────────

async function generateCoverImage(title: string, category: string): Promise<string | null> {
  try {
    const { ai } = await import("./ai/config");
    const response = await ai.images.generate({
      model: "gpt-image-1",
      prompt: `Create a professional tech social media header image for a post about: "${title}". Category: ${category}. Style: modern, clean, engineering-focused. Include subtle tech icons or abstract infrastructure patterns. No text in the image. Color palette: deep blues and electric accents.`,
      size: "1024x1024",
      quality: "medium",
    });
    return response.data?.[0]?.url || null;
  } catch (e) {
    console.error("[autopilot] image generation failed:", e);
    return null;
  }
}

// ─── Idea ranking ─────────────────────────────────────────────────────────────

function rankIdeas(
  ideas: DiscoveredIdea[],
  pillars: { id: number; name: string }[],
  pulse?: MarketPulseResult,
): DiscoveredIdea[] {
  return ideas
    .filter(isNicheRelevant)
    .filter((i) => parseFloat(String(i.viralScore || "0")) >= 5.5)
    .map((i) => {
      const pillarName = pillars.find((p) => p.id === i.pillarId)?.name || "";
      const { score: baseScore } = computeEngagementScore(i, pillarName);
      const ideaText = `${i.title} ${i.description || ""}`;
      const boostedScore = pulse
        ? applyBreakingNewsBoost(baseScore, ideaText, pulse.boostTopics)
        : baseScore;
      return { idea: i, score: boostedScore };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ idea }) => idea);
}

// ─── Slot calculation (IST) ───────────────────────────────────────────────────

function getSlotsForDay(date: Date): PostingSlot[] {
  return [...DAILY_SLOTS];
}

function nextSlots(fromDate: Date, count: number): Date[] {
  const slots: Date[] = [];
  const istNow = toIST(fromDate);

  for (let day = 0; slots.length < count; day++) {
    const base = new Date(istNow);
    base.setDate(base.getDate() + day);
    for (const slot of getSlotsForDay(base)) {
      if (slots.length >= count) break;
      const t = new Date(base);
      t.setHours(slot.hour, slot.minute, 0, 0);
      const utcTime = fromIST(t);
      if (utcTime > fromDate) slots.push(utcTime);
    }
  }
  return slots;
}

// ─── Autofill calendar ────────────────────────────────────────────────────────

export type AutofillResult = {
  draftsCreated: number;
  slots: Date[];
  errors: string[];
};

/**
 * Fill the next `days` days of the calendar with autopilot posts.
 * Only fills empty time slots — manual posts are never touched.
 */
export async function autofillCalendar(days = 1): Promise<AutofillResult> {
  const now = new Date();
  const slots = nextSlots(now, days * DAILY_SLOTS.length);

  const existingPosts = await storage.getPosts();
  const scheduledTimes = new Set(
    existingPosts
      .filter((p) => p.status === "scheduled" && p.scheduledAt)
      .map((p) => {
        const d = new Date(p.scheduledAt as Date);
        d.setUTCSeconds(0, 0);
        return d.toISOString();
      }),
  );

  const freeSlots = slots.filter((s) => {
    const key = new Date(s);
    key.setUTCSeconds(0, 0);
    return !scheduledTimes.has(key.toISOString());
  });

  if (freeSlots.length === 0) return { draftsCreated: 0, slots: [], errors: [] };

  const ideas = await storage.getDiscoveredIdeas();
  const pillars = await storage.getPillars();
  const ranked = rankIdeas(ideas.filter((i) => i.status !== "used"), pillars);

  if (ranked.length === 0) {
    try {
      await runDiscoverRefresh();
      return autofillCalendar(days);
    } catch {
      return { draftsCreated: 0, slots: freeSlots, errors: ["No niche-relevant ideas available"] };
    }
  }

  const draftsCreated: number[] = [];
  const errors: string[] = [];

  for (let i = 0; i < freeSlots.length && i < ranked.length; i++) {
    const slot = freeSlots[i];
    const idea = ranked[i % ranked.length];
    const slotDef = DAILY_SLOTS[i % DAILY_SLOTS.length];

    const postType = determineContentType(idea, {
      sourceType: idea.sourceType || "rss",
      contentAngles: idea.contentAngles || [],
    });

    try {
      if (postType === "article") {
        const articleDraft = await generateArticleDraftFromIdea(idea, idea.pillarId ?? null);
        if (!articleDraft) {
          errors.push(`Article draft failed: ${idea.title.substring(0, 60)}`);
          continue;
        }
        const wordCount = articleDraft.contentMarkdown.split(/\s+/).filter(Boolean).length;
        await storage.createArticle({
          title: articleDraft.title,
          subtitle: articleDraft.subtitle,
          coverImageUrl: articleDraft.coverImageUrl,
          contentMarkdown: articleDraft.contentMarkdown,
          seoDescription: articleDraft.seoDescription,
          articleTemplate: articleDraft.articleTemplate,
          status: "draft",
          pillarId: articleDraft.pillarId,
          wordCount,
          estimatedReadMinutes: estimateReadMinutes(wordCount),
        } as any);
      } else {
        const draft = await generateDraftFromIdea(idea, postType, slotDef.tone, idea.pillarId ?? null);
        if (!draft) {
          errors.push(`Draft gen failed: ${idea.title.substring(0, 60)}`);
          continue;
        }
        draft.scheduledAt = slot;
        await storage.createPost(
          {
            pillarId: draft.pillarId,
            postType: draft.postType,
            tone: draft.tone,
            targetPlatform: "x",
            status: "scheduled",
            scheduledAt: draft.scheduledAt,
            autopilot: true,
            imageUrl: draft.imageUrl,
          } as any,
          draft.tweets as any,
        );
      }
      await storage.updateDiscoveredIdeaStatus(idea.id, "used");
      draftsCreated.push(idea.id);
    } catch (e: any) {
      errors.push(e?.message || String(e));
    }
  }

  return { draftsCreated: draftsCreated.length, slots: freeSlots.slice(0, draftsCreated.length), errors };
}

// ─── Daily Auto-Post (replaces morning briefing) ────────────────────────────────

export type DailyAutoPostResult = {
  discoverBatchId: string;
  newIdeas: number;
  postsScheduled: number;
  topIdeas: {
    title: string;
    viralScore: string;
    engagementScore: number;
    pillar: string;
    templateUsed: string | null;
    hook: string;
    breakdown: Record<string, number>;
  }[];
  marketPulse: {
    breakingTopics: string[];
    trendingKeywords: string[];
    boostTopics: string[];
  };
  errors: string[];
};

/**
 * Runs every day at 05:30 IST (00:00 UTC).
 * 1. Discovers from all sources
 * 2. Niche-filters to DevOps/AI/K8s only
 * 3. Ranks by engagement score
 * 4. Generates drafts for today's 3 slots
 * 5. Schedules them with status="scheduled" for auto-publishing
 */
export async function runDailyAutoPost(): Promise<DailyAutoPostResult> {
  const errors: string[] = [];

  // Run discover refresh and market pulse in parallel
  const [refreshResult, pulse] = await Promise.all([
    runDiscoverRefresh(),
    getMarketPulse(),
  ]);

  const [pillars, templates] = await Promise.all([storage.getPillars(), storage.getTemplates()]);
  const allIdeas = await storage.getDiscoveredIdeas(refreshResult.batchId);
  const ranked = rankIdeas(allIdeas, pillars, pulse);

  const topIdeas: DailyAutoPostResult["topIdeas"] = [];
  let postsScheduled = 0;

  // Get today's slots
  const now = new Date();
  const todaySlots = nextSlots(now, 3);

  for (let i = 0; i < Math.min(todaySlots.length, 3); i++) {
    const idea = ranked[i];
    if (!idea) break;

    const pillar = pillars.find((p) => p.id === idea.pillarId);
    const pillarName = pillar?.name || idea.category || "Unknown";
    const { score: engagementScore, breakdown } = computeEngagementScore(idea, pillarName);
    const matchedTemplate = matchTemplate(idea, templates);

    topIdeas.push({
      title: idea.title,
      viralScore: String(idea.viralScore || "?"),
      engagementScore,
      pillar: pillarName,
      templateUsed: matchedTemplate?.name || null,
      hook: idea.suggestedHook || "",
      breakdown,
    });

    const slotDef = DAILY_SLOTS[i % DAILY_SLOTS.length];
    const postType = determineContentType(idea, {
      sourceType: idea.sourceType || "rss",
      contentAngles: idea.contentAngles || [],
    });

    try {
      if (postType === "article") {
        const articleDraft = await generateArticleDraftFromIdea(idea, idea.pillarId ?? null);
        if (!articleDraft) {
          errors.push(`Article draft failed: ${idea.title.substring(0, 50)}`);
          continue;
        }
        const wordCount = articleDraft.contentMarkdown.split(/\s+/).filter(Boolean).length;
        await storage.createArticle({
          title: articleDraft.title,
          subtitle: articleDraft.subtitle,
          coverImageUrl: articleDraft.coverImageUrl,
          contentMarkdown: articleDraft.contentMarkdown,
          seoDescription: articleDraft.seoDescription,
          articleTemplate: articleDraft.articleTemplate,
          status: "draft",
          pillarId: articleDraft.pillarId,
          wordCount,
          estimatedReadMinutes: estimateReadMinutes(wordCount),
        } as any);
      } else {
        const draft = await generateDraftFromIdea(idea, postType, slotDef.tone, idea.pillarId ?? null);
        if (!draft) {
          errors.push(`Draft gen failed: ${idea.title.substring(0, 50)}`);
          continue;
        }
        draft.scheduledAt = todaySlots[i];
        await storage.createPost(
          {
            pillarId: draft.pillarId,
            postType: draft.postType,
            tone: draft.tone,
            targetPlatform: "x",
            status: "scheduled",
            scheduledAt: draft.scheduledAt,
            autopilot: true,
            imageUrl: draft.imageUrl,
          } as any,
          draft.tweets as any,
        );
      }
      await storage.updateDiscoveredIdeaStatus(idea.id, "scheduled");
      postsScheduled++;
    } catch (e: any) {
      errors.push(e?.message || String(e));
    }
  }

  return {
    discoverBatchId: refreshResult.batchId,
    newIdeas: refreshResult.newIdeasCount,
    postsScheduled,
    topIdeas,
    marketPulse: {
      breakingTopics: pulse.breakingTopics,
      trendingKeywords: pulse.trendingKeywords,
      boostTopics: pulse.boostTopics,
    },
    errors,
  };
}

// ─── Manual scheduling API ──────────────────────────────────────────────────────

export async function scheduleManualPost(
  ideaId: number,
  scheduledAt: Date,
  postType?: string,
): Promise<{ postId: number | null; error?: string }> {
  try {
    const ideas = await storage.getDiscoveredIdeas();
    const idea = ideas.find((i) => i.id === ideaId);
    if (!idea) return { postId: null, error: "Idea not found" };

    const pillars = await storage.getPillars();
    const pillar = pillars.find((p) => p.id === idea.pillarId);
    const pillarName = pillar?.name || idea.category || "DevOps";

    const actualPostType = postType || determineContentType(idea);
    const tone = actualPostType === "hot_take" ? "provocative" : "educational";

    const draft = await generateDraftFromIdea(idea, actualPostType, tone, idea.pillarId ?? null);
    if (!draft) return { postId: null, error: "Draft generation failed" };

    draft.scheduledAt = scheduledAt;

    const post = await storage.createPost(
      {
        pillarId: draft.pillarId,
        postType: draft.postType,
        tone: draft.tone,
        targetPlatform: "x",
        status: "scheduled",
        scheduledAt: draft.scheduledAt,
        autopilot: true,
        imageUrl: draft.imageUrl,
      } as any,
      draft.tweets as any,
    );

    await storage.updateDiscoveredIdeaStatus(idea.id, "scheduled");
    return { postId: (post as any).id };
  } catch (e: any) {
    return { postId: null, error: e?.message || String(e) };
  }
}

// Backwards-compat: keep old function names
export { runDailyAutoPost as runMorningBriefing };

// ─── Weekend content generation ───────────────────────────────────────────────

export type WeekendContentResult = {
  postType: "article_thread" | "weekly_recap";
  postId: number | null;
  ideaTitle: string;
  tweetCount: number;
  scheduledAt: Date;
  error?: string;
};

export async function generateWeekendContent(
  type: "article_thread" | "weekly_recap",
): Promise<WeekendContentResult> {
  const now = new Date();
  const istNow = toIST(now);
  const scheduledAt = fromIST(istNow);
  scheduledAt.setHours(scheduledAt.getHours() + 2); // Schedule 2h from now for weekend posts

  if (type === "weekly_recap") {
    const pulse = await getMarketPulse();
    const summaryIdea: DiscoveredIdea = {
      id: -1,
      title: `Weekly Recap: ${pulse.breakingTopics.slice(0, 3).join(", ") || "DevOps & AI this week"}`,
      description: `Weekly roundup of top trends: ${pulse.trendingKeywords.slice(0, 8).join(", ")}`,
      summary: "Weekly DevOps/AI recap",
      sourceInspiration: "Market Pulse",
      sourceUrl: null,
      sourceType: "trends",
      category: "devops",
      contentTypeSuggestion: "weekly_recap",
      contentAngles: pulse.breakingTopics.slice(0, 3),
      pillarId: null,
      viralScore: "8.0",
      viralReasoning: "Weekly recaps drive saves and follows",
      valueProposition: "One thread to stay current",
      uniqueAngle: pulse.xAlgorithmContext.substring(0, 100),
      timeliness: "trending_now",
      targetAudience: "DevOps and AI engineers",
      suggestedHook: `This week in DevOps/AI: ${pulse.breakingTopics[0] || "big things happened"}`,
      hashtagSuggestions: ["DevOps", "AI", "Kubernetes"],
      batchId: `weekend_${Date.now()}`,
      status: "new",
      isBookmarked: false,
      discoveredAt: new Date(),
      updatedAt: new Date(),
    } as any;

    const draft = await generateDraftFromIdea(summaryIdea, "weekly_recap", "reflective", null);
    if (!draft) return { postType: type, postId: null, ideaTitle: summaryIdea.title, tweetCount: 0, scheduledAt, error: "Draft generation failed" };

    draft.scheduledAt = scheduledAt;
    const post = await storage.createPost(
      { pillarId: null, postType: "weekly_recap", tone: "reflective", targetPlatform: "x", status: "scheduled", scheduledAt, autopilot: true } as any,
      draft.tweets as any,
    );
    return { postType: type, postId: (post as any)?.id ?? null, ideaTitle: summaryIdea.title, tweetCount: draft.tweets.length, scheduledAt };
  }

  const ideas = await storage.getDiscoveredIdeas();
  const pillars = await storage.getPillars();
  const pulse = await getMarketPulse();
  const ranked = rankIdeas(ideas.filter((i) => i.status !== "used"), pillars, pulse);

  if (!ranked.length) return { postType: type, postId: null, ideaTitle: "(none)", tweetCount: 0, scheduledAt, error: "No ideas available" };

  const best = ranked[0];
  const draft = await generateDraftFromIdea(best, "article_thread", "educational", best.pillarId ?? null);
  if (!draft) return { postType: type, postId: null, ideaTitle: best.title, tweetCount: 0, scheduledAt, error: "Draft generation failed" };

  draft.scheduledAt = scheduledAt;
  const post = await storage.createPost(
    { pillarId: best.pillarId, postType: "article_thread", tone: "educational", targetPlatform: "x", status: "scheduled", scheduledAt, autopilot: true } as any,
    draft.tweets as any,
  );
  await storage.updateDiscoveredIdeaStatus(best.id, "used");
  return { postType: type, postId: (post as any)?.id ?? null, ideaTitle: best.title, tweetCount: draft.tweets.length, scheduledAt };
}
