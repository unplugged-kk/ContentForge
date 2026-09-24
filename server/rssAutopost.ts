import type { DiscoveredIdea, RssSource } from "@shared/schema";
import { storage } from "./storage";
import { aiCall, logAiUsage } from "./ai/chat";
import { addThreadNumbering } from "./utils/threadUtils";
import { getBrandSystemPrompt, platformForAiPrompt } from "./brandSystemPrompt";

export async function generateAutopostDraft(idea: DiscoveredIdea, source: RssSource, ownerUserId: number): Promise<void> {
  const plat = platformForAiPrompt(source.autopostPlatform || "x");
  const systemPrompt = await getBrandSystemPrompt(source.userId ?? ownerUserId, plat);
  const postType = source.autopostPostType || "thread";
  const { content, usage, latency } = await aiCall([
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Create a ${postType} for X about: "${idea.title}"

${idea.description || idea.summary || ""}

Source: ${idea.sourceUrl || ""}

Separate tweets with "---". Do NOT add numbering (system adds it).`,
    },
  ]);
  await logAiUsage(usage, latency, "rss_autopost");

  const rawTweets = content.split("---").map((t) => t.trim()).filter(Boolean);
  const numbered = addThreadNumbering(rawTweets);
  const tweetRows = numbered.map((c, i) => ({
    content: c,
    position: i,
    charCount: c.length,
    postId: 0 as number,
  }));

  await storage.createPost(
    source.userId ?? ownerUserId,
    {
      pillarId: source.autopostPillarId ?? null,
      postType,
      tone: source.autopostTone || "educational",
      targetPlatform: source.autopostPlatform || "x",
      status: "draft",
      autopilot: false,
    },
    tweetRows,
  );

  await storage.updateDiscoveredIdeaStatus(idea.userId ?? ownerUserId, idea.id, "auto-drafted");
  console.log(`[autopost] Draft created from RSS: "${idea.title}"`);
}

/** After a discover batch saves ideas, create drafts for RSS sources with autopost enabled. */
export async function runRssAutopostForBatch(saved: DiscoveredIdea[], ownerUserId: number): Promise<void> {
  const autopostSources = await storage.getRssSourcesWithAutopost(ownerUserId);
  if (!autopostSources.length || !saved.length) return;

  for (const source of autopostSources) {
    let host = "";
    try {
      host = new URL(source.feedUrl).hostname;
    } catch {
      continue;
    }
    const candidates = saved
      .filter(
        (i) =>
          i.status === "new" &&
          Boolean(i.sourceUrl?.includes(host)),
      )
      .slice(0, 2);

    for (const idea of candidates) {
      await generateAutopostDraft(idea, source, ownerUserId).catch((e) =>
        console.error(`[autopost] Failed for idea ${idea.id}:`, e),
      );
    }
  }
}
