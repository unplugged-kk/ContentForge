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
  type DiscoveredIdea, type InsertDiscoveredIdea,
  type ViralScore, type InsertViralScore,
  type MonitoredAccount, type InsertMonitoredAccount,
  type RssSource, type InsertRssSource,
  type DiscoverySettings,
  pillars, posts, tweets, ideas, templates, analytics, aiUsageLog,
  articles, references, referencePosts, discoveredIdeas, discoverySettings,
  viralScores, monitoredAccounts, rssSources,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, and, gte } from "drizzle-orm";

export interface IStorage {
  getPillars(): Promise<Pillar[]>;
  createPillar(pillar: InsertPillar): Promise<Pillar>;

  getPosts(): Promise<(Post & { tweets: Tweet[] })[]>;
  getPost(id: number): Promise<(Post & { tweets: Tweet[] }) | undefined>;
  createPost(post: InsertPost, tweetData: InsertTweet[]): Promise<Post & { tweets: Tweet[] }>;
  updatePost(id: number, post: Partial<InsertPost>): Promise<Post | undefined>;
  updatePostStatus(id: number, status: string, scheduledAt?: string): Promise<Post | undefined>;
  deletePost(id: number): Promise<void>;

  getIdeas(): Promise<Idea[]>;
  createIdea(idea: InsertIdea): Promise<Idea>;
  updateIdea(id: number, idea: Partial<InsertIdea>): Promise<Idea | undefined>;
  deleteIdea(id: number): Promise<void>;

  getTemplates(): Promise<Template[]>;
  createTemplate(template: InsertTemplate): Promise<Template>;

  getAnalyticsSummary(): Promise<any>;
  createAnalytics(entry: InsertAnalytics): Promise<Analytics>;

  createAiUsageLog(log: InsertAiUsageLog): Promise<AiUsageLog>;
  getAiUsageLogs(): Promise<AiUsageLog[]>;

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
  createRssSource(source: InsertRssSource): Promise<RssSource>;
  deleteRssSource(id: number): Promise<void>;
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

  async createPost(post: InsertPost, tweetData: InsertTweet[]): Promise<Post & { tweets: Tweet[] }> {
    const [newPost] = await db.insert(posts).values(post).returning();
    const insertedTweets: Tweet[] = [];
    for (const t of tweetData) {
      const [tweet] = await db.insert(tweets).values({ ...t, postId: newPost.id }).returning();
      insertedTweets.push(tweet);
    }
    return { ...newPost, tweets: insertedTweets };
  }

  async updatePost(id: number, post: Partial<InsertPost>): Promise<Post | undefined> {
    const [result] = await db.update(posts).set({ ...post, updatedAt: new Date() }).where(eq(posts.id, id)).returning();
    return result;
  }

  async updatePostStatus(id: number, status: string, scheduledAt?: string): Promise<Post | undefined> {
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

  async createAiUsageLog(log: InsertAiUsageLog): Promise<AiUsageLog> {
    const [result] = await db.insert(aiUsageLog).values(log).returning();
    return result;
  }

  async getAiUsageLogs(): Promise<AiUsageLog[]> {
    return db.select().from(aiUsageLog).orderBy(desc(aiUsageLog.createdAt)).limit(50);
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
    await db.delete(references).where(eq(references.id, id));
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

  async createRssSource(source: InsertRssSource): Promise<RssSource> {
    const [result] = await db.insert(rssSources).values(source).returning();
    return result;
  }

  async deleteRssSource(id: number): Promise<void> {
    await db.delete(rssSources).where(eq(rssSources.id, id));
  }
}

export const storage = new DatabaseStorage();
