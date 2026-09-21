import Parser from "rss-parser";
import { storage } from "./storage";
import { addThreadNumbering } from "./utils/threadUtils";
import { aiCall, logAiUsage } from "./ai/chat";
import { getBrandSystemPrompt, platformForAiPrompt } from "./brandSystemPrompt";
import type { YoutubeChannel } from "@shared/schema";

const rssParser = new Parser();

const CONNECTOR_USER_ID = 1;

/** Resolve UC… channel id from a watch URL, /channel/, /@handle, or raw channel id. */
export async function resolveYoutubeChannelId(channelUrl: string): Promise<{
  channelId: string;
  channelName: string | null;
}> {
  const raw = channelUrl.trim();
  const chanSeg = raw.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/i);
  if (chanSeg) {
    const meta = await fetchChannelMeta(chanSeg[1]);
    return { channelId: chanSeg[1], channelName: meta.title };
  }
  const handleMatch = raw.match(/youtube\.com\/@([^/?#]+)/i);
  if (handleMatch) {
    const page = await fetch(`https://www.youtube.com/@${handleMatch[1]}`, {
      headers: { "User-Agent": "ContentForge/1.0 (RSS connector)" },
      signal: AbortSignal.timeout(12_000),
    });
    const html = await page.text();
    const idMatch = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
    if (!idMatch) throw new Error("Could not resolve @handle to channel id");
    const meta = await fetchChannelMeta(idMatch[1]);
    return { channelId: idMatch[1], channelName: meta.title };
  }
  const uc = raw.match(/^(UC[a-zA-Z0-9_-]{22})$/);
  if (uc) {
    const meta = await fetchChannelMeta(uc[1]);
    return { channelId: uc[1], channelName: meta.title };
  }
  throw new Error("Unrecognized YouTube channel URL");
}

async function fetchChannelMeta(channelId: string): Promise<{ title: string | null }> {
  try {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const feed = await rssParser.parseURL(feedUrl);
    return { title: feed.title || null };
  } catch {
    return { title: null };
  }
}

function videoIdFromItem(item: { link?: string; id?: string }): string | null {
  const link = item.link || "";
  const m = link.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  const id = item.id || "";
  const atom = id.match(/^yt:video:([a-zA-Z0-9_-]{11})$/);
  if (atom) return atom[1];
  return null;
}

export async function checkYoutubeChannelRow(channel: YoutubeChannel): Promise<void> {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`;
  const feed = await rssParser.parseURL(feedUrl);
  const latestEntry = feed.items[0];
  if (!latestEntry) return;

  const videoId = videoIdFromItem(latestEntry as any);
  if (!videoId || videoId === channel.lastVideoId) return;

  console.log(`[youtube-connector] New video: ${latestEntry.title} (${videoId})`);
  await storage.updateYoutubeChannel(channel.id, {
    lastVideoId: videoId,
    lastCheckedAt: new Date(),
  });

  const plat = platformForAiPrompt(channel.autopostPlatform || "x");
  const systemPrompt = await getBrandSystemPrompt(CONNECTOR_USER_ID, plat);
  const postType = channel.autopostPostType || "thread";

  const { content, usage, latency } = await aiCall([
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `New YouTube video uploaded: "${latestEntry.title}" by ${channel.channelName || "this channel"}.
URL: https://www.youtube.com/watch?v=${videoId}
Create a compelling ${postType} for X about this video.
Separate tweets with "---". Do NOT add numbering.`,
    },
  ]);
  await logAiUsage(usage, latency, "youtube_connector");

  const rawTweets = content.split("---").map((t: string) => t.trim()).filter(Boolean);
  const numbered = addThreadNumbering(rawTweets);
  const tweetRows = numbered.map((c, i) => ({
    content: c,
    position: i,
    charCount: c.length,
    postId: 0 as number,
  }));

  const scheduledAt =
    channel.requireApproval === false
      ? new Date(Date.now() + 20 * 60 * 1000)
      : null;

  await storage.createPost(
    1,
    {
      pillarId: channel.autopostPillarId ?? null,
      postType,
      tone: channel.autopostTone || "educational",
      targetPlatform: channel.autopostPlatform || "x",
      status: channel.requireApproval === false ? "scheduled" : "draft",
      scheduledAt,
      autopilot: false,
    },
    tweetRows,
  );
  console.log(`[youtube-connector] Post saved for video ${videoId}`);
}

export async function checkYoutubeChannels(): Promise<void> {
  const channels = await storage.getActiveYoutubeChannels();
  for (const channel of channels) {
    await checkYoutubeChannelRow(channel).catch((e) =>
      console.error(`[youtube-connector] Channel ${channel.channelId} failed:`, e),
    );
  }
}
