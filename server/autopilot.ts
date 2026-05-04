/**
 * Autopilot engine — discover → rank → template-match → draft → schedule.
 * Manual flow (Discover page, Generate page) works independently alongside this.
 *
 * Posting slots (UTC):
 *   07:30 — EU morning commute  → thread/educational
 *   14:00 — India evening       → tweet/hot_take
 *   17:30 — US lunch scroll     → thread/long_thread
 *
 * Niche filter: only DevOps · AI · Kubernetes · Platform Engineering · SRE · MLOps · FinOps · Security
 * Off-topic content (finance, sports, general tech news, etc.) is rejected before drafting.
 */
import { storage } from "./storage";
import { aiCall, logAiUsage, safeJsonParse } from "./ai/chat";
import { runDiscoverRefresh } from "./discoverRefresh";
import { getMarketPulse, applyBreakingNewsBoost, type MarketPulseResult } from "./marketPulse";
import type { DiscoveredIdea, Template } from "@shared/schema";

// ─── Posting schedule ────────────────────────────────────────────────────────

const POSTING_SLOTS = [
  { utcHour: 7,  utcMinute: 30, preferredType: "thread",      tone: "educational",  label: "EU morning" },
  { utcHour: 14, utcMinute: 0,  preferredType: "tweet",       tone: "provocative",  label: "India evening" },
  { utcHour: 17, utcMinute: 30, preferredType: "thread",      tone: "storytelling", label: "US lunch" },
] as const;

// ─── Niche relevance filter ───────────────────────────────────────────────────
// Only content about these domains passes. Everything else is discarded.

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
  "terraform", "pulumi", "crossplane", "argocd", "flux", "gitops",
  "backstage", "idp", "internal developer platform", "golden path",
  "llmops", "model deployment", "model serving", "inference", "fine-tuning",
  "nvidia", "gpu", "tpu", "accelerator", "cuda", "triton",
  "opentelemetry", "otel", "tracing", "metrics", "logs", "grafana", "prometheus",
];

function isNicheRelevant(idea: DiscoveredIdea): boolean {
  const text = `${idea.title} ${idea.description || ""} ${idea.category || ""}`.toLowerCase();
  return NICHE_KEYWORDS.some((kw) => text.includes(kw));
}

// ─── Pillar weights ───────────────────────────────────────────────────────────
// AI+DevOps intersection gets the highest boost — that's where Kishore's
// audience engages most. Weights multiply the AI-assigned viral score.

export const PILLAR_WEIGHTS: Record<string, number> = {
  "AI Agents & Agentic Workflows":          1.40,  // hottest topic in 2025-26
  "AIOps & AI-Assisted DevOps":             1.35,  // AI+DevOps = Kishore's sweet spot
  "Hot Takes & Trends":                     1.20,  // controversy drives engagement
  "Data Infrastructure & MLOps":            1.20,
  "Kubernetes Deep Dives":                  1.15,  // core audience
  "Platform Engineering & DevEx":           1.10,
  "SRE & Reliability Engineering":          1.05,
  "Cloud-Native Data Platforms":            1.00,
  "Infrastructure as Code":                 0.95,
  "Security & DevSecOps":                   0.90,
  "FinOps & Cloud Cost Engineering":        0.90,
  "Open Source & CNCF Ecosystem":           0.85,
  "Technical Leadership & Eng Management":  0.80,
  "Career & Leadership":                    0.75,
  // old pillar names from DB (backwards-compat)
  "AI for DevOps / AIOps":                  1.35,
  "Infrastructure as Code for Data":        0.95,
};

// ─── Template matching ────────────────────────────────────────────────────────
// Each idea is matched to the best template from the DB based on:
//   1. Pillar match (same pillar = strong signal)
//   2. Content type match (idea's contentTypeSuggestion vs template's postType)
//   3. Keyword affinity (template pattern keywords in idea title/description)

export function matchTemplate(idea: DiscoveredIdea, templates: Template[]): Template | null {
  if (!templates.length) return null;

  const text = `${idea.title} ${idea.description || ""}`.toLowerCase();
  const ideaType = idea.contentTypeSuggestion || "thread";

  // Score each template
  const scored = templates.map((t) => {
    let score = 0;

    // Pillar match — highest weight
    if (t.pillarId && t.pillarId === idea.pillarId) score += 10;

    // Post type alignment
    if (t.postType === ideaType) score += 5;
    if (ideaType === "hot_take" && t.postType === "tweet") score += 3;
    if (ideaType === "long_thread" && t.postType === "thread") score += 3;

    // Pattern keyword affinity
    const patternWords = t.pattern.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    for (const w of patternWords) {
      if (text.includes(w)) score += 2;
    }

    // Prefer templates that match the idea's timeliness
    if (idea.timeliness === "trending_now" && t.pattern.toLowerCase().includes("hot take")) score += 3;
    if (idea.timeliness === "evergreen" && t.pattern.toLowerCase().includes("lesson")) score += 2;

    return { template: t, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].score > 0 ? scored[0].template : null;
}

// ─── Engagement score ─────────────────────────────────────────────────────────
// Composite score shown in API responses. Combines viral_score × pillar_weight
// with bonus signals from timeliness and content type.

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

const KISHORE_VOICE = `You are ghostwriting for Kishore Kumar Behera — Infrastructure Engineering Lead (11+ yrs).
Credentials: Saved $500K at Salesforce via cloud cost optimisation. Ran multi-region K8s platforms at Maersk. Built ML feature stores and AIOps observability pipelines at SAP Labs.

NICHE: DevOps · AI/MLOps · Kubernetes · Platform Engineering · SRE · FinOps · IaC. Do NOT write about anything outside this niche.

Voice rules — apply every single one:
1. Hook: first line must stop the scroll with a specific number, bold claim, or story moment. No generic intros.
2. Specific > Generic: real tool names, real metrics, real scenarios. Never say "many teams" — say "we did X at Maersk".
3. Contrarian: challenge the mainstream view WITH evidence.
4. Conversational: how an engineer talks in Slack, NOT how documentation reads.
5. Short sentences for tweets (max 275 chars). Threads: hook tweet + numbered insights (1/, 2/, ...).
6. End every piece with a question or bold prediction that invites debate.
7. No hashtags in post body — add them to hashtag_suggestions only.
8. AI+DevOps intersection angle always gets higher engagement — look for that angle first.`;

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
};

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

  const formatPrompt =
    postType === "tweet"
      ? `Write one high-engagement tweet (max 275 chars). Hook in first line.\nReturn JSON: {"tweets": [{"content": "...", "position": 0}], "hashtag_suggestions": ["tag1", "tag2"]}`
      : `Write a ${postType === "long_thread" ? "8-12" : "4-7"} tweet thread. Tweet 1 = hook (≤275 chars). Each subsequent tweet ≤275 chars, numbered (1/, 2/, ...). Last tweet = CTA or bold question.\nReturn JSON: {"tweets": [{"content": "...", "position": 0}, ...], "hashtag_suggestions": ["tag1", "tag2", "tag3"]}`;

  try {
    // Optionally inject today's market pulse context
    let pulseContext = "";
    try {
      const pulse = await getMarketPulse();
      if (pulse.breakingTopics.length) {
        pulseContext = `\nTODAY'S BREAKING CONTEXT: ${pulse.breakingTopics.slice(0, 4).join(" | ")}\nIf this topic connects to any of the above, reference it for maximum timeliness boost.`;
      }
    } catch { /* non-critical */ }

    const { content, usage, latency } = await aiCall(
      [
        { role: "system", content: KISHORE_VOICE },
        {
          role: "user",
          content: `Topic: ${idea.title}
Description: ${idea.description || ""}
Pillar: ${pillarName}
Tone: ${tone}
Engagement score: ${engagementScore} (higher = more likely to go viral for Kishore's audience)
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

    const tweets = parsed.tweets.map((t: any) => ({
      content: String(t.content || "").slice(0, 280),
      position: Number(t.position ?? 0),
      charCount: String(t.content || "").length,
    }));

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
    };
  } catch (e) {
    console.error("[autopilot] generateDraftFromIdea failed:", e);
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

// ─── Slot calculation ─────────────────────────────────────────────────────────

function nextSlots(fromDate: Date, count: number): Date[] {
  const slots: Date[] = [];
  const d = new Date(fromDate);
  d.setUTCSeconds(0, 0);

  for (let day = 0; slots.length < count; day++) {
    const base = new Date(d);
    base.setUTCDate(base.getUTCDate() + day);
    for (const slot of POSTING_SLOTS) {
      if (slots.length >= count) break;
      const t = new Date(base);
      t.setUTCHours(slot.utcHour, slot.utcMinute, 0, 0);
      if (t > fromDate) slots.push(t);
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
export async function autofillCalendar(days = 7): Promise<AutofillResult> {
  const now = new Date();
  const slots = nextSlots(now, days * POSTING_SLOTS.length);

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
    const slotDef = POSTING_SLOTS[i % POSTING_SLOTS.length];

    const postType =
      idea.contentTypeSuggestion && ["tweet", "thread", "long_thread"].includes(idea.contentTypeSuggestion)
        ? idea.contentTypeSuggestion
        : slotDef.preferredType;

    const draft = await generateDraftFromIdea(idea, postType, slotDef.tone, idea.pillarId ?? null);
    if (!draft) {
      errors.push(`Draft gen failed: ${idea.title.substring(0, 60)}`);
      continue;
    }

    draft.scheduledAt = slot;

    try {
      await storage.createPost(
        {
          pillarId: draft.pillarId,
          postType: draft.postType,
          tone: draft.tone,
          targetPlatform: "x",
          status: "scheduled",
          scheduledAt: draft.scheduledAt,
          autopilot: true,
        } as any,
        draft.tweets as any,
      );
      await storage.updateDiscoveredIdeaStatus(idea.id, "used");
      draftsCreated.push(idea.id);
    } catch (e: any) {
      errors.push(e?.message || String(e));
    }
  }

  return { draftsCreated: draftsCreated.length, slots: freeSlots.slice(0, draftsCreated.length), errors };
}

// ─── Morning briefing ─────────────────────────────────────────────────────────

export type MorningBriefingResult = {
  discoverBatchId: string;
  newIdeas: number;
  draftsGenerated: number;
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
 * Runs every day at 05:00 UTC.
 * 1. Discovers from all sources (HN, Reddit × 11, RSS × 14, GitHub, ArXiv, Google Trends)
 * 2. Niche-filters to DevOps/AI/K8s only
 * 3. Ranks by engagement score (viral × pillar weight + bonuses)
 * 4. Template-matches each top idea
 * 5. Generates 5 drafts with status="ready" — Kishore reviews before publishing
 *    (autofillCalendar separately handles auto-scheduled posts)
 */
export async function runMorningBriefing(): Promise<MorningBriefingResult> {
  const errors: string[] = [];

  // Run discover refresh and market pulse in parallel
  const [refreshResult, pulse] = await Promise.all([
    runDiscoverRefresh(),
    getMarketPulse(),
  ]);

  const [pillars, templates] = await Promise.all([storage.getPillars(), storage.getTemplates()]);
  const allIdeas = await storage.getDiscoveredIdeas(refreshResult.batchId);
  const ranked = rankIdeas(allIdeas, pillars, pulse).slice(0, 5);

  const topIdeas: MorningBriefingResult["topIdeas"] = [];
  let draftsGenerated = 0;

  for (const idea of ranked) {
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

    const postType = idea.contentTypeSuggestion === "tweet" ? "tweet" : "thread";
    const draft = await generateDraftFromIdea(idea, postType, "educational", idea.pillarId ?? null);
    if (!draft) {
      errors.push(`Draft gen failed: ${idea.title.substring(0, 50)}`);
      continue;
    }

    try {
      await storage.createPost(
        {
          pillarId: draft.pillarId,
          postType: draft.postType,
          tone: draft.tone,
          targetPlatform: "x",
          status: "ready",
          autopilot: true,
        } as any,
        draft.tweets as any,
      );
      await storage.updateDiscoveredIdeaStatus(idea.id, "briefing_drafted");
      draftsGenerated++;
    } catch (e: any) {
      errors.push(e?.message || String(e));
    }
  }

  return {
    discoverBatchId: refreshResult.batchId,
    newIdeas: refreshResult.newIdeasCount,
    draftsGenerated,
    topIdeas,
    marketPulse: {
      breakingTopics: pulse.breakingTopics,
      trendingKeywords: pulse.trendingKeywords,
      boostTopics: pulse.boostTopics,
    },
    errors,
  };
}
