import {
  type Pillar, type InsertPillar,
  type Post, type InsertPost,
  type Tweet, type InsertTweet,
  type Idea, type InsertIdea,
  type Template, type InsertTemplate,
  type Analytics, type InsertAnalytics,
  type AiUsageLog, type InsertAiUsageLog,
  type Article, type InsertArticle,
  type Reference, type InsertReference,
  type StyleProfile, type InsertStyleProfile,
  type ReferenceContent, type InsertReferenceContent,
  type DiscoveredIdea, type InsertDiscoveredIdea,
  type ViralScore, type InsertViralScore,
  type MonitoredAccount, type InsertMonitoredAccount,
  type RssSource, type InsertRssSource,
  type CannedResponse, type InsertCannedResponse,
  type YoutubeChannel, type InsertYoutubeChannel,
  type DiscoverySettings,
  type ConnectedAccount, type InsertConnectedAccount,
  pillars, posts, tweets, ideas, templates, analytics, aiUsageLog,
  articles, references, referencePosts, referenceContent, styleProfiles,
  discoveredIdeas, discoverySettings,
  viralScores,   monitoredAccounts, rssSources, connectedAccounts,
  cannedResponses, youtubeChannels,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, and, gte, inArray } from "drizzle-orm";
import { decryptSecret, ensureEncrypted, isEncrypted } from "./middleware/crypto";

/**
 * Transparent decryption helper for connected_accounts rows. Stored values
 * carry the `enc:v1:` prefix; legacy plaintext rows (pre-encryption) pass
 * through `decryptSecret`'s no-prefix branch and come back unchanged. Routes
 * always see plaintext tokens.
 */
function decryptConnectedAccount<T extends ConnectedAccount | undefined>(row: T): T {
  if (!row) return row;
  return {
    ...row,
    accessToken: row.accessToken && isEncrypted(row.accessToken)
      ? safeDecrypt(row.accessToken, "accessToken")
      : row.accessToken,
    refreshToken: row.refreshToken && isEncrypted(row.refreshToken)
      ? safeDecrypt(row.refreshToken, "refreshToken")
      : row.refreshToken,
  };
}

function safeDecrypt(stored: string, label: string): string {
  try {
    return decryptSecret(stored);
  } catch (err: any) {
    // Surface a clear error rather than returning a half-decrypted blob.
    console.error(`[storage] failed to decrypt ${label}:`, err.message);
    throw new Error(`Failed to decrypt stored ${label}. ENCRYPTION_KEY may have rotated.`);
  }
}

export interface IStorage {
  getPillars(userId: number): Promise<Pillar[]>;
  createPillar(userId: number, pillar: InsertPillar): Promise<Pillar>;

  getPosts(userId: number): Promise<(Post & { tweets: Tweet[] })[]>;
  getPost(userId: number, id: number): Promise<(Post & { tweets: Tweet[] }) | undefined>;
  createPost(userId: number, post: InsertPost, tweetData: InsertTweet[]): Promise<Post & { tweets: Tweet[] }>;
  updatePost(userId: number, id: number, post: Partial<InsertPost>): Promise<Post | undefined>;
  updatePostStatus(userId: number, id: number, status: string, scheduledAt?: string): Promise<Post | undefined>;
  deletePost(userId: number, id: number): Promise<boolean>;

  getIdeas(userId: number): Promise<Idea[]>;
  getIdea(userId: number, id: number): Promise<Idea | undefined>;
  createIdea(userId: number, idea: InsertIdea): Promise<Idea>;
  updateIdea(userId: number, id: number, idea: Partial<InsertIdea>): Promise<Idea | undefined>;
  deleteIdea(userId: number, id: number): Promise<boolean>;

  getTemplates(userId: number): Promise<Template[]>;
  createTemplate(userId: number, template: InsertTemplate): Promise<Template>;

  getAnalyticsSummary(userId: number): Promise<any>;
  createAnalytics(userId: number, entry: InsertAnalytics): Promise<Analytics>;
  upsertAnalytics(postId: number, platform: string, data: { impressions: number; likes: number; retweets: number; replies: number; quotes: number; bookmarks: number; views: number }): Promise<void>;

  createAiUsageLog(log: InsertAiUsageLog): Promise<AiUsageLog>;
  getAiUsageLogs(userId: number): Promise<AiUsageLog[]>;
  getAiUsageLogsAll(userId: number, days?: number): Promise<AiUsageLog[]>;

  getArticles(userId: number): Promise<Article[]>;
  getArticle(userId: number, id: number): Promise<Article | undefined>;
  createArticle(userId: number, article: InsertArticle): Promise<Article>;
  updateArticle(userId: number, id: number, article: Partial<InsertArticle>): Promise<Article | undefined>;
  deleteArticle(userId: number, id: number): Promise<boolean>;

  getReferences(userId: number): Promise<Reference[]>;
  getReference(userId: number, id: number): Promise<Reference | undefined>;
  createReference(userId: number, ref: InsertReference): Promise<Reference>;
  updateReference(userId: number, id: number, ref: Partial<InsertReference>): Promise<Reference | undefined>;
  deleteReference(userId: number, id: number): Promise<boolean>;
  getReferencesByBatch(userId: number, batchId: string): Promise<Reference[]>;

  getStyleProfiles(userId: number): Promise<StyleProfile[]>;
  getStyleProfile(userId: number, id: number): Promise<StyleProfile | undefined>;
  createStyleProfile(userId: number, profile: InsertStyleProfile): Promise<StyleProfile>;
  updateStyleProfile(userId: number, id: number, profile: Partial<InsertStyleProfile>): Promise<StyleProfile | undefined>;
  deleteStyleProfile(userId: number, id: number): Promise<boolean>;
  incrementStyleUsage(userId: number, id: number): Promise<void>;

  createReferenceContent(userId: number, rc: InsertReferenceContent): Promise<ReferenceContent>;

  getDiscoveredIdeas(userId: number, batchId?: string): Promise<DiscoveredIdea[]>;
  createDiscoveredIdeas(userId: number, ideas: InsertDiscoveredIdea[]): Promise<DiscoveredIdea[]>;
  updateDiscoveredIdeaStatus(userId: number, id: number, status: string): Promise<DiscoveredIdea | undefined>;

  getDiscoverySettings(): Promise<DiscoverySettings>;
  updateDiscoverySettings(settings: Partial<DiscoverySettings>): Promise<DiscoverySettings>;

  getViralScores(userId: number, postId?: number, articleId?: number): Promise<ViralScore[]>;
  createViralScore(userId: number, score: InsertViralScore): Promise<ViralScore>;

  getMonitoredAccounts(userId: number): Promise<MonitoredAccount[]>;
  createMonitoredAccount(userId: number, account: InsertMonitoredAccount): Promise<MonitoredAccount>;
  deleteMonitoredAccount(userId: number, id: number): Promise<boolean>;

  getRssSources(userId: number): Promise<RssSource[]>;
  getRssSourcesWithAutopost(userId: number): Promise<RssSource[]>;
  createRssSource(userId: number, source: InsertRssSource): Promise<RssSource>;
  updateRssSource(userId: number, id: number, data: Partial<InsertRssSource>): Promise<RssSource | undefined>;
  deleteRssSource(userId: number, id: number): Promise<boolean>;

  getCannedResponses(userId: number): Promise<CannedResponse[]>;
  getCannedResponse(userId: number, id: number): Promise<CannedResponse | undefined>;
  createCannedResponse(userId: number, data: InsertCannedResponse): Promise<CannedResponse>;
  updateCannedResponse(userId: number, id: number, data: Partial<InsertCannedResponse>): Promise<CannedResponse | undefined>;
  deleteCannedResponse(userId: number, id: number): Promise<boolean>;
  incrementCannedResponseUsage(userId: number, id: number): Promise<CannedResponse | undefined>;

  getYoutubeChannels(userId: number): Promise<YoutubeChannel[]>;
  getActiveYoutubeChannels(userId: number): Promise<YoutubeChannel[]>;
  getAllActiveYoutubeChannels(): Promise<YoutubeChannel[]>;
  createYoutubeChannel(userId: number, data: InsertYoutubeChannel): Promise<YoutubeChannel>;
  updateYoutubeChannel(userId: number, id: number, data: Partial<InsertYoutubeChannel>): Promise<YoutubeChannel | undefined>;
  deleteYoutubeChannel(userId: number, id: number): Promise<boolean>;

  getConnectedAccounts(userId: number): Promise<ConnectedAccount[]>;
  getConnectedAccount(platform: string): Promise<ConnectedAccount | undefined>;
  getConnectedAccountForOwner(platform: string, ownerId: number): Promise<ConnectedAccount | undefined>;
  upsertConnectedAccount(account: InsertConnectedAccount): Promise<ConnectedAccount>;
  deleteConnectedAccount(userId: number, id: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async getPillars(userId: number): Promise<Pillar[]> {
    return db.select().from(pillars).where(eq(pillars.userId, userId)).orderBy(pillars.id);
  }

  async createPillar(userId: number, pillar: InsertPillar): Promise<Pillar> {
    const [result] = await db.insert(pillars).values({ ...pillar, userId }).returning();
    return result;
  }

  async getPosts(userId: number): Promise<(Post & { tweets: Tweet[] })[]> {
    const allPosts = await db.select().from(posts).where(eq(posts.userId, userId)).orderBy(desc(posts.createdAt));
    const postIds = allPosts.map((post) => post.id);
    const allTweets = postIds.length === 0
      ? []
      : await db.select().from(tweets)
        .where(and(eq(tweets.userId, userId), inArray(tweets.postId, postIds)))
        .orderBy(tweets.postId, tweets.position);
    return allPosts.map((p) => ({
      ...p,
      tweets: allTweets.filter((t) => t.postId === p.id),
    }));
  }

  async getPost(userId: number, id: number): Promise<(Post & { tweets: Tweet[] }) | undefined> {
    const [post] = await db.select().from(posts).where(and(eq(posts.id, id), eq(posts.userId, userId)));
    if (!post) return undefined;
    const postTweets = await db.select().from(tweets).where(and(eq(tweets.postId, id), eq(tweets.userId, userId))).orderBy(tweets.position);
    return { ...post, tweets: postTweets };
  }

  async createPost(userId: number, post: InsertPost, tweetData: InsertTweet[]): Promise<Post & { tweets: Tweet[] }> {
    const [newPost] = await db.insert(posts).values({ ...post, userId }).returning();
    const insertedTweets: Tweet[] = [];
    for (const t of tweetData) {
      const [tweet] = await db.insert(tweets).values({ ...t, postId: newPost.id, userId }).returning();
      insertedTweets.push(tweet);
    }
    return { ...newPost, tweets: insertedTweets };
  }

  async updatePost(userId: number, id: number, post: Partial<InsertPost>): Promise<Post | undefined> {
    const [result] = await db.update(posts)
      .set({ ...post, userId, updatedAt: new Date() })
      .where(and(eq(posts.id, id), eq(posts.userId, userId)))
      .returning();
    return result;
  }

  async updatePostStatus(userId: number, id: number, status: string, scheduledAt?: string): Promise<Post | undefined> {
    const updates: any = { status, updatedAt: new Date() };
    if (scheduledAt) updates.scheduledAt = new Date(scheduledAt);
    if (status === "posted") updates.postedAt = new Date();
    const [result] = await db.update(posts)
      .set(updates)
      .where(and(eq(posts.id, id), eq(posts.userId, userId)))
      .returning();
    return result;
  }

  async deletePost(userId: number, id: number): Promise<boolean> {
    const [owned] = await db.select({ id: posts.id }).from(posts).where(and(eq(posts.id, id), eq(posts.userId, userId)));
    if (!owned) return false;
    await db.delete(tweets).where(and(eq(tweets.postId, id), eq(tweets.userId, userId)));
    await db.delete(posts).where(eq(posts.id, id));
    return true;
  }

  async getIdeas(userId: number): Promise<Idea[]> {
    return db.select().from(ideas).where(eq(ideas.userId, userId)).orderBy(desc(ideas.createdAt));
  }

  async getIdea(userId: number, id: number): Promise<Idea | undefined> {
    const [result] = await db.select().from(ideas).where(and(eq(ideas.id, id), eq(ideas.userId, userId)));
    return result;
  }

  async createIdea(userId: number, idea: InsertIdea): Promise<Idea> {
    const [result] = await db.insert(ideas).values({ ...idea, userId }).returning();
    return result;
  }

  async updateIdea(userId: number, id: number, idea: Partial<InsertIdea>): Promise<Idea | undefined> {
    const [result] = await db.update(ideas)
      .set({ ...idea, userId })
      .where(and(eq(ideas.id, id), eq(ideas.userId, userId)))
      .returning();
    return result;
  }

  async deleteIdea(userId: number, id: number): Promise<boolean> {
    const deleted = await db.delete(ideas).where(and(eq(ideas.id, id), eq(ideas.userId, userId))).returning({ id: ideas.id });
    return deleted.length > 0;
  }

  async getTemplates(userId: number): Promise<Template[]> {
    return db.select().from(templates).where(eq(templates.userId, userId)).orderBy(templates.id);
  }

  async createTemplate(userId: number, template: InsertTemplate): Promise<Template> {
    const [result] = await db.insert(templates).values({ ...template, userId }).returning();
    return result;
  }

  async getAnalyticsSummary(userId: number): Promise<any> {
    const allPosts = await this.getPosts(userId);
    const allAnalytics = await db.select().from(analytics).where(eq(analytics.userId, userId));
    const recentUsage = await this.getAiUsageLogsAll(userId, 30);

    const totalImpressions = allAnalytics.reduce((s, a) => s + (a.impressions || 0), 0);
    const totalLikes = allAnalytics.reduce((s, a) => s + (a.likes || 0), 0);
    const totalReplies = allAnalytics.reduce((s, a) => s + (a.replies || 0), 0);
    const totalRetweets = allAnalytics.reduce((s, a) => s + (a.retweets || 0), 0);
    const totalBookmarks = allAnalytics.reduce((s, a) => s + (a.bookmarks || 0), 0);

    const pillarList = await this.getPillars(userId);
    const byPillar = pillarList.map((p) => {
      const pillarPosts = allPosts.filter((post) => post.pillarId === p.id);
      const pillarAnalytics = allAnalytics.filter((a) =>
        pillarPosts.some((post) => post.id === a.postId)
      );
      return {
        pillar: p.name.split(" ")[0],
        color: p.color,
        count: pillarPosts.length,
        impressions: pillarAnalytics.reduce((s, a) => s + (a.impressions || 0), 0),
      };
    });

    const platforms = ["x", "threads", "both"];
    const byPlatform = platforms.map((platform) => {
      const platPosts = allPosts.filter((p) => p.targetPlatform === platform);
      const platAnalytics = allAnalytics.filter((a) =>
        platPosts.some((post) => post.id === a.postId)
      );
      return {
        platform,
        count: platPosts.length,
        impressions: platAnalytics.reduce((s, a) => s + (a.impressions || 0), 0),
        likes: platAnalytics.reduce((s, a) => s + (a.likes || 0), 0),
      };
    });

    const topPosts = allPosts
      .map((p) => {
        const postAnalytics = allAnalytics.filter((a) => a.postId === p.id);
        return { ...p, analytics: postAnalytics };
      })
      .sort((a, b) => {
        const aImpressions = a.analytics.reduce((s, an) => s + (an.impressions || 0), 0);
        const bImpressions = b.analytics.reduce((s, an) => s + (an.impressions || 0), 0);
        return bImpressions - aImpressions;
      })
      .slice(0, 5);

    return {
      totalPosts: allPosts.length,
      totalImpressions,
      totalLikes,
      totalReplies,
      totalRetweets,
      totalBookmarks,
      byPillar,
      byPlatform,
      topPosts,
      recentUsage,
    };
  }

  async createAnalytics(userId: number, entry: InsertAnalytics): Promise<Analytics> {
    const [result] = await db.insert(analytics).values({ ...entry, userId }).returning();
    return result;
  }

  async upsertAnalytics(
    postId: number,
    platform: string,
    data: { impressions: number; likes: number; retweets: number; replies: number; quotes: number; bookmarks: number; views: number },
  ): Promise<void> {
    const [post] = await db.select({ userId: posts.userId }).from(posts).where(eq(posts.id, postId));
    if (!post?.userId) return;

    // Delete existing x_api record for this post+platform, then insert fresh.
    await db.delete(analytics).where(
      and(
        eq(analytics.postId, postId),
        eq(analytics.platform, platform),
        eq(analytics.source, "x_api"),
        eq(analytics.userId, post.userId),
      ),
    );
    await db.insert(analytics).values({
      userId: post.userId,
      postId,
      platform,
      source: "x_api",
      ...data,
    });
  }

  async createAiUsageLog(log: InsertAiUsageLog): Promise<AiUsageLog> {
    const [result] = await db.insert(aiUsageLog).values(log).returning();
    return result;
  }

  async getAiUsageLogs(userId: number): Promise<AiUsageLog[]> {
    return db.select().from(aiUsageLog).where(eq(aiUsageLog.userId, userId)).orderBy(desc(aiUsageLog.createdAt)).limit(50);
  }

  async getAiUsageLogsAll(userId: number, days = 30): Promise<AiUsageLog[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return db.select().from(aiUsageLog)
      .where(and(eq(aiUsageLog.userId, userId), sql`${aiUsageLog.createdAt} >= ${since}`))
      .orderBy(desc(aiUsageLog.createdAt));
  }

  async getArticles(userId: number): Promise<Article[]> {
    return db.select().from(articles).where(eq(articles.userId, userId)).orderBy(desc(articles.createdAt));
  }

  async getArticle(userId: number, id: number): Promise<Article | undefined> {
    const [result] = await db.select().from(articles).where(and(eq(articles.id, id), eq(articles.userId, userId)));
    return result;
  }

  async createArticle(userId: number, article: InsertArticle): Promise<Article> {
    const [result] = await db.insert(articles).values({ ...article, userId }).returning();
    return result;
  }

  async updateArticle(userId: number, id: number, article: Partial<InsertArticle>): Promise<Article | undefined> {
    const [result] = await db.update(articles)
      .set({ ...article, userId, updatedAt: new Date() })
      .where(and(eq(articles.id, id), eq(articles.userId, userId)))
      .returning();
    return result;
  }

  async deleteArticle(userId: number, id: number): Promise<boolean> {
    const deleted = await db.delete(articles).where(and(eq(articles.id, id), eq(articles.userId, userId))).returning({ id: articles.id });
    return deleted.length > 0;
  }

  async getReferences(userId: number): Promise<Reference[]> {
    return db.select().from(references).where(eq(references.userId, userId)).orderBy(desc(references.createdAt));
  }

  async getReference(userId: number, id: number): Promise<Reference | undefined> {
    const [result] = await db.select().from(references).where(and(eq(references.id, id), eq(references.userId, userId)));
    return result;
  }

  async createReference(userId: number, ref: InsertReference): Promise<Reference> {
    const [result] = await db.insert(references).values({ ...ref, userId }).returning();
    return result;
  }

  async updateReference(userId: number, id: number, ref: Partial<InsertReference>): Promise<Reference | undefined> {
    const [result] = await db.update(references)
      .set({ ...ref, userId })
      .where(and(eq(references.id, id), eq(references.userId, userId)))
      .returning();
    return result;
  }

  async deleteReference(userId: number, id: number): Promise<boolean> {
    const [owned] = await db.select({ id: references.id }).from(references).where(and(eq(references.id, id), eq(references.userId, userId)));
    if (!owned) return false;
    await db.delete(referencePosts).where(and(eq(referencePosts.referenceId, id), eq(referencePosts.userId, userId)));
    await db.delete(referenceContent).where(and(eq(referenceContent.referenceId, id), eq(referenceContent.userId, userId)));
    await db.delete(references).where(eq(references.id, id));
    return true;
  }

  async getReferencesByBatch(userId: number, batchId: string): Promise<Reference[]> {
    return db.select().from(references).where(and(eq(references.userId, userId), eq(references.batchId, batchId))).orderBy(desc(references.createdAt));
  }

  async getStyleProfiles(userId: number): Promise<StyleProfile[]> {
    return db.select().from(styleProfiles).where(eq(styleProfiles.userId, userId)).orderBy(desc(styleProfiles.createdAt));
  }

  async getStyleProfile(userId: number, id: number): Promise<StyleProfile | undefined> {
    const [result] = await db.select().from(styleProfiles).where(and(eq(styleProfiles.id, id), eq(styleProfiles.userId, userId)));
    return result;
  }

  async createStyleProfile(userId: number, profile: InsertStyleProfile): Promise<StyleProfile> {
    const [result] = await db.insert(styleProfiles).values({ ...profile, userId }).returning();
    return result;
  }

  async updateStyleProfile(userId: number, id: number, profile: Partial<InsertStyleProfile>): Promise<StyleProfile | undefined> {
    const [result] = await db.update(styleProfiles)
      .set({ ...profile, userId })
      .where(and(eq(styleProfiles.id, id), eq(styleProfiles.userId, userId)))
      .returning();
    return result;
  }

  async deleteStyleProfile(userId: number, id: number): Promise<boolean> {
    const deleted = await db.delete(styleProfiles).where(and(eq(styleProfiles.id, id), eq(styleProfiles.userId, userId))).returning({ id: styleProfiles.id });
    return deleted.length > 0;
  }

  async incrementStyleUsage(userId: number, id: number): Promise<void> {
    await db.update(styleProfiles)
      .set({ usageCount: sql`${styleProfiles.usageCount} + 1`, userId })
      .where(and(eq(styleProfiles.id, id), eq(styleProfiles.userId, userId)));
  }

  async createReferenceContent(userId: number, rc: InsertReferenceContent): Promise<ReferenceContent> {
    const [result] = await db.insert(referenceContent).values({ ...rc, userId }).returning();
    return result;
  }

  async getDiscoveredIdeas(userId: number, batchId?: string): Promise<DiscoveredIdea[]> {
    if (batchId) {
      return db.select().from(discoveredIdeas).where(and(eq(discoveredIdeas.userId, userId), eq(discoveredIdeas.batchId, batchId))).orderBy(discoveredIdeas.rank);
    }
    return db.select().from(discoveredIdeas).where(eq(discoveredIdeas.userId, userId)).orderBy(desc(discoveredIdeas.discoveredAt), discoveredIdeas.rank).limit(50);
  }

  async createDiscoveredIdeas(userId: number, ideaList: InsertDiscoveredIdea[]): Promise<DiscoveredIdea[]> {
    if (ideaList.length === 0) return [];
    const results: DiscoveredIdea[] = [];
    for (const idea of ideaList) {
      const [result] = await db.insert(discoveredIdeas).values({ ...idea, userId }).returning();
      results.push(result);
    }
    return results;
  }

  async updateDiscoveredIdeaStatus(userId: number, id: number, status: string): Promise<DiscoveredIdea | undefined> {
    const [result] = await db.update(discoveredIdeas)
      .set({ status, userId })
      .where(and(eq(discoveredIdeas.id, id), eq(discoveredIdeas.userId, userId)))
      .returning();
    return result;
  }

  async getDiscoverySettings(): Promise<DiscoverySettings> {
    const [existing] = await db.select().from(discoverySettings).limit(1);
    if (existing) return existing;
    const [created] = await db.insert(discoverySettings).values({}).returning();
    return created;
  }

  async updateDiscoverySettings(settings: Partial<DiscoverySettings>): Promise<DiscoverySettings> {
    const existing = await this.getDiscoverySettings();
    const [result] = await db.update(discoverySettings)
      .set({ ...settings, updatedAt: new Date() })
      .where(eq(discoverySettings.id, existing.id))
      .returning();
    return result;
  }

  async getViralScores(userId: number, postId?: number, articleId?: number): Promise<ViralScore[]> {
    if (postId) {
      return db.select().from(viralScores).where(and(eq(viralScores.userId, userId), eq(viralScores.postId, postId))).orderBy(viralScores.version);
    }
    if (articleId) {
      return db.select().from(viralScores).where(and(eq(viralScores.userId, userId), eq(viralScores.articleId, articleId))).orderBy(viralScores.version);
    }
    return db.select().from(viralScores).where(eq(viralScores.userId, userId)).orderBy(desc(viralScores.createdAt)).limit(20);
  }

  async createViralScore(userId: number, score: InsertViralScore): Promise<ViralScore> {
    const [result] = await db.insert(viralScores).values({ ...score, userId }).returning();
    return result;
  }

  async getMonitoredAccounts(userId: number): Promise<MonitoredAccount[]> {
    return db.select().from(monitoredAccounts).where(eq(monitoredAccounts.userId, userId)).orderBy(monitoredAccounts.platform, monitoredAccounts.username);
  }

  async createMonitoredAccount(userId: number, account: InsertMonitoredAccount): Promise<MonitoredAccount> {
    const [result] = await db.insert(monitoredAccounts).values({ ...account, userId }).returning();
    return result;
  }

  async deleteMonitoredAccount(userId: number, id: number): Promise<boolean> {
    const deleted = await db.delete(monitoredAccounts).where(and(eq(monitoredAccounts.id, id), eq(monitoredAccounts.userId, userId))).returning({ id: monitoredAccounts.id });
    return deleted.length > 0;
  }

  async getRssSources(userId: number): Promise<RssSource[]> {
    return db.select().from(rssSources).where(eq(rssSources.userId, userId)).orderBy(rssSources.name);
  }

  async getRssSourcesWithAutopost(userId: number): Promise<RssSource[]> {
    return db
      .select()
      .from(rssSources)
      .where(and(
        eq(rssSources.userId, userId),
        eq(rssSources.autopost, true),
        eq(rssSources.isActive, true),
      ))
      .orderBy(rssSources.name);
  }

  async createRssSource(userId: number, source: InsertRssSource): Promise<RssSource> {
    const [result] = await db.insert(rssSources).values({ ...source, userId }).returning();
    return result;
  }

  async updateRssSource(userId: number, id: number, data: Partial<InsertRssSource>): Promise<RssSource | undefined> {
    const [result] = await db.update(rssSources)
      .set({ ...data, userId })
      .where(and(eq(rssSources.id, id), eq(rssSources.userId, userId)))
      .returning();
    return result;
  }

  async deleteRssSource(userId: number, id: number): Promise<boolean> {
    const deleted = await db.delete(rssSources).where(and(eq(rssSources.id, id), eq(rssSources.userId, userId))).returning({ id: rssSources.id });
    return deleted.length > 0;
  }

  async getCannedResponses(userId: number): Promise<CannedResponse[]> {
    return db.select().from(cannedResponses).where(eq(cannedResponses.userId, userId)).orderBy(desc(cannedResponses.createdAt));
  }

  async getCannedResponse(userId: number, id: number): Promise<CannedResponse | undefined> {
    const [row] = await db.select().from(cannedResponses).where(and(eq(cannedResponses.id, id), eq(cannedResponses.userId, userId)));
    return row;
  }

  async createCannedResponse(userId: number, data: InsertCannedResponse): Promise<CannedResponse> {
    const [row] = await db.insert(cannedResponses).values({ ...data, userId }).returning();
    return row;
  }

  async updateCannedResponse(userId: number, id: number, data: Partial<InsertCannedResponse>): Promise<CannedResponse | undefined> {
    const [row] = await db.update(cannedResponses)
      .set({ ...data, userId })
      .where(and(eq(cannedResponses.id, id), eq(cannedResponses.userId, userId)))
      .returning();
    return row;
  }

  async deleteCannedResponse(userId: number, id: number): Promise<boolean> {
    const deleted = await db.delete(cannedResponses).where(and(eq(cannedResponses.id, id), eq(cannedResponses.userId, userId))).returning({ id: cannedResponses.id });
    return deleted.length > 0;
  }

  async incrementCannedResponseUsage(userId: number, id: number): Promise<CannedResponse | undefined> {
    const cur = await this.getCannedResponse(userId, id);
    if (!cur) return undefined;
    const [row] = await db
      .update(cannedResponses)
      .set({ usageCount: (cur.usageCount ?? 0) + 1, userId })
      .where(and(eq(cannedResponses.id, id), eq(cannedResponses.userId, userId)))
      .returning();
    return row;
  }

  async getYoutubeChannels(userId: number): Promise<YoutubeChannel[]> {
    return db.select().from(youtubeChannels).where(eq(youtubeChannels.userId, userId)).orderBy(desc(youtubeChannels.createdAt));
  }

  async getActiveYoutubeChannels(userId: number): Promise<YoutubeChannel[]> {
    return db
      .select()
      .from(youtubeChannels)
      .where(and(eq(youtubeChannels.userId, userId), eq(youtubeChannels.isActive, true)))
      .orderBy(youtubeChannels.channelName);
  }

  async getAllActiveYoutubeChannels(): Promise<YoutubeChannel[]> {
    return db
      .select()
      .from(youtubeChannels)
      .where(eq(youtubeChannels.isActive, true))
      .orderBy(youtubeChannels.channelName);
  }

  async createYoutubeChannel(userId: number, data: InsertYoutubeChannel): Promise<YoutubeChannel> {
    const [row] = await db.insert(youtubeChannels).values({ ...data, userId }).returning();
    return row;
  }

  async updateYoutubeChannel(userId: number, id: number, data: Partial<InsertYoutubeChannel>): Promise<YoutubeChannel | undefined> {
    const [row] = await db.update(youtubeChannels)
      .set({ ...data, userId })
      .where(and(eq(youtubeChannels.id, id), eq(youtubeChannels.userId, userId)))
      .returning();
    return row;
  }

  async deleteYoutubeChannel(userId: number, id: number): Promise<boolean> {
    const deleted = await db.delete(youtubeChannels).where(and(eq(youtubeChannels.id, id), eq(youtubeChannels.userId, userId))).returning({ id: youtubeChannels.id });
    return deleted.length > 0;
  }

  async getConnectedAccounts(userId: number): Promise<ConnectedAccount[]> {
    const rows = await db.select().from(connectedAccounts).where(eq(connectedAccounts.userId, userId)).orderBy(connectedAccounts.platform);
    return rows.map(decryptConnectedAccount);
  }

  async getConnectedAccount(platform: string): Promise<ConnectedAccount | undefined> {
    const [result] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.platform, platform));
    return result ? decryptConnectedAccount(result) : undefined;
  }

  async getConnectedAccountForOwner(platform: string, ownerId: number): Promise<ConnectedAccount | undefined> {
    const [result] = await db
      .select()
      .from(connectedAccounts)
      .where(and(eq(connectedAccounts.platform, platform), eq(connectedAccounts.userId, ownerId)));
    return result ? decryptConnectedAccount(result) : undefined;
  }

  async upsertConnectedAccount(account: InsertConnectedAccount): Promise<ConnectedAccount> {
    const encrypted: InsertConnectedAccount = {
      ...account,
      // Encrypt at the storage boundary. isEncrypted() guards against double-
      // encryption if a caller already passed through ensureEncrypted().
      accessToken: ensureEncrypted(account.accessToken) ?? undefined,
      refreshToken: ensureEncrypted(account.refreshToken) ?? undefined,
    };
    const existing =
      encrypted.userId != null
        ? await db
            .select({ id: connectedAccounts.id })
            .from(connectedAccounts)
            .where(and(eq(connectedAccounts.platform, encrypted.platform), eq(connectedAccounts.userId, encrypted.userId)))
            .limit(1)
        : await db
            .select({ id: connectedAccounts.id })
            .from(connectedAccounts)
            .where(eq(connectedAccounts.platform, encrypted.platform))
            .limit(1);
    if (existing.length > 0) {
      const [result] = await db
        .update(connectedAccounts)
        .set(encrypted)
        .where(eq(connectedAccounts.id, existing[0].id))
        .returning();
      return decryptConnectedAccount(result);
    }
    const [result] = await db.insert(connectedAccounts).values(encrypted).returning();
    return decryptConnectedAccount(result);
  }

  async deleteConnectedAccount(userId: number, id: number): Promise<boolean> {
    const deleted = await db.delete(connectedAccounts).where(and(eq(connectedAccounts.id, id), eq(connectedAccounts.userId, userId))).returning({ id: connectedAccounts.id });
    return deleted.length > 0;
  }
}

export const storage = new DatabaseStorage();
