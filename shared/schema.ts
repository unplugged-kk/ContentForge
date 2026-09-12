import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, boolean, timestamp, jsonb, decimal, index, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const pillars = pgTable("pillars", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 7 }),
});

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  pillarId: integer("pillar_id"),
  postType: varchar("post_type", { length: 20 }).notNull(),
  tone: varchar("tone", { length: 20 }),
  targetPlatform: varchar("target_platform", { length: 20 }).default("both"),
  status: varchar("status", { length: 20 }).default("draft"),
  scheduledAt: timestamp("scheduled_at"),
  postedAt: timestamp("posted_at"),
  aiModel: varchar("ai_model", { length: 100 }),
  externalIds: jsonb("external_ids").$type<Record<string, string | string[]>>(),
  externalUrls: jsonb("external_urls").$type<Record<string, string | string[]>>(),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").default(0),
  lastRetryAt: timestamp("last_retry_at"),
  autopilot: boolean("autopilot").default(false),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const tweets = pgTable("tweets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  postId: integer("post_id").notNull(),
  position: integer("position").notNull(),
  content: text("content").notNull(),
  charCount: integer("char_count"),
});

export const ideas = pgTable("ideas", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  title: varchar("title", { length: 280 }).notNull(),
  notes: text("notes"),
  pillarId: integer("pillar_id"),
  isExpanded: boolean("is_expanded").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const templates = pgTable("templates", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  name: varchar("name", { length: 200 }).notNull(),
  pattern: text("pattern").notNull(),
  postType: varchar("post_type", { length: 20 }),
  pillarId: integer("pillar_id"),
});

export const analytics = pgTable("analytics", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
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
  userId: integer("user_id"),
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
  userId: integer("user_id"),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const articles = pgTable("articles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
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
  userId: integer("user_id"),
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
  userId: integer("user_id"),
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
  userId: integer("user_id"),
  referenceId: integer("reference_id"),
  postId: integer("post_id"),
  articleId: integer("article_id"),
  creationAction: varchar("creation_action", { length: 50 }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const referencePosts = pgTable("reference_posts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  referenceId: integer("reference_id"),
  postId: integer("post_id"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const discoveredIdeas = pgTable("discovered_ideas", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
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
  userId: integer("user_id"),
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
  userId: integer("user_id"),
  platform: varchar("platform", { length: 20 }).notNull(),
  username: varchar("username", { length: 100 }).notNull(),
  displayName: varchar("display_name", { length: 200 }),
  category: varchar("category", { length: 50 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const rssSources = pgTable("rss_sources", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  name: varchar("name", { length: 200 }).notNull(),
  feedUrl: text("feed_url").notNull(),
  category: varchar("category", { length: 50 }),
  isActive: boolean("is_active").default(true),
  autopost: boolean("autopost").default(false),
  autopostPlatform: varchar("autopost_platform", { length: 20 }).default("x"),
  autopostTone: varchar("autopost_tone", { length: 20 }).default("educational"),
  autopostPostType: varchar("autopost_post_type", { length: 20 }).default("thread"),
  autopostPillarId: integer("autopost_pillar_id"),
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

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).unique(),
  passwordHash: text("password_hash"),
  googleId: varchar("google_id", { length: 255 }).unique(),
  name: varchar("name", { length: 200 }),
  avatar: text("avatar"),
  bio: text("bio"),
  title: varchar("title", { length: 200 }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const userProfile = pgTable("user_profile", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  brandVoice: text("brand_voice"),
  writingStyleNotes: text("writing_style_notes"),
  audienceDescription: text("audience_description"),
  contentGoals: text("content_goals"),
  niche: varchar("niche", { length: 200 }),
  messagingPillars: text("messaging_pillars").array().default(sql`'{}'::text[]`),
  targetPlatforms: text("target_platforms").array().default(sql`'{}'::text[]`),
  postingFrequency: varchar("posting_frequency", { length: 50 }),
  memoryJson: jsonb("memory_json").default({}),
  brandingJson: jsonb("branding_json").default({}),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const generatedImages = pgTable("generated_images", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  prompt: text("prompt").notNull(),
  revisedPrompt: text("revised_prompt"),
  imageUrl: text("image_url").notNull(),
  style: varchar("style", { length: 50 }),
  aspectRatio: varchar("aspect_ratio", { length: 20 }),
  pillarId: integer("pillar_id"),
  postId: integer("post_id"),
  isFavorite: boolean("is_favorite").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserProfileSchema = createInsertSchema(userProfile).omit({ id: true, updatedAt: true });
export const insertGeneratedImageSchema = createInsertSchema(generatedImages).omit({ id: true, createdAt: true });

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UserProfile = typeof userProfile.$inferSelect;
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type GeneratedImage = typeof generatedImages.$inferSelect;
export type InsertGeneratedImage = z.infer<typeof insertGeneratedImageSchema>;

export const connectedAccounts = pgTable("connected_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
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

// ── CONTEXT VAULT ─────────────────────────────────────────────────────────────
export const contextVault = pgTable("context_vault", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  title: varchar("title", { length: 300 }).notNull(),
  content: text("content").notNull(),
  category: varchar("category", { length: 100 }),
  tags: text("tags").array().default(sql`'{}'::text[]`),
  sourceUrl: text("source_url"),
  sourceType: varchar("source_type", { length: 50 }),
  isFavorite: boolean("is_favorite").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertContextVaultSchema = createInsertSchema(contextVault).omit({ id: true, createdAt: true });
export type ContextVaultItem = typeof contextVault.$inferSelect;
export type InsertContextVaultItem = z.infer<typeof insertContextVaultSchema>;

// ── CAROUSELS ─────────────────────────────────────────────────────────────────
export const carousels = pgTable("carousels", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  title: varchar("title", { length: 300 }).notNull(),
  pillarId: integer("pillar_id"),
  slides: jsonb("slides").default([]),
  status: varchar("status", { length: 50 }).default("draft"),
  platform: varchar("platform", { length: 30 }).default("linkedin"),
  backgroundStyle: varchar("background_style", { length: 50 }).default("gradient-blue"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertCarouselSchema = createInsertSchema(carousels).omit({ id: true, createdAt: true });
export type Carousel = typeof carousels.$inferSelect;
export type InsertCarousel = z.infer<typeof insertCarouselSchema>;

// ── CANNED RESPONSES ───────────────────────────────────────────────────────────
export const cannedResponses = pgTable("canned_responses", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content").notNull(),
  category: varchar("category", { length: 50 }).default("general"),
  tags: text("tags").array().default(sql`'{}'::text[]`),
  usageCount: integer("usage_count").default(0),
  isFavorite: boolean("is_favorite").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertCannedResponseSchema = createInsertSchema(cannedResponses).omit({ id: true, createdAt: true });
export type CannedResponse = typeof cannedResponses.$inferSelect;
export type InsertCannedResponse = z.infer<typeof insertCannedResponseSchema>;

// ── YOUTUBE CHANNEL CONNECTOR ─────────────────────────────────────────────────
export const youtubeChannels = pgTable("youtube_channels", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  channelId: varchar("channel_id", { length: 50 }).notNull().unique(),
  channelName: varchar("channel_name", { length: 200 }),
  channelUrl: text("channel_url"),
  isActive: boolean("is_active").default(true),
  lastCheckedAt: timestamp("last_checked_at"),
  lastVideoId: varchar("last_video_id", { length: 30 }),
  autopostPlatform: varchar("autopost_platform", { length: 20 }).default("x"),
  autopostTone: varchar("autopost_tone", { length: 20 }).default("educational"),
  autopostPostType: varchar("autopost_post_type", { length: 20 }).default("thread"),
  autopostPillarId: integer("autopost_pillar_id"),
  requireApproval: boolean("require_approval").default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertYoutubeChannelSchema = createInsertSchema(youtubeChannels).omit({ id: true, createdAt: true });
export type YoutubeChannel = typeof youtubeChannels.$inferSelect;
export type InsertYoutubeChannel = z.infer<typeof insertYoutubeChannelSchema>;

// ── AUDIT LOG ─────────────────────────────────────────────────────────────────
// Append-only log of state-changing HTTP requests. Used by server/middleware/audit.ts.
// userId is nullable because audit rows must survive unauthenticated 401/403 paths.
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  method: varchar("method", { length: 10 }).notNull(),
  path: varchar("path", { length: 512 }).notNull(),
  action: varchar("action", { length: 50 }).notNull(),
  resourceType: varchar("resource_type", { length: 50 }),
  resourceId: varchar("resource_id", { length: 100 }),
  ip: varchar("ip", { length: 64 }),
  userAgent: text("user_agent"),
  bodyHash: varchar("body_hash", { length: 64 }),
  statusCode: integer("status_code").notNull(),
  durationMs: integer("duration_ms").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export type AuditLog = typeof auditLogs.$inferSelect;

// ── RESEARCH DOMAIN (Phase B) ─────────────────────────────────────────────────
// Locked shapes from Wayfinder tickets 03/04: evidence and provenance live on
// ResearchJob; completed jobs and their evidence are immutable; sources are
// referenced by identity, never copied downstream.

export const researchJobs = pgTable(
  "research_jobs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    /** End-to-end correlation id; also the queue correlation id. */
    correlationId: varchar("correlation_id", { length: 100 }).notNull().unique(),
    /** Authoritative idempotency arbiter (Ticket 06 §7). */
    idempotencyKey: varchar("idempotency_key", { length: 300 }).notNull().unique(),
    /** directed | autonomous | human_input */
    kind: varchar("kind", { length: 20 }).notNull().default("directed"),
    query: text("query"),
    /** queued | running | complete | failed */
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    /** Frozen initiation parameters (kind-specific), kept for reproducibility. */
    initiation: jsonb("initiation").notNull().default({}),
    /** Per-provider call diagnostics; never evidence. */
    diagnostics: jsonb("diagnostics").notNull().default([]),
    providerIds: text("provider_ids").array().default(sql`'{}'::text[]`),
    errorClass: varchar("error_class", { length: 30 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [index("research_jobs_status_idx").on(table.status)],
);

export const researchSources = pgTable(
  "research_sources",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    provider: varchar("provider", { length: 50 }).notNull(),
    backend: varchar("backend", { length: 50 }),
    kind: varchar("kind", { length: 50 }).notNull(),
    nativeId: varchar("native_id", { length: 500 }).notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title"),
    author: jsonb("author"),
    publishedAt: timestamp("published_at"),
    retrievedAt: timestamp("retrieved_at").notNull(),
    retrievalMethod: varchar("retrieval_method", { length: 30 }),
    accessClass: varchar("access_class", { length: 30 }),
    providerVersion: varchar("provider_version", { length: 50 }),
    integrationVersion: varchar("integration_version", { length: 50 }),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    excerpt: text("excerpt"),
    metadata: jsonb("metadata").notNull().default({}),
    warnings: text("warnings").array().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("research_sources_job_url_uq").on(table.jobId, table.canonicalUrl),
  ],
);

export const researchEvidence = pgTable(
  "research_evidence",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    /** Null only for `author_statement` evidence (human input, no source). */
    sourceId: integer("source_id"),
    /** excerpt | author_statement */
    kind: varchar("kind", { length: 30 }).notNull().default("excerpt"),
    /** sourced | generated — enforced by the engine (ticket 04 §6). */
    origin: varchar("origin", { length: 20 }).notNull().default("sourced"),
    excerpt: text("excerpt").notNull(),
    /** Content-addressed: identity is (job_id, source_id, excerpt_hash). */
    excerptHash: varchar("excerpt_hash", { length: 64 }).notNull(),
    retrievedAt: timestamp("retrieved_at").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("research_evidence_identity_uq").on(
      table.jobId,
      table.sourceId,
      table.excerptHash,
    ),
  ],
);

export const insertResearchJobSchema = createInsertSchema(researchJobs).omit({
  id: true,
  createdAt: true,
});
export const insertResearchSourceSchema = createInsertSchema(researchSources).omit({
  id: true,
  createdAt: true,
});
export const insertResearchEvidenceSchema = createInsertSchema(researchEvidence).omit({
  id: true,
  createdAt: true,
});

export type ResearchJob = typeof researchJobs.$inferSelect;
export type InsertResearchJob = z.infer<typeof insertResearchJobSchema>;
export type ResearchSource = typeof researchSources.$inferSelect;
export type InsertResearchSource = z.infer<typeof insertResearchSourceSchema>;
export type ResearchEvidence = typeof researchEvidence.$inferSelect;
export type InsertResearchEvidence = z.infer<typeof insertResearchEvidenceSchema>;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

// ── STORY DOMAIN (Phase B) ────────────────────────────────────────────────────
// Locked Ticket 05 §3 / 03 §2: a Story is the reusable unit of editorial meaning
// synthesized from research (or human input). It references its originating
// ResearchJob and that job's evidence BY ID — never copies raw source content.
// Lifecycle is `draft → ready → used | archived`; there is deliberately no kill
// state (killing is Opportunity-level), and `used` is informational so a Story
// keeps spawning formats. `research_job_id` is nullable per the locked model
// (human/imported provenance); the researched path requires a completed job.

export const stories = pgTable(
  "stories",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    /** Originating ResearchJob. FK protects provenance: research cannot be deleted out from under a Story. */
    researchJobId: integer("research_job_id").references(() => researchJobs.id),
    /** researched | human | imported */
    provenance: varchar("provenance", { length: 20 }).notNull().default("researched"),
    /** Working title. */
    title: varchar("title", { length: 500 }).notNull(),
    /** Synthesized thesis/narrative — generated interpretation, never a second evidence store. */
    insightBody: text("insight_body").notNull(),
    /** Marks `insight_body` as generated interpretation (Ticket 04 §6 origin separation). */
    interpretationMarked: boolean("interpretation_marked").notNull().default(true),
    /** Candidate framings offered to Opportunity selection (Ticket 05 §3). */
    angles: jsonb("angles").$type<string[]>().notNull().default([]),
    /** Research evidence IDs this Story rests on. IDs only, never copies (Ticket 03 §2). */
    evidenceRefs: jsonb("evidence_refs").$type<number[]>().notNull().default([]),
    /** draft | ready | used | archived */
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("stories_research_job_idx").on(table.researchJobId),
    index("stories_status_idx").on(table.status),
  ],
);

export const insertStorySchema = createInsertSchema(stories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Story = typeof stories.$inferSelect;
export type InsertStory = z.infer<typeof insertStorySchema>;

// ── CORE CONTENT LIFECYCLE (Phase B) ──────────────────────────────────────────
// Locked chain (Tickets 03/05/06/07):
//   ResearchJob → Story → Opportunity → GenerationJob → Artifact
//              → Schedule (series + occurrences) → Publication → Result
// Ownership flows strictly downward; `format` × `channel` are the only
// core content dimensions and every platform mechanic lives in a channel
// adapter. No channel-specific columns anywhere below.

/**
 * Opportunity — a candidate content direction (Ticket 05 §4). Answers "what can
 * we create from this Story?". A lean selector: it carries no content, no prompt
 * and no model config. Many Opportunities per Story are legitimate (different
 * angles, formats, channels). Killing happens here, never on Story.
 */
export const opportunities = pgTable(
  "opportunities",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    storyId: integer("story_id").notNull().references(() => stories.id),
    /** Content direction / concept. */
    concept: text("concept").notNull(),
    /** What this opportunity is for (e.g. "drive signups", "explain tradeoff"). */
    objective: text("objective").notNull(),
    /** Optional audience/context the angle speaks to. */
    audience: text("audience"),
    /** Generated hook/framing for this angle (Ticket 05 §4). */
    angle: text("angle"),
    /** Content shape: x_post, x_thread, linkedin_post, article, newsletter, … */
    format: varchar("format", { length: 50 }).notNull(),
    /** Distribution target: x, linkedin, web, video_factory, … */
    channel: varchar("channel", { length: 50 }).notNull(),
    /** proposed | selected | killed (Ticket 03 §2). Killing is terminal. */
    status: varchar("status", { length: 20 }).notNull().default("proposed"),
    /** Readiness/direction score; weights stay in the proposer, not the schema. */
    score: decimal("score", { precision: 6, scale: 3 }),
    scoreBreakdown: jsonb("score_breakdown").$type<Record<string, unknown>>().notNull().default({}),
    /** human | autonomous — who proposed it (process treats both identically). */
    proposer: varchar("proposer", { length: 20 }).notNull().default("human"),
    /**
     * Durable idempotency for chat-to-post: a repeated conversational request
     * (same key) reuses this Opportunity instead of creating a parallel one.
     * NULL for everything that did not originate from chat.
     */
    chatKey: varchar("chat_key", { length: 200 }),
    killReason: text("kill_reason"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("opportunities_story_idx").on(table.storyId),
    index("opportunities_status_idx").on(table.status),
    uniqueIndex("opportunities_chat_key_uq").on(table.chatKey),
  ],
);

/**
 * Voice profile — reusable writing identity for generation (CannerAI parity
 * phase 1). A voice is *configuration*, never a second generation engine: it
 * feeds a GenerationPolicy, which is what a GenerationJob snapshots.
 *
 * Deliberately supersedes `user_profile.brand_voice` (a single text column) as
 * the policy input without removing it; legacy rows stay untouched.
 */
export const voices = pgTable(
  "voices",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    /** Stable logical identity; revisions increment `version` (never mutate). */
    voiceKey: varchar("voice_key", { length: 200 }),
    version: integer("version").notNull().default(1),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    /** e.g. "technical, direct, no hype" */
    tone: varchar("tone", { length: 200 }),
    /** Vocabulary preferences/banlist. */
    vocabulary: jsonb("vocabulary").$type<string[]>().notNull().default([]),
    sentenceStyle: varchar("sentence_style", { length: 200 }),
    /** Formatting preferences (line breaks, emoji use, casing…). */
    formatting: jsonb("formatting").$type<Record<string, unknown>>().notNull().default({}),
    doRules: jsonb("do_rules").$type<string[]>().notNull().default([]),
    dontRules: jsonb("dont_rules").$type<string[]>().notNull().default([]),
    /** Reference material (bounded excerpts/notes), never bulk corpora. */
    examples: jsonb("examples").$type<unknown[]>().notNull().default([]),
    /** active | archived */
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("voices_key_version_uq").on(table.voiceKey, table.version),
    index("voices_status_idx").on(table.status),
  ],
);

/**
 * Content template — reusable *structure* consumed by a GenerationPolicy
 * (CannerAI parity phase 1). Data, not a code path per template.
 *
 * Distinct from the legacy `templates` table (pattern + postType + pillarId),
 * which is prior art and stays for the legacy editor.
 */
export const contentTemplates = pgTable(
  "content_templates",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    /** Stable logical identity; revisions increment `version` (never mutate). */
    templateKey: varchar("template_key", { length: 200 }),
    version: integer("version").notNull().default(1),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    supportedFormats: text("supported_formats").array().default(sql`'{}'::text[]`),
    supportedChannels: text("supported_channels").array().default(sql`'{}'::text[]`),
    /** Ordered structural sections, e.g. hook → insight → evidence → takeaway → cta. */
    structure: jsonb("structure").$type<unknown[]>().notNull().default([]),
    /** Declared placeholders the assembler may fill. */
    variables: jsonb("variables").$type<unknown[]>().notNull().default([]),
    /** Structural constraints (max sections, required sections…). */
    constraints: jsonb("constraints").$type<Record<string, unknown>>().notNull().default({}),
    /** Free-form generation instructions appended to the policy prompt. */
    instructions: text("instructions"),
    /** active | archived */
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("content_templates_key_version_uq").on(table.templateKey, table.version),
    index("content_templates_status_idx").on(table.status),
  ],
);

/**
 * Generation policy — the central creation primitive (CannerAI parity phase 1).
 *
 * Immutable, content-addressed revisions: a policy row is never edited, a new
 * one is inserted. `spec_hash` is UNIQUE, so resolving the same effective policy
 * twice reuses the same revision instead of duplicating it, and a later edit
 * (different voice/template/constraints) necessarily produces a new revision.
 * A GenerationJob pins `policy_id` AND snapshots the rendered request, so it can
 * always answer "exactly what produced this Artifact?".
 */
export const generationPolicies = pgTable(
  "generation_policies",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    /** Stable logical identity, e.g. `pol:x_post:x`. */
    policyKey: varchar("policy_key", { length: 200 }).notNull(),
    version: integer("version").notNull().default(1),
    name: varchar("name", { length: 200 }),
    format: varchar("format", { length: 50 }).notNull(),
    channel: varchar("channel", { length: 50 }).notNull(),
    voiceId: integer("voice_id").references(() => voices.id),
    templateId: integer("template_id").references(() => contentTemplates.id),
    objective: text("objective"),
    audience: text("audience"),
    /** Length/structure/CTA/platform constraints resolved for this policy. */
    constraints: jsonb("constraints").$type<Record<string, unknown>>().notNull().default({}),
    /** Model preferences (ids only — providers stay infrastructure). */
    modelPreferences: jsonb("model_preferences").$type<Record<string, unknown>>().notNull().default({}),
    /** Deterministic hash of the resolved spec; the idempotency input. */
    specHash: varchar("spec_hash", { length: 64 }).notNull(),
    /** active | archived */
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("generation_policies_key_version_uq").on(table.policyKey, table.version),
    uniqueIndex("generation_policies_spec_hash_uq").on(table.specHash),
    index("generation_policies_format_channel_idx").on(table.format, table.channel),
  ],
);

/**
 * GenerationJob — one reproducible generation attempt for an Opportunity
 * (Ticket 05 §5). Distinct from Artifact: this records *how* content was made
 * (frozen policy, model, cost, attempts); the Artifact is the resulting content.
 * Regenerations are siblings, never edits. No provider-specific columns.
 */
export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id),
    /** Requested dimensions, copied from the Opportunity at creation time. */
    format: varchar("format", { length: 50 }).notNull(),
    channel: varchar("channel", { length: 50 }).notNull(),
    /** FROZEN policy: the fully rendered effective request for this attempt. */
    policySnapshot: jsonb("policy_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    /** The exact immutable policy revision this attempt was built from. */
    policyId: integer("policy_id").references(() => generationPolicies.id),
    /** (opportunity + policy hash) — the authoritative idempotency arbiter. */
    idempotencyKey: varchar("idempotency_key", { length: 300 }).notNull().unique(),
    /** queued | running | succeeded | failed */
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    attempt: integer("attempt").notNull().default(1),
    attempts: jsonb("attempts").$type<unknown[]>().notNull().default([]),
    /** Model/provider metadata for provenance and future usage accounting. */
    model: varchar("model", { length: 120 }),
    provider: varchar("provider", { length: 60 }),
    cost: decimal("cost", { precision: 12, scale: 6 }),
    /** Regen link: the rejected artifact this attempt supersedes. */
    priorArtifactId: integer("prior_artifact_id"),
    rejectionReason: text("rejection_reason"),
    correlationId: varchar("correlation_id", { length: 100 }).notNull(),
    errorClass: varchar("error_class", { length: 30 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("generation_jobs_opportunity_idx").on(table.opportunityId),
    index("generation_jobs_status_idx").on(table.status),
  ],
);

/**
 * Artifact — the immutable, reviewable content revision (Ticket 05 §6).
 * Content (payload/format/channel/opportunity) is frozen at insert; a database
 * trigger enforces that (see migration 0007). Readiness is the only mutable
 * axis. Any content change is a NEW row linked by `supersedes_id`; approving
 * revision N never approves N+1.
 */
export const artifacts = pgTable(
  "artifacts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    /** Null only for human edits (provenance=human_edit). */
    generationJobId: integer("generation_job_id").references(() => generationJobs.id),
    opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id),
    format: varchar("format", { length: 50 }).notNull(),
    channel: varchar("channel", { length: 50 }).notNull(),
    /** Validated at write against the format's registered payload schema. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** draft | in_review | approved | rejected */
    readiness: varchar("readiness", { length: 20 }).notNull().default("draft"),
    approvedAt: timestamp("approved_at"),
    /** Revision chain — set for every revision after the first. */
    supersedesId: integer("supersedes_id").references((): AnyPgColumn => artifacts.id),
    /** generated | human_edit */
    provenance: varchar("provenance", { length: 20 }).notNull().default("generated"),
    /** MANDATORY attribution snippets (may be empty only with a stated reason). */
    attribution: jsonb("attribution").$type<unknown[]>().notNull().default([]),
    attributionReason: text("attribution_reason"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("artifacts_opportunity_idx").on(table.opportunityId),
    index("artifacts_generation_job_idx").on(table.generationJobId),
    index("artifacts_readiness_idx").on(table.readiness),
    uniqueIndex("artifacts_supersedes_uq").on(table.supersedesId),
  ],
);

/**
 * Schedule — the intent to publish a specific approved Artifact revision, as a
 * recurrence series (Ticket 03 §1, 06). A one-shot is simply `count = 1`.
 * The scheduler owns WHEN; the publication worker owns EXECUTE.
 */
export const schedules = pgTable(
  "schedules",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    /** Pinned to an exact immutable Artifact revision. */
    artifactId: integer("artifact_id").notNull().references(() => artifacts.id),
    channel: varchar("channel", { length: 50 }).notNull(),
    /** RRULE/cron string. A one-shot may use a plain ISO timestamp in `startAt`. */
    recurrence: varchar("recurrence", { length: 200 }),
    timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
    /** Total occurrences for the series (one-shot = 1). */
    count: integer("count").notNull().default(1),
    /** When the first occurrence is due. */
    startAt: timestamp("start_at").notNull(),
    /** active | paused | exhausted | cancelled */
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("schedules_artifact_idx").on(table.artifactId),
    index("schedules_status_idx").on(table.status),
    /** Drives the scheduler's due-schedule scan (status + start_at). */
    index("schedules_due_idx").on(table.status, table.startAt),
  ],
);

/**
 * ScheduleOccurrence — one concrete execution instance materialized from a
 * series (Ticket 03 §1). Each occurrence binds at most one Publication attempt
 * chain. `(schedule_id, occurrence_time)` is unique so materialization is
 * idempotent.
 */
export const scheduleOccurrences = pgTable(
  "schedule_occurrences",
  {
    id: serial("id").primaryKey(),
    scheduleId: integer("schedule_id").notNull().references(() => schedules.id),
    occurrenceTime: timestamp("occurrence_time").notNull(),
    /** pending | enqueued | published | failed | cancelled */
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("schedule_occurrences_schedule_time_uq").on(
      table.scheduleId,
      table.occurrenceTime,
    ),
    index("schedule_occurrences_status_idx").on(table.status),
    /** Drives the scheduler's due-occurrence scan (status + occurrence_time). */
    index("schedule_occurrences_due_idx").on(table.status, table.occurrenceTime),
  ],
);

/**
 * Publication — one distribution attempt binding
 * (schedule × occurrence × exact artifact revision) to a channel adapter
 * (Ticket 03 §1, 07). Durable idempotency + a single-flight publishing lease;
 * unknown outcomes are reconcilable, never assumed successful.
 */
export const publications = pgTable(
  "publications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    scheduleId: integer("schedule_id").notNull().references(() => schedules.id),
    occurrenceId: integer("occurrence_id").notNull().references(() => scheduleOccurrences.id),
    /** Pinned Artifact revision — never "latest". */
    artifactId: integer("artifact_id").notNull().references(() => artifacts.id),
    channel: varchar("channel", { length: 50 }).notNull(),
    /** (schedule + occurrence + artifact revision) — durable idempotency arbiter. */
    idempotencyKey: varchar("idempotency_key", { length: 300 }).notNull().unique(),
    /** scheduled | queued | publishing | published | failed | cancelled */
    state: varchar("state", { length: 20 }).notNull().default("scheduled"),
    attempt: integer("attempt").notNull().default(0),
    /** Single-flight lease (Ticket 06 §10). */
    leaseOwner: varchar("lease_owner", { length: 120 }),
    leaseExpiresAt: timestamp("lease_expires_at"),
    /** Set once the adapter has actually been invoked — gates blind retries. */
    providerCalled: boolean("provider_called").notNull().default(false),
    externalId: varchar("external_id", { length: 200 }),
    lastError: text("last_error"),
    correlationId: varchar("correlation_id", { length: 100 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("publications_schedule_idx").on(table.scheduleId),
    index("publications_artifact_idx").on(table.artifactId),
    index("publications_state_idx").on(table.state),
  ],
);

/**
 * Result — the outcome/proof of exactly one Publication (Ticket 03 §1).
 * `publication_id` is UNIQUE, so "scheduled but unpublished" and "published but
 * not yet recorded" remain distinguishable. Missing analytics never implies the
 * publication did not happen.
 */
export const results = pgTable(
  "results",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    publicationId: integer("publication_id").notNull().unique().references(() => publications.id),
    /** published | failed | unknown */
    outcome: varchar("outcome", { length: 20 }).notNull(),
    externalId: varchar("external_id", { length: 200 }),
    externalUrl: text("external_url"),
    publishedAt: timestamp("published_at"),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
    /** Adapter / analytics source that produced this record. */
    source: varchar("source", { length: 60 }),
    errorClass: varchar("error_class", { length: 30 }),
    errorMessage: text("error_message"),
    correlationId: varchar("correlation_id", { length: 100 }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [index("results_outcome_idx").on(table.outcome)],
);

export const insertOpportunitySchema = createInsertSchema(opportunities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertGenerationJobSchema = createInsertSchema(generationJobs).omit({
  id: true,
  createdAt: true,
});
export const insertArtifactSchema = createInsertSchema(artifacts).omit({ id: true, createdAt: true });
export const insertScheduleSchema = createInsertSchema(schedules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertPublicationSchema = createInsertSchema(publications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertResultSchema = createInsertSchema(results).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertVoiceSchema = createInsertSchema(voices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertContentTemplateSchema = createInsertSchema(contentTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertGenerationPolicySchema = createInsertSchema(generationPolicies).omit({
  id: true,
  createdAt: true,
});

export type Opportunity = typeof opportunities.$inferSelect;
export type InsertOpportunity = z.infer<typeof insertOpportunitySchema>;
export type GenerationJob = typeof generationJobs.$inferSelect;
export type InsertGenerationJob = z.infer<typeof insertGenerationJobSchema>;
export type Artifact = typeof artifacts.$inferSelect;
export type InsertArtifact = z.infer<typeof insertArtifactSchema>;
export type Schedule = typeof schedules.$inferSelect;
export type InsertSchedule = z.infer<typeof insertScheduleSchema>;
export type ScheduleOccurrence = typeof scheduleOccurrences.$inferSelect;
export type Publication = typeof publications.$inferSelect;
export type InsertPublication = z.infer<typeof insertPublicationSchema>;
export type Result = typeof results.$inferSelect;
export type InsertResult = z.infer<typeof insertResultSchema>;
export type Voice = typeof voices.$inferSelect;
export type InsertVoice = z.infer<typeof insertVoiceSchema>;
export type ContentTemplate = typeof contentTemplates.$inferSelect;
export type InsertContentTemplate = z.infer<typeof insertContentTemplateSchema>;
export type GenerationPolicy = typeof generationPolicies.$inferSelect;
export type InsertGenerationPolicy = z.infer<typeof insertGenerationPolicySchema>;
export type OpportunityStatus = "proposed" | "selected" | "killed";
export type ArtifactReadiness = "draft" | "in_review" | "approved" | "rejected";
export type PublicationState =
  | "scheduled"
  | "queued"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";
