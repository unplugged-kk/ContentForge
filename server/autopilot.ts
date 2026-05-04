/**
 * Autopilot engine — discover → rank → draft → schedule, fully unattended.
 * Manual flow (Discover page, Generate page) still works independently.
 *
 * Posting slots (UTC):
 *   07:30 — EU morning commute  → thread/educational
 *   14:00 — India evening       → tweet/hot_take
 *   17:30 — US lunch scroll     → thread/long_thread
 */
import { storage } from "./storage";
import { aiCall, logAiUsage, safeJsonParse } from "./ai/chat";
import { runDiscoverRefresh } from "./discoverRefresh";
import type { DiscoveredIdea } from "@shared/schema";

const POSTING_SLOTS: { utcHour: number; utcMinute: number; preferredType: string; tone: string }[] = [
  { utcHour: 7, utcMinute: 30, preferredType: "thread", tone: "educational" },
  { utcHour: 14, utcMinute: 0, preferredType: "tweet", tone: "provocative" },
  { utcHour: 17, utcMinute: 30, preferredType: "thread", tone: "storytelling" },
];

/** All 14 content pillars with hot-topic priority weighting for AI/DevOps niche */
const PILLAR_WEIGHTS: Record<string, number> = {
  "AI Agents & Agentic Workflows": 1.4,
  "AIOps & AI-Assisted DevOps": 1.3,
  "Data Infrastructure & MLOps": 1.2,
  "Kubernetes Deep Dives": 1.1,
  "Platform Engineering & DevEx": 1.1,
  "SRE & Reliability Engineering": 1.0,
  "Cloud-Native Data Platforms": 1.0,
  "Infrastructure as Code": 0.9,
  "FinOps & Cloud Cost Engineering": 0.9,
  "Security & DevSecOps": 0.9,
  "Technical Leadership & Eng Management": 0.8,
  "Open Source & CNCF Ecosystem": 0.8,
  "Career & Leadership": 0.7,
  "Hot Takes & Trends": 1.2,
};

const KISHORE_VOICE = `You are ghostwriting for Kishore Kumar Behera — Infrastructure Engineering Lead (11+ yrs), deep expertise in Kubernetes, Kafka, Spark, Terraform, data platforms, and AI-assisted DevOps. He has shipped:
- Saved $500K at Salesforce via cloud cost optimisation
- Ran multi-region K8s platforms at Maersk scale
- Built ML feature stores, AIOps observability pipelines, IaC-driven data platforms at SAP Labs

Voice rules:
1. First 2 lines must stop the scroll — specific number, bold claim, or story hook
2. Technical but conversational — how an engineer talks in Slack, not documentation
3. Specific tools, real metrics, actual scenarios (not generic advice)
4. Short punchy sentences for tweets (≤280 chars). Threads: hook tweet + numbered insights
5. End with a question or bold prediction that invites debate
6. Never use hashtags in body — they go in hashtag_suggestions only
7. Contrarian where possible — challenge conventional wisdom with evidence
8. AI + DevOps intersection content gets 30% engagement boost — prioritise that angle`;

export type AutopilotDraft = {
  postType: string;
  tone: string;
  tweets: { content: string; position: number; charCount: number }[];
  pillarId: number | null;
  pillarName: string;
  ideaTitle: string;
  hashtagSuggestions: string[];
  scheduledAt: Date;
  autopilot: true;
};

/** Generate tweet/thread content from a discovered idea */
export async function generateDraftFromIdea(
  idea: DiscoveredIdea,
  postType: string,
  tone: string,
  pillarId: number | null,
): Promise<AutopilotDraft | null> {
  const pillars = await storage.getPillars();
  const pillar = pillars.find((p) => p.id === pillarId);
  const pillarName = pillar?.name || idea.category || "Tech";

  const prompt =
    postType === "tweet"
      ? `Write a single high-engagement tweet (max 275 chars) about this topic. Return JSON: {"tweets": [{"content": "...", "position": 0}], "hashtag_suggestions": ["tag1", "tag2"]}`
      : `Write a ${postType === "long_thread" ? "8-12" : "4-7"} tweet thread. First tweet is the hook (≤275 chars). Subsequent tweets add depth (each ≤275 chars). Return JSON: {"tweets": [{"content": "...", "position": 0}, ...], "hashtag_suggestions": ["tag1", "tag2"]}`;

  try {
    const { content, usage, latency } = await aiCall(
      [
        { role: "system", content: KISHORE_VOICE },
        {
          role: "user",
          content: `Topic: ${idea.title}
Description: ${idea.description || ""}
Pillar: ${pillarName}
Tone: ${tone}
Suggested hook: ${idea.suggestedHook || ""}
Content angles: ${(idea.contentAngles || []).join("; ")}

${prompt}`,
        },
      ],
      true,
    );

    await logAiUsage(usage, latency, "autopilot_draft");
    const parsed = safeJsonParse(content);
    if (!parsed?.tweets?.length) return null;

    const tweets = parsed.tweets.map((t: any) => ({
      content: String(t.content || "").slice(0, 280),
      position: t.position ?? 0,
      charCount: String(t.content || "").length,
    }));

    return {
      postType,
      tone,
      tweets,
      pillarId,
      pillarName,
      ideaTitle: idea.title,
      hashtagSuggestions: parsed.hashtag_suggestions || [],
      scheduledAt: new Date(), // caller sets the actual time
      autopilot: true,
    };
  } catch (e) {
    console.error("[autopilot] generateDraftFromIdea failed:", e);
    return null;
  }
}

/** Pick the next N posting slot DateTimes starting from a given base date */
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

/** Return ideas filtered by viral score, weighted by pillar priority */
function rankIdeas(ideas: DiscoveredIdea[], pillars: { id: number; name: string }[]): DiscoveredIdea[] {
  return ideas
    .filter((i) => parseFloat(String(i.viralScore || "0")) >= 6.0)
    .sort((a, b) => {
      const pillarA = pillars.find((p) => p.id === a.pillarId)?.name || "";
      const pillarB = pillars.find((p) => p.id === b.pillarId)?.name || "";
      const weightA = PILLAR_WEIGHTS[pillarA] ?? 1.0;
      const weightB = PILLAR_WEIGHTS[pillarB] ?? 1.0;
      const scoreA = parseFloat(String(a.viralScore || "5")) * weightA;
      const scoreB = parseFloat(String(b.viralScore || "5")) * weightB;
      return scoreB - scoreA;
    });
}

export type AutofillResult = {
  draftsCreated: number;
  slots: Date[];
  errors: string[];
};

/**
 * Fill the calendar for the next `days` days with autopilot-generated posts.
 * Skips slots that already have a scheduled post.
 * Both this and manual scheduling can coexist — autopilot only fills empty slots.
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
      return { draftsCreated: 0, slots: freeSlots, errors: ["No ideas available and discover refresh failed"] };
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
      errors.push(`Failed to generate draft for: ${idea.title.substring(0, 60)}`);
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
      // Mark idea as used
      await storage.updateDiscoveredIdeaStatus(idea.id, "used");
      draftsCreated.push(idea.id);
    } catch (e: any) {
      errors.push(e?.message || String(e));
    }
  }

  return { draftsCreated: draftsCreated.length, slots: freeSlots.slice(0, draftsCreated.length), errors };
}

export type MorningBriefingResult = {
  discoverBatchId: string;
  newIdeas: number;
  draftsGenerated: number;
  topIdeas: { title: string; viralScore: string; pillar: string; hook: string }[];
  errors: string[];
};

/**
 * Morning briefing: runs every day at 05:00 UTC.
 * 1. Runs discover refresh (HN, Reddit, RSS, GitHub, Google Trends, ArXiv)
 * 2. Picks top 5 ideas
 * 3. Auto-generates draft posts for each (status = "ready" not "scheduled" — Kishore reviews before publishing)
 */
export async function runMorningBriefing(): Promise<MorningBriefingResult> {
  const errors: string[] = [];

  const refreshResult = await runDiscoverRefresh();
  const pillars = await storage.getPillars();
  const allIdeas = await storage.getDiscoveredIdeas(refreshResult.batchId);
  const ranked = rankIdeas(allIdeas, pillars).slice(0, 5);

  const topIdeas: MorningBriefingResult["topIdeas"] = [];
  let draftsGenerated = 0;

  for (const idea of ranked) {
    const pillar = pillars.find((p) => p.id === idea.pillarId);
    topIdeas.push({
      title: idea.title,
      viralScore: String(idea.viralScore || "?"),
      pillar: pillar?.name || idea.category || "Unknown",
      hook: idea.suggestedHook || "",
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
          status: "ready", // NOT auto-scheduled — Kishore reviews these
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
    errors,
  };
}
