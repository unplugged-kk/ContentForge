import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, boolean, timestamp, jsonb, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const pillars = pgTable("pillars", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 7 }),
});

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  pillarId: integer("pillar_id"),
  postType: varchar("post_type", { length: 20 }).notNull(),
  tone: varchar("tone", { length: 20 }),
  targetPlatform: varchar("target_platform", { length: 20 }).default("both"),
  status: varchar("status", { length: 20 }).default("draft"),
  scheduledAt: timestamp("scheduled_at"),
  postedAt: timestamp("posted_at"),
  aiModel: varchar("ai_model", { length: 100 }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const tweets = pgTable("tweets", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull(),
  position: integer("position").notNull(),
  content: text("content").notNull(),
  charCount: integer("char_count"),
});

export const ideas = pgTable("ideas", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 280 }).notNull(),
  notes: text("notes"),
  pillarId: integer("pillar_id"),
  isExpanded: boolean("is_expanded").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const templates = pgTable("templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  pattern: text("pattern").notNull(),
  postType: varchar("post_type", { length: 20 }),
  pillarId: integer("pillar_id"),
});

export const analytics = pgTable("analytics", {
  id: serial("id").primaryKey(),
  postId: integer("post_id"),
  platform: varchar("platform", { length: 20 }),
  impressions: integer("impressions").default(0),
  likes: integer("likes").default(0),
  retweets: integer("retweets").default(0),
  replies: integer("replies").default(0),
  quotes: integer("quotes").default(0),
  bookmarks: integer("bookmarks").default(0),
  views: integer("views").default(0),
  source: varchar("source", { length: 20 }).default("manual"),
  recordedAt: timestamp("recorded_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const aiUsageLog = pgTable("ai_usage_log", {
  id: serial("id").primaryKey(),
  model: varchar("model", { length: 100 }).notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  latencyMs: integer("latency_ms"),
  feature: varchar("feature", { length: 50 }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const articles = pgTable("articles", {
  id: serial("id").primaryKey(),
  postId: integer("post_id"),
  title: varchar("title", { length: 200 }).notNull(),
  subtitle: varchar("subtitle", { length: 300 }),
  coverImageUrl: text("cover_image_url"),
  contentJson: jsonb("content_json").notNull().default({}),
  contentHtml: text("content_html"),
  contentMarkdown: text("content_markdown"),
  wordCount: integer("word_count").default(0),
  estimatedReadMinutes: integer("estimated_read_minutes").default(0),
  seoDescription: varchar("seo_description", { length: 200 }),
  articleTemplate: varchar("article_template", { length: 50 }),
  status: varchar("status", { length: 20 }).default("draft"),
  pillarId: integer("pillar_id"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const references = pgTable("references", {
  id: serial("id").primaryKey(),
  sourceUrl: text("source_url"),
  sourceType: varchar("source_type", { length: 30 }),
  sourcePlatform: varchar("source_platform", { length: 30 }),
  sourceAuthorUsername: varchar("source_author_username", { length: 200 }),
  sourceAuthorDisplayName: varchar("source_author_display_name", { length: 300 }),
  sourceAuthorFollowerCount: integer("source_author_follower_count"),
  rawContent: text("raw_content"),
  rawContentHtml: text("raw_content_html"),
  screenshotUrls: text("screenshot_urls").array(),
  analysisJson: jsonb("analysis_json").notNull().default({}),
  styleAnalysisJson: jsonb("style_analysis_json"),
  title: varchar("title", { length: 500 }),
  author: varchar("author", { length: 200 }),
  sourceEngagementMetrics: jsonb("source_engagement_metrics"),
  wordCount: integer("word_count"),
  tags: text("tags").array(),
  pillarId: integer("pillar_id"),
  isBookmarked: boolean("is_bookmarked").default(false),
  isStyleSaved: boolean("is_style_saved").default(false),
  notes: text("notes"),
  batchId: varchar("batch_id", { length: 50 }),
  batchSynthesisJson: jsonb("batch_synthesis_json"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const styleProfiles = pgTable("style_profiles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  sourceReferenceId: integer("source_reference_id"),
  styleJson: jsonb("style_json").notNull().default({}),
  stylePromptSnippet: text("style_prompt_snippet").notNull(),
  usageCount: integer("usage_count").default(0),
  isFavorite: boolean("is_favorite").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const referenceContent = pgTable("reference_content", {
  id: serial("id").primaryKey(),
  referenceId: integer("reference_id"),
  postId: integer("post_id"),
  articleId: integer("article_id"),
  creationAction: varchar("creation_action", { length: 50 }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const referencePosts = pgTable("reference_posts", {
  id: serial("id").primaryKey(),
  referenceId: integer("reference_id"),
  postId: integer("post_id"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const discoveredIdeas = pgTable("discovered_ideas", {
  id: serial("id").primaryKey(),
  rank: integer("rank"),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  summary: text("summary"),
  sourceInspiration: text("source_inspiration"),
  sourceUrl: text("source_url"),
  sourceType: varchar("source_type", { length: 30 }).default("rss"),
  category: varchar("category", { length: 30 }),
  contentTypeSuggestion: varchar("content_type_suggestion", { length: 30 }),
  contentAngles: text("content_angles").array(),
  pillarId: integer("pillar_id"),
  viralScore: decimal("viral_score", { precision: 3, scale: 1 }),
  viralReasoning: text("viral_reasoning"),
  valueProposition: text("value_proposition"),
  uniqueAngle: text("unique_angle"),
  timeliness: varchar("timeliness", { length: 30 }),
  targetAudience: text("target_audience"),
  suggestedHook: text("suggested_hook"),
  hashtagSuggestions: text("hashtag_suggestions").array(),
  isBookmarked: boolean("is_bookmarked").default(false),
  status: varchar("status", { length: 20 }).default("new"),
  batchId: varchar("batch_id", { length: 50 }),
  discoveredAt: timestamp("discovered_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const discoverySettings = pgTable("discovery_settings", {
  id: serial("id").primaryKey(),
  autoRefreshFrequency: varchar("auto_refresh_frequency", { length: 20 }).default("daily"),
  customKeywords: text("custom_keywords").array().default(sql`'{}'::text[]`),
  monitoredXAccounts: text("monitored_x_accounts").array().default(sql`'{}'::text[]`),
  enabledSources: jsonb("enabled_sources").default({ hackernews: true, reddit: true, rss: true, github: true }),
  minViralScore: decimal("min_viral_score", { precision: 3, scale: 1 }).default("5.0"),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const viralScores = pgTable("viral_scores", {
  id: serial("id").primaryKey(),
  postId: integer("post_id"),
  articleId: integer("article_id"),
  version: integer("version").notNull().default(1),
  overallScore: decimal("overall_score", { precision: 3, scale: 1 }),
  dimensionScores: jsonb("dimension_scores"),
  improvements: jsonb("improvements"),
  predictedEngagement: jsonb("predicted_engagement"),
  scoredByModel: varchar("scored_by_model", { length: 100 }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const monitoredAccounts = pgTable("monitored_accounts", {
  id: serial("id").primaryKey(),
  platform: varchar("platform", { length: 20 }).notNull(),
  username: varchar("username", { length: 100 }).notNull(),
  displayName: varchar("display_name", { length: 200 }),
  category: varchar("category", { length: 50 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const rssSources = pgTable("rss_sources", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  feedUrl: text("feed_url").notNull(),
  category: varchar("category", { length: 50 }),
  isActive: boolean("is_active").default(true),
  lastFetchedAt: timestamp("last_fetched_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertPillarSchema = createInsertSchema(pillars).omit({ id: true });
export const insertPostSchema = createInsertSchema(posts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTweetSchema = createInsertSchema(tweets).omit({ id: true });
export const insertIdeaSchema = createInsertSchema(ideas).omit({ id: true, createdAt: true });
export const insertTemplateSchema = createInsertSchema(templates).omit({ id: true });
export const insertAnalyticsSchema = createInsertSchema(analytics).omit({ id: true, recordedAt: true });
export const insertAiUsageLogSchema = createInsertSchema(aiUsageLog).omit({ id: true, createdAt: true });
export const insertArticleSchema = createInsertSchema(articles).omit({ id: true, createdAt: true, updatedAt: true });
export const insertReferenceSchema = createInsertSchema(references).omit({ id: true, createdAt: true, updatedAt: true });
export const insertStyleProfileSchema = createInsertSchema(styleProfiles).omit({ id: true, createdAt: true });
export const insertReferenceContentSchema = createInsertSchema(referenceContent).omit({ id: true, createdAt: true });
export const insertDiscoveredIdeaSchema = createInsertSchema(discoveredIdeas).omit({ id: true, discoveredAt: true });
export const insertViralScoreSchema = createInsertSchema(viralScores).omit({ id: true, createdAt: true });
export const insertMonitoredAccountSchema = createInsertSchema(monitoredAccounts).omit({ id: true, createdAt: true });
export const insertRssSourceSchema = createInsertSchema(rssSources).omit({ id: true, createdAt: true });

export type Pillar = typeof pillars.$inferSelect;
export type InsertPillar = z.infer<typeof insertPillarSchema>;
export type Post = typeof posts.$inferSelect;
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Tweet = typeof tweets.$inferSelect;
export type InsertTweet = z.infer<typeof insertTweetSchema>;
export type Idea = typeof ideas.$inferSelect;
export type InsertIdea = z.infer<typeof insertIdeaSchema>;
export type Template = typeof templates.$inferSelect;
export type InsertTemplate = z.infer<typeof insertTemplateSchema>;
export type Analytics = typeof analytics.$inferSelect;
export type InsertAnalytics = z.infer<typeof insertAnalyticsSchema>;
export type AiUsageLog = typeof aiUsageLog.$inferSelect;
export type InsertAiUsageLog = z.infer<typeof insertAiUsageLogSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type Reference = typeof references.$inferSelect;
export type InsertReference = z.infer<typeof insertReferenceSchema>;
export type StyleProfile = typeof styleProfiles.$inferSelect;
export type InsertStyleProfile = z.infer<typeof insertStyleProfileSchema>;
export type ReferenceContent = typeof referenceContent.$inferSelect;
export type InsertReferenceContent = z.infer<typeof insertReferenceContentSchema>;
export type DiscoveredIdea = typeof discoveredIdeas.$inferSelect;
export type InsertDiscoveredIdea = z.infer<typeof insertDiscoveredIdeaSchema>;
export type ViralScore = typeof viralScores.$inferSelect;
export type InsertViralScore = z.infer<typeof insertViralScoreSchema>;
export type MonitoredAccount = typeof monitoredAccounts.$inferSelect;
export type InsertMonitoredAccount = z.infer<typeof insertMonitoredAccountSchema>;
export type RssSource = typeof rssSources.$inferSelect;
export type InsertRssSource = z.infer<typeof insertRssSourceSchema>;
export type DiscoverySettings = typeof discoverySettings.$inferSelect;

export const connectedAccounts = pgTable("connected_accounts", {
  id: serial("id").primaryKey(),
  platform: varchar("platform", { length: 30 }).notNull(),
  username: varchar("username", { length: 200 }),
  displayName: varchar("display_name", { length: 300 }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  isActive: boolean("is_active").default(true),
  profileData: jsonb("profile_data"),
  connectedAt: timestamp("connected_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  lastUsedAt: timestamp("last_used_at"),
});

export const insertConnectedAccountSchema = createInsertSchema(connectedAccounts).omit({ id: true, connectedAt: true });
export type ConnectedAccount = typeof connectedAccounts.$inferSelect;
export type InsertConnectedAccount = z.infer<typeof insertConnectedAccountSchema>;
