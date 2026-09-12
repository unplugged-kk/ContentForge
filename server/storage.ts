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
import { eq, desc, sql, and, gte } from "drizzle-orm";
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
  getPillars(): Promise<Pillar[]>;
  createPillar(pillar: InsertPillar): Promise<Pillar>;

  getPosts(userId: number): Promise<(Post & { tweets: Tweet[] })[]>;
  getPost(userId: number, id: number): Promise<(Post & { tweets: Tweet[] }) | undefined>;
  createPost(userId: number, post: InsertPost, tweetData: InsertTweet[]): Promise<Post & { tweets: Tweet[] }>;
  updatePost(userId: number, id: number, post: Partial<InsertPost>): Promise<Post | undefined>;
  updatePostStatus(userId: number, id: number, status: string, scheduledAt?: string): Promise<Post | undefined>;
  deletePost(userId: number, id: number): Promise<void>;

  getIdeas(): Promise<Idea[]>;
  getIdea(id: number): Promise<Idea | undefined>;
  createIdea(idea: InsertIdea): Promise<Idea>;
  updateIdea(id: number, idea: Partial<InsertIdea>): Promise<Idea | undefined>;
  deleteIdea(id: number): Promise<void>;

  getTemplates(): Promise<Template[]>;
  createTemplate(template: InsertTemplate): Promise<Template>;

  getAnalyticsSummary(): Promise<any>;
  createAnalytics(entry: InsertAnalytics): Promise<Analytics>;
  upsertAnalytics(postId: number, platform: string, data: { impressions: number; likes: number; retweets: number; replies: number; quotes: number; bookmarks: number; views: number }): Promise<void>;

  createAiUsageLog(log: InsertAiUsageLog): Promise<AiUsageLog>;
  getAiUsageLogs(): Promise<AiUsageLog[]>;
  getAiUsageLogsAll(days?: number): Promise<AiUsageLog[]>;

  getArticles(): Promise<Article[]>;
  getArticle(id: number): Promise<Article | undefined>;
  createArticle(article: InsertArticle): Promise<Article>;
  updateArticle(id: number, article: Partial<InsertArticle>): Promise<Article | undefined>;
  deleteArticle(id: number): Promise<void>;

  getReferences(): Promise<Reference[]>;
  getReference(id: number): Promise<Reference | undefined>;
  createReference(ref: InsertReference): Promise<Reference>;
  updateReference(id: number, ref: Partial<InsertReference>): Promise<Reference | undefined>;
  deleteReference(id: number): Promise<void>;
  getReferencesByBatch(batchId: string): Promise<Reference[]>;

  getStyleProfiles(): Promise<StyleProfile[]>;
  getStyleProfile(id: number): Promise<StyleProfile | undefined>;
  createStyleProfile(profile: InsertStyleProfile): Promise<StyleProfile>;
  updateStyleProfile(id: number, profile: Partial<InsertStyleProfile>): Promise<StyleProfile | undefined>;
  deleteStyleProfile(id: number): Promise<void>;
  incrementStyleUsage(id: number): Promise<void>;

  createReferenceContent(rc: InsertReferenceContent): Promise<ReferenceContent>;

  getDiscoveredIdeas(batchId?: string): Promise<DiscoveredIdea[]>;
  createDiscoveredIdeas(ideas: InsertDiscoveredIdea[]): Promise<DiscoveredIdea[]>;
  updateDiscoveredIdeaStatus(id: number, status: string): Promise<DiscoveredIdea | undefined>;

  getDiscoverySettings(): Promise<DiscoverySettings>;
  updateDiscoverySettings(settings: Partial<DiscoverySettings>): Promise<DiscoverySettings>;

  getViralScores(postId?: number, articleId?: number): Promise<ViralScore[]>;
  createViralScore(score: InsertViralScore): Promise<ViralScore>;

  getMonitoredAccounts(): Promise<MonitoredAccount[]>;
  createMonitoredAccount(account: InsertMonitoredAccount): Promise<MonitoredAccount>;
  deleteMonitoredAccount(id: number): Promise<void>;

  getRssSources(): Promise<RssSource[]>;
  getRssSourcesWithAutopost(): Promise<RssSource[]>;
  createRssSource(source: InsertRssSource): Promise<RssSource>;
  updateRssSource(id: number, data: Partial<InsertRssSource>): Promise<RssSource | undefined>;
  deleteRssSource(id: number): Promise<void>;

  getCannedResponses(): Promise<CannedResponse[]>;
  getCannedResponse(id: number): Promise<CannedResponse | undefined>;
  createCannedResponse(data: InsertCannedResponse): Promise<CannedResponse>;
  updateCannedResponse(id: number, data: Partial<InsertCannedResponse>): Promise<CannedResponse | undefined>;
  deleteCannedResponse(id: number): Promise<void>;
  incrementCannedResponseUsage(id: number): Promise<CannedResponse | undefined>;

  getYoutubeChannels(): Promise<YoutubeChannel[]>;
  getActiveYoutubeChannels(): Promise<YoutubeChannel[]>;
  createYoutubeChannel(data: InsertYoutubeChannel): Promise<YoutubeChannel>;
  updateYoutubeChannel(id: number, data: Partial<InsertYoutubeChannel>): Promise<YoutubeChannel | undefined>;
  deleteYoutubeChannel(id: number): Promise<void>;

  getConnectedAccounts(): Promise<ConnectedAccount[]>;
  getConnectedAccount(platform: string): Promise<ConnectedAccount | undefined>;
  upsertConnectedAccount(account: InsertConnectedAccount): Promise<ConnectedAccount>;
  deleteConnectedAccount(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getPillars(): Promise<Pillar[]> {
    return db.select().from(pillars).orderBy(pillars.id);
  }

  async createPillar(pillar: InsertPillar): Promise<Pillar> {
    const [result] = await db.insert(pillars).values(pillar).returning();
    return result;
  }

  async getPosts(): Promise<(Post & { tweets: Tweet[] })[]> {
    const allPosts = await db.select().from(posts).orderBy(desc(posts.createdAt));
    const allTweets = await db.select().from(tweets).orderBy(tweets.postId, tweets.position);
    return allPosts.map((p) => ({
      ...p,
      tweets: allTweets.filter((t) => t.postId === p.id),
    }));
  }

  async getPost(id: number): Promise<(Post & { tweets: Tweet[] }) | undefined> {
    const [post] = await db.select().from(posts).where(eq(posts.id, id));
    if (!post) return undefined;
    const postTweets = await db.select().from(tweets).where(eq(tweets.postId, id)).orderBy(tweets.position);
    return { ...post, tweets: postTweets };
  }

  async createPost(userId: number, post: InsertPost, tweetData: InsertTweet[]): Promise<Post & { tweets: Tweet[] }> {
    const [newPost] = await db.insert(posts).values(post).returning();
    const insertedTweets: Tweet[] = [];
    for (const t of tweetData) {
      const [tweet] = await db.insert(tweets).values({ ...t, postId: newPost.id }).returning();
      insertedTweets.push(tweet);
    }
    return { ...newPost, tweets: insertedTweets };
  }

  async updatePost(userId: number, id: number, post: Partial<InsertPost>): Promise<Post | undefined> {
    const [result] = await db.update(posts).set({ ...post, updatedAt: new Date() }).where(eq(posts.id, id)).returning();
    return result;
  }

  async updatePostStatus(userId: number, id: number, status: string, scheduledAt?: string): Promise<Post | undefined> {
    const updates: any = { status, updatedAt: new Date() };
    if (scheduledAt) updates.scheduledAt = new Date(scheduledAt);
    if (status === "posted") updates.postedAt = new Date();
    const [result] = await db.update(posts).set(updates).where(eq(posts.id, id)).returning();
    return result;
  }

  async deletePost(id: number): Promise<void> {
    await db.delete(tweets).where(eq(tweets.postId, id));
    await db.delete(posts).where(eq(posts.id, id));
  }

  async getIdeas(): Promise<Idea[]> {
    return db.select().from(ideas).orderBy(desc(ideas.createdAt));
  }

  async getIdea(id: number): Promise<Idea | undefined> {
    const [result] = await db.select().from(ideas).where(eq(ideas.id, id));
    return result;
  }

  async createIdea(idea: InsertIdea): Promise<Idea> {
    const [result] = await db.insert(ideas).values(idea).returning();
    return result;
  }

  async updateIdea(id: number, idea: Partial<InsertIdea>): Promise<Idea | undefined> {
    const [result] = await db.update(ideas).set(idea).where(eq(ideas.id, id)).returning();
    return result;
  }

  async deleteIdea(id: number): Promise<void> {
    await db.delete(ideas).where(eq(ideas.id, id));
  }

  async getTemplates(): Promise<Template[]> {
    return db.select().from(templates).orderBy(templates.id);
  }

  async createTemplate(template: InsertTemplate): Promise<Template> {
    const [result] = await db.insert(templates).values(template).returning();
    return result;
  }

  async getAnalyticsSummary(): Promise<any> {
    const allPosts = await this.getPosts();
    const allAnalytics = await db.select().from(analytics);
    const recentUsage = await db.select().from(aiUsageLog).orderBy(desc(aiUsageLog.createdAt)).limit(20);

    const totalImpressions = allAnalytics.reduce((s, a) => s + (a.impressions || 0), 0);
    const totalLikes = allAnalytics.reduce((s, a) => s + (a.likes || 0), 0);
    const totalReplies = allAnalytics.reduce((s, a) => s + (a.replies || 0), 0);
    const totalRetweets = allAnalytics.reduce((s, a) => s + (a.retweets || 0), 0);
    const totalBookmarks = allAnalytics.reduce((s, a) => s + (a.bookmarks || 0), 0);

    const pillarList = await this.getPillars();
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

  async createAnalytics(entry: InsertAnalytics): Promise<Analytics> {
    const [result] = await db.insert(analytics).values(entry).returning();
    return result;
  }

  async upsertAnalytics(
    postId: number,
    platform: string,
    data: { impressions: number; likes: number; retweets: number; replies: number; quotes: number; bookmarks: number; views: number },
  ): Promise<void> {
    // Delete existing x_api record for this post+platform, then insert fresh
    await db.delete(analytics).where(
      and(eq(analytics.postId, postId), eq(analytics.platform, platform), eq(analytics.source, "x_api"))
    );
    await db.insert(analytics).values({
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

  async getAiUsageLogs(): Promise<AiUsageLog[]> {
    return db.select().from(aiUsageLog).orderBy(desc(aiUsageLog.createdAt)).limit(50);
  }

  async getAiUsageLogsAll(days = 30): Promise<AiUsageLog[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return db.select().from(aiUsageLog)
      .where(sql`${aiUsageLog.createdAt} >= ${since}`)
      .orderBy(desc(aiUsageLog.createdAt));
  }

  async getArticles(): Promise<Article[]> {
    return db.select().from(articles).orderBy(desc(articles.createdAt));
  }

  async getArticle(id: number): Promise<Article | undefined> {
    const [result] = await db.select().from(articles).where(eq(articles.id, id));
    return result;
  }

  async createArticle(article: InsertArticle): Promise<Article> {
    const [result] = await db.insert(articles).values(article).returning();
    return result;
  }

  async updateArticle(id: number, article: Partial<InsertArticle>): Promise<Article | undefined> {
    const [result] = await db.update(articles).set({ ...article, updatedAt: new Date() }).where(eq(articles.id, id)).returning();
    return result;
  }

  async deleteArticle(id: number): Promise<void> {
    await db.delete(articles).where(eq(articles.id, id));
  }

  async getReferences(): Promise<Reference[]> {
    return db.select().from(references).orderBy(desc(references.createdAt));
  }

  async getReference(id: number): Promise<Reference | undefined> {
    const [result] = await db.select().from(references).where(eq(references.id, id));
    return result;
  }

  async createReference(ref: InsertReference): Promise<Reference> {
    const [result] = await db.insert(references).values(ref).returning();
    return result;
  }

  async updateReference(id: number, ref: Partial<InsertReference>): Promise<Reference | undefined> {
    const [result] = await db.update(references).set(ref).where(eq(references.id, id)).returning();
    return result;
  }

  async deleteReference(id: number): Promise<void> {
    await db.delete(referencePosts).where(eq(referencePosts.referenceId, id));
    await db.delete(referenceContent).where(eq(referenceContent.referenceId, id));
    await db.delete(references).where(eq(references.id, id));
  }

  async getReferencesByBatch(batchId: string): Promise<Reference[]> {
    return db.select().from(references).where(eq(references.batchId, batchId)).orderBy(desc(references.createdAt));
  }

  async getStyleProfiles(): Promise<StyleProfile[]> {
    return db.select().from(styleProfiles).orderBy(desc(styleProfiles.createdAt));
  }

  async getStyleProfile(id: number): Promise<StyleProfile | undefined> {
    const [result] = await db.select().from(styleProfiles).where(eq(styleProfiles.id, id));
    return result;
  }

  async createStyleProfile(profile: InsertStyleProfile): Promise<StyleProfile> {
    const [result] = await db.insert(styleProfiles).values(profile).returning();
    return result;
  }

  async updateStyleProfile(id: number, profile: Partial<InsertStyleProfile>): Promise<StyleProfile | undefined> {
    const [result] = await db.update(styleProfiles).set(profile).where(eq(styleProfiles.id, id)).returning();
    return result;
  }

  async deleteStyleProfile(id: number): Promise<void> {
    await db.delete(styleProfiles).where(eq(styleProfiles.id, id));
  }

  async incrementStyleUsage(id: number): Promise<void> {
    await db.update(styleProfiles).set({ usageCount: sql`${styleProfiles.usageCount} + 1` }).where(eq(styleProfiles.id, id));
  }

  async createReferenceContent(rc: InsertReferenceContent): Promise<ReferenceContent> {
    const [result] = await db.insert(referenceContent).values(rc).returning();
    return result;
  }

  async getDiscoveredIdeas(batchId?: string): Promise<DiscoveredIdea[]> {
    if (batchId) {
      return db.select().from(discoveredIdeas).where(eq(discoveredIdeas.batchId, batchId)).orderBy(discoveredIdeas.rank);
    }
    return db.select().from(discoveredIdeas).orderBy(desc(discoveredIdeas.discoveredAt), discoveredIdeas.rank).limit(50);
  }

  async createDiscoveredIdeas(ideaList: InsertDiscoveredIdea[]): Promise<DiscoveredIdea[]> {
    if (ideaList.length === 0) return [];
    const results: DiscoveredIdea[] = [];
    for (const idea of ideaList) {
      const [result] = await db.insert(discoveredIdeas).values(idea).returning();
      results.push(result);
    }
    return results;
  }

  async updateDiscoveredIdeaStatus(id: number, status: string): Promise<DiscoveredIdea | undefined> {
    const [result] = await db.update(discoveredIdeas).set({ status }).where(eq(discoveredIdeas.id, id)).returning();
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

  async getViralScores(postId?: number, articleId?: number): Promise<ViralScore[]> {
    if (postId) {
      return db.select().from(viralScores).where(eq(viralScores.postId, postId)).orderBy(viralScores.version);
    }
    if (articleId) {
      return db.select().from(viralScores).where(eq(viralScores.articleId, articleId)).orderBy(viralScores.version);
    }
    return db.select().from(viralScores).orderBy(desc(viralScores.createdAt)).limit(20);
  }

  async createViralScore(score: InsertViralScore): Promise<ViralScore> {
    const [result] = await db.insert(viralScores).values(score).returning();
    return result;
  }

  async getMonitoredAccounts(): Promise<MonitoredAccount[]> {
    return db.select().from(monitoredAccounts).orderBy(monitoredAccounts.platform, monitoredAccounts.username);
  }

  async createMonitoredAccount(account: InsertMonitoredAccount): Promise<MonitoredAccount> {
    const [result] = await db.insert(monitoredAccounts).values(account).returning();
    return result;
  }

  async deleteMonitoredAccount(id: number): Promise<void> {
    await db.delete(monitoredAccounts).where(eq(monitoredAccounts.id, id));
  }

  async getRssSources(): Promise<RssSource[]> {
    return db.select().from(rssSources).orderBy(rssSources.name);
  }

  async getRssSourcesWithAutopost(): Promise<RssSource[]> {
    return db
      .select()
      .from(rssSources)
      .where(and(eq(rssSources.autopost, true), eq(rssSources.isActive, true)))
      .orderBy(rssSources.name);
  }

  async createRssSource(source: InsertRssSource): Promise<RssSource> {
    const [result] = await db.insert(rssSources).values(source).returning();
    return result;
  }

  async updateRssSource(id: number, data: Partial<InsertRssSource>): Promise<RssSource | undefined> {
    const [result] = await db.update(rssSources).set(data).where(eq(rssSources.id, id)).returning();
    return result;
  }

  async deleteRssSource(id: number): Promise<void> {
    await db.delete(rssSources).where(eq(rssSources.id, id));
  }

  async getCannedResponses(): Promise<CannedResponse[]> {
    return db.select().from(cannedResponses).orderBy(desc(cannedResponses.createdAt));
  }

  async getCannedResponse(id: number): Promise<CannedResponse | undefined> {
    const [row] = await db.select().from(cannedResponses).where(eq(cannedResponses.id, id));
    return row;
  }

  async createCannedResponse(data: InsertCannedResponse): Promise<CannedResponse> {
    const [row] = await db.insert(cannedResponses).values(data).returning();
    return row;
  }

  async updateCannedResponse(id: number, data: Partial<InsertCannedResponse>): Promise<CannedResponse | undefined> {
    const [row] = await db.update(cannedResponses).set(data).where(eq(cannedResponses.id, id)).returning();
    return row;
  }

  async deleteCannedResponse(id: number): Promise<void> {
    await db.delete(cannedResponses).where(eq(cannedResponses.id, id));
  }

  async incrementCannedResponseUsage(id: number): Promise<CannedResponse | undefined> {
    const cur = await this.getCannedResponse(id);
    if (!cur) return undefined;
    const [row] = await db
      .update(cannedResponses)
      .set({ usageCount: (cur.usageCount ?? 0) + 1 })
      .where(eq(cannedResponses.id, id))
      .returning();
    return row;
  }

  async getYoutubeChannels(): Promise<YoutubeChannel[]> {
    return db.select().from(youtubeChannels).orderBy(desc(youtubeChannels.createdAt));
  }

  async getActiveYoutubeChannels(): Promise<YoutubeChannel[]> {
    return db
      .select()
      .from(youtubeChannels)
      .where(eq(youtubeChannels.isActive, true))
      .orderBy(youtubeChannels.channelName);
  }

  async createYoutubeChannel(data: InsertYoutubeChannel): Promise<YoutubeChannel> {
    const [row] = await db.insert(youtubeChannels).values(data).returning();
    return row;
  }

  async updateYoutubeChannel(id: number, data: Partial<InsertYoutubeChannel>): Promise<YoutubeChannel | undefined> {
    const [row] = await db.update(youtubeChannels).set(data).where(eq(youtubeChannels.id, id)).returning();
    return row;
  }

  async deleteYoutubeChannel(id: number): Promise<void> {
    await db.delete(youtubeChannels).where(eq(youtubeChannels.id, id));
  }

  async getConnectedAccounts(): Promise<ConnectedAccount[]> {
    const rows = await db.select().from(connectedAccounts).orderBy(connectedAccounts.platform);
    return rows.map(decryptConnectedAccount);
  }

  async getConnectedAccount(platform: string): Promise<ConnectedAccount | undefined> {
    const [result] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.platform, platform));
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
    const existing = await db
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

  async deleteConnectedAccount(id: number): Promise<void> {
    await db.delete(connectedAccounts).where(eq(connectedAccounts.id, id));
  }
}

export const storage = new DatabaseStorage();
