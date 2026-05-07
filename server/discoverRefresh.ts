/**
 * Discover pipeline: HN, Reddit, RSS, GitHub, ArXiv, Google Trends — no x.com scraping.
 * Sources: HN → Reddit (11 subreddits) → RSS feeds → GitHub trending → ArXiv → Google Trends RSS
 * Deduplication: skips titles/URLs already in discovered_ideas within the past 14 days.
 */
import Parser from "rss-parser";
import type { DiscoveredIdea } from "@shared/schema";
import { storage } from "./storage";
import { aiCall, logAiUsage, safeJsonParse } from "./ai/chat";

const rssParser = new Parser();

export type DiscoverRefreshResult = {
  batchId: string;
  ideas: DiscoveredIdea[];
  newIdeasCount: number;
  sourcesScanned: number;
};

/** Runs the full Discover pipeline (HN, Reddit, RSS, GitHub, ArXiv, Google Trends → AI ranking → DB). */
export async function runDiscoverRefresh(): Promise<DiscoverRefreshResult> {
  const batchId = `batch_${Date.now()}`;

  // Dedupe: collect URLs and title prefixes already saved in the last 14 days
  const recentIdeas = await storage.getDiscoveredIdeas();
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const seenUrls = new Set(
    recentIdeas
      .filter((i) => new Date(i.discoveredAt).getTime() > cutoff && i.sourceUrl)
      .map((i) => i.sourceUrl!.trim()),
  );
  const seenTitles = new Set(
    recentIdeas
      .filter((i) => new Date(i.discoveredAt).getTime() > cutoff)
      .map((i) => i.title.toLowerCase().substring(0, 60)),
  );
  const isDupe = (title: string, url?: string): boolean => {
    if (url && seenUrls.has(url.trim())) return true;
    return seenTitles.has(title.toLowerCase().substring(0, 60));
  };

  const hnPromise = (async () => {
    try {
      const r = await fetch(
        "https://hn.algolia.com/api/v1/search?query=AI+OR+kubernetes+OR+devops+OR+MLOps+OR+platform+engineering+OR+AIOps&tags=story&hitsPerPage=15",
        { signal: AbortSignal.timeout(8000) },
      );
      const d = (await r.json()) as any;
      return (d.hits || [])
        .slice(0, 15)
        .map((h: any) => ({
          source: "Hacker News",
          sourceType: "hackernews",
          category: "tech",
          title: h.title,
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          points: h.points,
          comments: h.num_comments,
        }))
        .filter((item: any) => !isDupe(item.title, item.url));
    } catch (e) {
      console.error("[discover] HN error:", e);
      return [];
    }
  })();

  const redditPromise = (async () => {
    const subreddits = [
      // MLOps / Data / AI
      { name: "dataengineering",      cat: "mlops" },
      { name: "MachineLearning",      cat: "mlops" },
      { name: "mlops",                cat: "mlops" },
      { name: "LocalLLaMA",           cat: "ai" },
      { name: "artificial",           cat: "ai" },
      // DevOps / K8s / Platform
      { name: "devops",               cat: "devops" },
      { name: "kubernetes",           cat: "kubernetes" },
      { name: "sre",                  cat: "sre" },
      { name: "platformengineering",  cat: "platform_engineering" },
      { name: "cloudnative",          cat: "devops" },
      // IaC / Cloud
      { name: "Terraform",            cat: "iac" },
      { name: "aws",                  cat: "tech" },
      { name: "googlecloud",          cat: "tech" },
      // Security
      { name: "devsecops",            cat: "security" },
      { name: "netsec",               cat: "security" },
    ];
    const results = await Promise.all(
      subreddits.map(async ({ name: sub, cat }) => {
        try {
          const r = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=week&limit=3`, {
            headers: { "User-Agent": "ContentForge/1.0" },
            signal: AbortSignal.timeout(6000),
          });
          const d = (await r.json()) as any;
          const posts = (d?.data?.children || [])
            .slice(0, 3)
            .map((c: any) => ({
              source: `Reddit r/${sub}`,
              sourceType: "reddit",
              category: cat,
              title: c.data.title,
              url: `https://reddit.com${c.data.permalink}`,
              points: c.data.score,
              comments: c.data.num_comments,
              permalink: c.data.permalink,
            }))
            .filter((item: any) => !isDupe(item.title, item.url));

          // Fetch top comments for posts with high engagement
          for (const post of posts) {
            if (post.comments > 20) {
              try {
                const cr = await fetch(`https://www.reddit.com${post.permalink}.json?limit=10`, {
                  headers: { "User-Agent": "ContentForge/1.0" },
                  signal: AbortSignal.timeout(6000),
                });
                const cd = (await cr.json()) as any;
                const comments = cd[1]?.data?.children
                  ?.slice(0, 5)
                  ?.map((c: any) => c.data?.body)
                  ?.filter(Boolean)
                  ?.join("\n---\n");
                if (comments) {
                  post.summary = `Top discussion:\n${comments.substring(0, 500)}`;
                }
              } catch {
                // non-critical
              }
            }
          }

          return posts;
        } catch {
          return [];
        }
      }),
    );
    return results.flat();
  })();

  const rssPromise = (async () => {
    try {
      // Pull from up to 20 active feeds, rotating based on day-of-week so every
      // feed gets coverage over the week without hammering all 47 sources at once
      const allFeeds = (await storage.getRssSources()).filter((f) => f.isActive);
      const dayIndex = new Date().getDay(); // 0-6
      const chunkSize = 20;
      const start = (dayIndex * chunkSize) % Math.max(allFeeds.length, 1);
      const feeds = [...allFeeds.slice(start), ...allFeeds.slice(0, start)].slice(0, chunkSize);
      const results = await Promise.all(
        feeds.map(async (feed) => {
          try {
            const parsed = await rssParser.parseURL(feed.feedUrl);
            return (parsed.items || []).slice(0, 2).map((item) => ({
              source: feed.name,
              sourceType: "rss",
              category: feed.category || "tech",
              title: item.title || "",
              url: item.link || "",
              summary: item.contentSnippet?.substring(0, 150) || "",
            }));
          } catch {
            return [];
          }
        }),
      );
      return results.flat();
    } catch {
      return [];
    }
  })();

  const githubPromise = (async () => {
    try {
      const r = await fetch(
        "https://api.github.com/search/repositories?q=AI+OR+kubernetes+OR+devops+OR+mlops+created:>2026-02-01&sort=stars&order=desc&per_page=8",
        {
          headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "ContentForge/1.0" },
          signal: AbortSignal.timeout(8000),
        },
      );
      const d = (await r.json()) as any;
      return (d?.items || []).slice(0, 8).map((repo: any) => ({
        source: "GitHub",
        sourceType: "github",
        category: "tech",
        title: `${repo.full_name}: ${repo.description || ""}`.substring(0, 180),
        url: repo.html_url,
        points: repo.stargazers_count,
        summary: `Stars: ${repo.stargazers_count}, Lang: ${repo.language || "N/A"}`.substring(0, 150),
      }));
    } catch (e) {
      console.error("[discover] GitHub error:", e);
      return [];
    }
  })();

  const arxivPromise = (async () => {
    try {
      const r = await fetch(
        "http://export.arxiv.org/api/query?search_query=all:AI+infrastructure+OR+all:MLOps+OR+all:kubernetes+machine+learning&start=0&max_results=5&sortBy=submittedDate&sortOrder=descending",
        { signal: AbortSignal.timeout(8000) },
      );
      const text = await r.text();
      const entries = text.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
      return entries
        .slice(0, 5)
        .map((entry) => {
          const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
          const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
          const linkMatch = entry.match(/<id>([\s\S]*?)<\/id>/);
          if (!titleMatch) return null;
          return {
            source: "ArXiv",
            sourceType: "arxiv",
            category: "ai_research",
            title: titleMatch[1].replace(/\s+/g, " ").trim().substring(0, 180),
            url: linkMatch?.[1]?.trim() || "",
            summary: summaryMatch?.[1]?.replace(/\s+/g, " ").trim().substring(0, 150) || "",
          };
        })
        .filter(Boolean);
    } catch (e) {
      console.error("[discover] ArXiv error:", e);
      return [];
    }
  })();

  // Google Trends — tech/AI daily trending topics via RSS
  const googleTrendsPromise = (async () => {
    try {
      const parsed = await rssParser.parseURL(
        "https://trends.google.com/trending/rss?geo=US&hl=en-US",
      );
      return (parsed.items || [])
        .slice(0, 10)
        .map((item) => ({
          source: "Google Trends",
          sourceType: "trends",
          category: "tech",
          title: item.title || "",
          url: item.link || "",
          summary: (item.contentSnippet || "").substring(0, 150),
        }))
        .filter((item) => !isDupe(item.title, item.url));
    } catch {
      return [];
    }
  })();

  const [hnData, redditData, rssData, githubData, arxivData, trendsData] = await Promise.all([
    hnPromise,
    redditPromise,
    rssPromise,
    githubPromise,
    arxivPromise,
    googleTrendsPromise,
  ]);

  const rawData = [...hnData, ...redditData, ...rssData, ...githubData, ...arxivData, ...trendsData];

  if (rawData.length === 0) {
    rawData.push(
      {
        source: "Hacker News",
        sourceType: "hackernews",
        category: "tech",
        title: "The rise of AI agents in infrastructure automation",
        url: "",
      },
      {
        source: "Reddit r/devops",
        sourceType: "reddit",
        category: "devops",
        title: "Platform engineering is replacing DevOps teams",
        url: "",
      },
      {
        source: "Newsletter",
        sourceType: "rss",
        category: "ai",
        title: "Kubernetes 1.30 brings AI workload scheduling improvements",
        url: "",
      },
    );
  }

  const allPillars = await storage.getPillars();
  const pillarNames = allPillars.map((p) => p.name).join(", ");

  const { content, usage, latency } = await aiCall(
    [
      {
        role: "system",
        content: `You are a content strategist for a senior Infrastructure Engineering Lead (11+ yrs), brand at the intersection of AI + DevOps + Platform Engineering. He posts 3x/day on X targeting engineers and tech leaders globally. AI/DevOps content gets highest engagement — prioritise that intersection. Key niches: Kubernetes, Kafka, MLOps, AIOps, Platform Engineering, SRE, IaC, FinOps, AI Agents.`,
      },
      {
        role: "user",
        content: `Raw trending topics from today's research (HN, Reddit with comments, RSS, GitHub, Google Trends, ArXiv):

${JSON.stringify(rawData.slice(0, 30))}

Return exactly 20 content ideas ranked by viral potential for an infrastructure/AI engineering audience. Prioritise AI+DevOps intersection topics. Return JSON:

{"ideas": [{"rank": 1, "title": "Compelling content idea title that stops the scroll", "description": "2-3 sentences on the angle and why it resonates with engineers", "summary": "One-line summary", "source_inspiration": "Source that inspired this", "source_url": "URL if available", "source_type": "hackernews|reddit|rss|github|arxiv|trends", "category": "ai|devops|mlops|tech|leadership|system_design|ai_research|kubernetes|platform_engineering|sre|finops|security|iac", "content_type_suggestion": "thread|tweet|long_thread|hot_take", "content_angles": ["angle 1 — technical deep dive", "angle 2 — hot take/contrarian", "angle 3 — story/experience"], "pillar": "One of: ${pillarNames}", "viral_score": 8.5, "viral_reasoning": "Why this will perform for infrastructure engineers on X", "value_proposition": "What the reader gains", "unique_angle": "How deep production experience at scale adds credibility. No company names — general references only.", "timeliness": "evergreen|trending_now|this_week", "target_audience": "Specific sub-audience (e.g. SREs, K8s operators, ML engineers)", "suggested_hook": "First tweet/line draft — must stop the scroll", "hashtag_suggestions": ["2-3 relevant hashtags"]}]}

Rank by: AI/DevOps intersection weight (×1.3) > Value Density > Unique Technical Angle > Emotional Trigger > Discussion Potential`,
      },
    ],
    true,
  );

  await logAiUsage(usage, latency, "discover_ideas");
  const parsed = safeJsonParse(content);
  if (!parsed?.ideas) {
    throw new Error("AI returned invalid response.");
  }

  const ideaRecords = parsed.ideas.map((idea: any, i: number) => {
    const matchedPillar = allPillars.find((p) =>
      p.name.toLowerCase().includes(String(idea.pillar || "").toLowerCase().split(" ")[0]),
    );
    return {
      rank: idea.rank || i + 1,
      title: String(idea.title || "").substring(0, 500),
      description: idea.description,
      summary: idea.summary || null,
      sourceInspiration: idea.source_inspiration,
      sourceUrl: idea.source_url || null,
      sourceType: idea.source_type || "rss",
      category: idea.category || null,
      contentTypeSuggestion: idea.content_type_suggestion,
      contentAngles: idea.content_angles || [],
      pillarId: matchedPillar?.id || null,
      viralScore: String(idea.viral_score || "5.0"),
      viralReasoning: idea.viral_reasoning,
      valueProposition: idea.value_proposition,
      uniqueAngle: idea.unique_angle,
      timeliness: idea.timeliness,
      targetAudience: idea.target_audience,
      suggestedHook: idea.suggested_hook,
      hashtagSuggestions: idea.hashtag_suggestions || [],
      batchId,
      status: "new",
    };
  });

  const saved = await storage.createDiscoveredIdeas(ideaRecords);
  return {
    batchId,
    ideas: saved,
    newIdeasCount: saved.length,
    sourcesScanned: rawData.length,
  };
}
