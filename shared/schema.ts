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
  /** Phase 24: inactive references are excluded from analysis selection. */
  isActive: boolean("is_active").default(true),
  /** Phase 24: how this row entered the system (paste, import, connector). */
  provenance: varchar("provenance", { length: 200 }),
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
  // ── Phase 11: real-post style intelligence (observed evidence, not truth) ───
  /** The `style_analyses` run that produced this row (null for legacy/manual rows). */
  analysisId: integer("analysis_id"),
  /** Structured, bounded observation (Ticket 11 §5) — never a raw LLM blob. */
  structuredObservation: jsonb("structured_observation").$type<Record<string, unknown>>().notNull().default({}),
  /** strong | weak | insufficient — see styleConfidenceEnum. */
  confidence: varchar("confidence", { length: 20 }),
  analyzerVersion: varchar("analyzer_version", { length: 40 }),
  schemaVersion: integer("schema_version").default(1),
  /** sha256 of the source content this observation was derived from. */
  sourceContentHash: varchar("source_content_hash", { length: 64 }),
  /** Immutable revision chain (never mutate an existing observation). */
  supersedesId: integer("supersedes_id").references((): AnyPgColumn => styleProfiles.id),
  // ── Phase 24: versioned derived style profile (corpus or single) ───────────
  /** false until explicitly activated; only the active corpus revision enters future assembly. */
  isActive: boolean("is_active").default(false).notNull(),
  /** single = one reference (Phase 11); corpus = frozen multi-reference analysis (Phase 24). */
  kind: varchar("kind", { length: 20 }).default("single").notNull(),
  /** Channel overlay identity (null = global). Never manufactured from unrelated content. */
  channel: varchar("channel", { length: 40 }),
  sampleCount: integer("sample_count").default(1),
  sampleChannels: text("sample_channels").array(),
  /** Algorithm identity (style-analysis-v1). Distinct from analyzerVersion (model wrapper). */
  analysisVersion: varchar("analysis_version", { length: 40 }),
  /** Bounded per-channel overlay snippets; empty when the sample cannot support overlays. */
  channelOverlays: jsonb("channel_overlays").$type<Record<string, unknown>>().notNull().default({}),
});

/**
 * StyleAnalysis (Phase 11) — one reproducible analysis *attempt* against a
 * durable `references` row, mirroring `visual_generations`'s job-lifecycle
 * shape exactly (requested → analyzing → ready | failed). The durable
 * *result* is a `style_profiles` row (`style_profiles.analysis_id`); this
 * table only tracks the attempt, never the observation content itself.
 */
export const styleAnalyses = pgTable(
  "style_analyses",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    /** The authored source content this attempt analyzes (owner-checked at request time). */
    referenceId: integer("reference_id").notNull().references(() => references.id),
    /** requested | analyzing | ready | failed */
    status: varchar("status", { length: 20 }).notNull().default("requested"),
    analyzerVersion: varchar("analyzer_version", { length: 40 }).notNull(),
    /** Frozen request (source content hash + analyzer identity); never business tables. */
    requestSnapshot: jsonb("request_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    /** Authoritative idempotency arbiter — duplicate delivery collapses to ONE row. */
    idempotencyKey: varchar("idempotency_key", { length: 300 }).notNull().unique(),
    attempt: integer("attempt").notNull().default(1),
    errorClass: varchar("error_class", { length: 30 }),
    errorMessage: text("error_message"),
    correlationId: varchar("correlation_id", { length: 100 }).notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("style_analyses_status_idx").on(table.status),
    index("style_analyses_reference_idx").on(table.referenceId),
  ],
);
export type StyleAnalysis = typeof styleAnalyses.$inferSelect;

/**
 * StyleObservation (Phase 24) — one evidence-backed, structured signal produced
 * by a StyleAnalysis. Never an opaque model paragraph. Provenance is the
 * `evidence_reference_ids` set (and optional primary `reference_id`).
 */
export const styleObservations = pgTable(
  "style_observations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    analysisId: integer("analysis_id").notNull().references(() => styleAnalyses.id),
    styleProfileId: integer("style_profile_id").references(() => styleProfiles.id),
    referenceId: integer("reference_id").references(() => references.id),
    category: varchar("category", { length: 60 }).notNull(),
    observationKey: varchar("observation_key", { length: 80 }).notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    confidence: varchar("confidence", { length: 20 }).notNull(),
    evidenceReferenceIds: integer("evidence_reference_ids").array().notNull().default(sql`'{}'::integer[]`),
    analysisVersion: varchar("analysis_version", { length: 40 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("style_observations_analysis_idx").on(table.analysisId),
    index("style_observations_profile_idx").on(table.styleProfileId),
  ],
);
export type StyleObservationRow = typeof styleObservations.$inferSelect;

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
export const insertStyleObservationSchema = createInsertSchema(styleObservations).omit({ id: true, createdAt: true });
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
export type InsertStyleObservation = z.infer<typeof insertStyleObservationSchema>;
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

export const connectedAccounts = pgTable(
  "connected_accounts",
  {
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
  },
  (table) => [
    uniqueIndex("connected_accounts_user_platform_uq").on(table.userId, table.platform),
  ],
);

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
  (table) => [
    index("research_jobs_status_idx").on(table.status),
    /** Per-user research listing / isolation. */
    index("research_jobs_user_idx").on(table.userId),
  ],
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
    /**
     * Durable provider-identity dedupe: the same provider result can never be
     * stored twice for one job, independent of URL canonicalization.
     */
    uniqueIndex("research_sources_job_provider_native_uq").on(
      table.jobId,
      table.provider,
      table.nativeId,
    ),
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

export const researchAnalyses = pgTable(
  "research_analyses",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull().references(() => researchJobs.id),
    userId: integer("user_id"),
    analysisVersion: varchar("analysis_version", { length: 40 }).notNull().default("research-analysis-v1"),
    snapshot: jsonb("snapshot").notNull().default({}),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("research_analyses_job_version_uq").on(table.jobId, table.analysisVersion),
    index("research_analyses_job_idx").on(table.jobId),
    index("research_analyses_owner_idx").on(table.userId),
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
export const insertResearchAnalysisSchema = createInsertSchema(researchAnalyses).omit({
  id: true,
  createdAt: true,
});
export type ResearchAnalysisRow = typeof researchAnalyses.$inferSelect;
export type InsertResearchAnalysis = z.infer<typeof insertResearchAnalysisSchema>;
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
    /**
     * Phase 13: the AutomationRun that created this Story, when it was
     * automation-derived. UNIQUE, so the DATABASE — not a convention — is the
     * arbiter that makes automation's Story creation idempotent across worker
     * retries, duplicate delivery and crash/restart (§17/§19). NULL for every
     * human-authored Story, which keeps `createStoryFromResearch`'s existing
     * "many Stories per ResearchJob" semantics untouched.
     */
    automationRunId: integer("automation_run_id").references((): AnyPgColumn => automationRuns.id),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("stories_research_job_idx").on(table.researchJobId),
    index("stories_status_idx").on(table.status),
    /** One Story per AutomationRun — the idempotency arbiter for the story step. */
    uniqueIndex("stories_automation_run_uq").on(table.automationRunId),
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
    /**
     * Durable idempotency for repurposing (Phase 12): a repeated
     * `repurposeStory(storyId, targets)` delivery with the same caller-
     * supplied requestKey + (format, channel) reuses this Opportunity
     * instead of creating a sibling. NULL when repurposing supplied no
     * requestKey, or for anything not created through repurposing.
     */
    repurposeKey: varchar("repurpose_key", { length: 200 }),
    killReason: text("kill_reason"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("opportunities_story_idx").on(table.storyId),
    index("opportunities_status_idx").on(table.status),
    uniqueIndex("opportunities_chat_key_uq").on(table.chatKey),
    uniqueIndex("opportunities_repurpose_key_uq").on(table.repurposeKey),
  ],
);

/**
 * RepurposingPlan (Phase 25) — durable execution intent for one Story → N
 * Opportunities. Does not duplicate content or research. Frozen `snapshot`
 * captures the expanded target slots, limits, and plan-level ContextAssembly
 * inputs so a later style mutation cannot silently retarget an in-flight batch.
 * Opportunity/GenerationJob/Artifact rows remain the source of progress.
 */
export const repurposingPlans = pgTable(
  "repurposing_plans",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    storyId: integer("story_id").notNull().references(() => stories.id),
    planVersion: integer("plan_version").notNull().default(1),
    /** planning | queued | running | awaiting_approval | partial | completed | failed | cancelled */
    status: varchar("status", { length: 30 }).notNull().default("planning"),
    /** Caller-supplied (or generated) idempotency for the whole batch. */
    requestKey: varchar("request_key", { length: 200 }).notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
    limits: jsonb("limits").$type<Record<string, unknown>>().notNull().default({}),
    errorClass: varchar("error_class", { length: 30 }),
    errorMessage: text("error_message"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("repurposing_plans_story_request_uq").on(table.storyId, table.requestKey),
    index("repurposing_plans_owner_idx").on(table.userId),
    index("repurposing_plans_story_idx").on(table.storyId),
    index("repurposing_plans_status_idx").on(table.status),
  ],
);
export type RepurposingPlan = typeof repurposingPlans.$inferSelect;

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
    /**
     * Durable provenance of what ContextAssembly (Ticket 10) contributed:
     * `{ contextHash, sourceRefs: [{id, type, provenance}] }`. Never raw
     * source bodies — the frozen `policySnapshot` on GenerationJob is the
     * reproducibility boundary; this is inspection/audit only.
     */
    contextSnapshot: jsonb("context_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    /** active | archived */
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("generation_policies_key_version_uq").on(table.policyKey, table.version),
    uniqueIndex("generation_policies_spec_hash_uq").on(table.specHash),
    index("generation_policies_format_channel_idx").on(table.format, table.channel),
    // Phase 29.3: exactly one active revision per policyKey, enforced in SQL.
    uniqueIndex("generation_policies_one_active_per_key_uq")
      .on(table.policyKey)
      .where(sql`${table.status} = 'active'`),
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
    /**
     * Durable fan-out identity (Phase 16). Null on pre-Phase-16 / legacy
     * one-channel schedules. UNIQUE is the concurrency arbiter for
     * Artifact×channel distribution intents.
     */
    intentKey: varchar("intent_key", { length: 300 }),
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
    uniqueIndex("schedules_intent_key_uq").on(table.intentKey),
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

// ── VISUAL INTELLIGENCE (Phase 3) ─────────────────────────────────────────────
// Locked separation: VisualIntent (what the content wants) vs VisualAsset (the
// durable generated output) vs VisualProduction (the external mechanism).
//
// Visuals enter the lifecycle through generation, never attached to Stories:
//   Opportunity → GenerationPolicy → GenerationJob → Artifact ─┬─ visual intent
//                                                              └─▶ visual_generations → visual_assets → artifact.payload
// An Artifact references a visual by (asset id + revision); approval still
// belongs to the exact Artifact revision. Assets are immutable once referenced.

/**
 * A durable request to produce a visual. Distinct from the business Artifact:
 * this records how the visual was requested and made; the asset is the output.
 * Retries recover the same row; regenerations create a new row.
 */
export const visualGenerations = pgTable(
  "visual_generations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    /**
     * What the content wants: subject, composition, aspect ratio, style, brand
     * requirements, slide count, role relative to the Artifact.
     */
    intent: jsonb("intent").$type<Record<string, unknown>>().notNull(),
    /** image | carousel_slide | thumbnail | carousel | video | audio */
    kind: varchar("kind", { length: 30 }).notNull(),
    /** Provider + capability that produced (or will produce) the asset. */
    providerId: varchar("provider_id", { length: 80 }),
    capability: varchar("capability", { length: 40 }),
    providerVersion: varchar("provider_version", { length: 50 }),
    /** Frozen provider request (params + prompt); providers never see business tables. */
    requestSnapshot: jsonb("request_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    /** Authoritative idempotency arbiter (Ticket 06 §7 pattern). */
    idempotencyKey: varchar("idempotency_key", { length: 300 }).notNull().unique(),
    /** requested | generating | ready | partial | failed */
    status: varchar("status", { length: 20 }).notNull().default("requested"),
    attempt: integer("attempt").notNull().default(1),
    model: varchar("model", { length: 120 }),
    cost: decimal("cost", { precision: 12, scale: 6 }),
    errorClass: varchar("error_class", { length: 30 }),
    errorMessage: text("error_message"),
    /** Optional when no GenerationJob exists (direct visual request still routes through generation). */
    generationJobId: integer("generation_job_id").references(() => generationJobs.id),
    opportunityId: integer("opportunity_id").references(() => opportunities.id),
    correlationId: varchar("correlation_id", { length: 100 }).notNull(),
    /** Requested sibling count for this generation (1 = single image). */
    variationCount: integer("variation_count").notNull().default(1),
    /** Refinement parent — never mutated; a new generation always. */
    sourceVisualAssetId: integer("source_visual_asset_id").references((): AnyPgColumn => visualAssets.id),
    specId: varchar("spec_id", { length: 60 }),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("visual_generations_status_idx").on(table.status),
    index("visual_generations_opportunity_idx").on(table.opportunityId),
  ],
);

/**
 * A durable visual asset revision. Immutable once referenced by an Artifact or
 * Publication: any change is a NEW row linked by `supersedes_id`. Binary bytes
 * never live here — only a storage reference (`storageKey`) resolved through
 * the AssetStorage seam.
 */
export const visualAssets = pgTable(
  "visual_assets",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    visualGenerationId: integer("visual_generation_id").references(() => visualGenerations.id),
    /** image | carousel_slide | thumbnail | video | audio */
    kind: varchar("kind", { length: 30 }).notNull(),
    /** Provider-agnostic storage reference (e.g. `local:<sha>`); never a filesystem path. */
    storageKey: varchar("storage_key", { length: 500 }).notNull(),
    /** Validated image/video/audio MIME. Binary bytes never live here. */
    mime: varchar("mime", { length: 60 }).notNull(),
    width: integer("width"),
    height: integer("height"),
    /** Duration in milliseconds — video/audio assets; null for still images. */
    durationMs: integer("duration_ms"),
    /** Container label (mp4, webm) — video assets only. */
    container: varchar("container", { length: 32 }),
    /** Codec label when known (avc1, vp9) — video assets only. */
    codec: varchar("codec", { length: 64 }),
    /** Integer frames/sec when known — video assets only. */
    frameRate: integer("frame_rate"),
    byteSize: integer("byte_size"),
    /** Content hash of the bytes (sha256 hex). */
    contentHash: varchar("content_hash", { length: 64 }),
    altText: text("alt_text"),
    caption: text("caption"),
    /** Role relative to the requesting content (hero, inline, slide-3…). */
    role: varchar("role", { length: 60 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    supersedesId: integer("supersedes_id").references((): AnyPgColumn => visualAssets.id),
    provenance: varchar("provenance", { length: 20 }).notNull().default("generated"),
    /** 0-based order within a VisualGeneration (variations / carousel slides). */
    position: integer("position").notNull().default(0),
    /** requested | generating | ready | failed | archived */
    status: varchar("status", { length: 20 }).notNull().default("ready"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("visual_assets_generation_idx").on(table.visualGenerationId),
    index("visual_assets_status_idx").on(table.status),
    uniqueIndex("visual_assets_supersedes_uq").on(table.supersedesId),
    uniqueIndex("visual_assets_generation_position_uq")
      .on(table.visualGenerationId, table.position)
      .where(sql`${table.supersedesId} IS NULL`),
  ],
);

/**
 * Explicit references from Artifacts to visual asset revisions. A separate
 * table (not an array inside `payload`) so references are queryable and the
 * asset pointed at can be validated as immutable. The payload ALSO carries the
 * reference for renderer consumption; this table is the durable audit trail.
 */
export const visualAssetRefs = pgTable(
  "visual_asset_refs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    artifactId: integer("artifact_id").notNull().references(() => artifacts.id),
    visualAssetId: integer("visual_asset_id").notNull().references(() => visualAssets.id),
    /** Why this asset is attached (hero, inline, slide). */
    role: varchar("role", { length: 60 }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("visual_asset_refs_artifact_idx").on(table.artifactId),
    uniqueIndex("visual_asset_refs_artifact_asset_uq").on(table.artifactId, table.visualAssetId),
    uniqueIndex("visual_asset_refs_artifact_position_uq").on(table.artifactId, table.position),
  ],
);

export const insertVisualGenerationSchema = createInsertSchema(visualGenerations).omit({
  id: true,
  createdAt: true,
});
export const insertVisualAssetSchema = createInsertSchema(visualAssets).omit({
  id: true,
  createdAt: true,
});
export const insertVisualAssetRefSchema = createInsertSchema(visualAssetRefs).omit({
  id: true,
  createdAt: true,
});

export type VisualGeneration = typeof visualGenerations.$inferSelect;
export type InsertVisualGeneration = z.infer<typeof insertVisualGenerationSchema>;
export type VisualAsset = typeof visualAssets.$inferSelect;
export type InsertVisualAsset = z.infer<typeof insertVisualAssetSchema>;
/** Provider-neutral audio views over the existing media generation/asset tables. */
export type AudioGeneration = VisualGeneration & { kind: "audio" };
export type AudioAsset = VisualAsset & { kind: "audio" };
export type VisualAssetRef = typeof visualAssetRefs.$inferSelect;
export type InsertVisualAssetRef = z.infer<typeof insertVisualAssetRefSchema>;

// ── VIDEO REPURPOSING (Phase 27) ──────────────────────────────────────────────
// Distinct from VisualGeneration: clipping/derivation of an owned VideoAsset
// into N short VideoAssets. ContentForge owns intent/lineage/publishing;
// OpenShorts (or a fixture) is a worker behind VideoRepurposingProviderPort.

export const videoRepurposingJobs = pgTable(
  "video_repurposing_jobs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    sourceVisualAssetId: integer("source_visual_asset_id").notNull().references(() => visualAssets.id),
    idempotencyKey: varchar("idempotency_key", { length: 300 }).notNull(),
    providerId: varchar("provider_id", { length: 80 }).notNull(),
    providerVersion: varchar("provider_version", { length: 50 }),
    providerJobId: varchar("provider_job_id", { length: 200 }),
    clipCount: integer("clip_count").notNull().default(3),
    requestSnapshot: jsonb("request_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    /** requested | accepted | queued | processing | ready | partial | failed | unknown */
    status: varchar("status", { length: 20 }).notNull().default("requested"),
    attempt: integer("attempt").notNull().default(1),
    errorClass: varchar("error_class", { length: 30 }),
    errorMessage: text("error_message"),
    correlationId: varchar("correlation_id", { length: 100 }).notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("video_repurposing_jobs_idempotency_uq").on(table.idempotencyKey),
    index("video_repurposing_jobs_owner_idx").on(table.userId),
    index("video_repurposing_jobs_source_idx").on(table.sourceVisualAssetId),
    index("video_repurposing_jobs_status_idx").on(table.status),
  ],
);

export const videoRepurposingOutputs = pgTable(
  "video_repurposing_outputs",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull().references(() => videoRepurposingJobs.id),
    userId: integer("user_id"),
    position: integer("position").notNull(),
    visualAssetId: integer("visual_asset_id").references(() => visualAssets.id),
    /** requested | ready | failed */
    status: varchar("status", { length: 20 }).notNull().default("requested"),
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    durationMs: integer("duration_ms"),
    title: varchar("title", { length: 200 }),
    caption: text("caption"),
    aspectRatio: varchar("aspect_ratio", { length: 16 }),
    providerClipId: varchar("provider_clip_id", { length: 200 }),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("video_repurposing_outputs_job_position_uq").on(table.jobId, table.position),
    index("video_repurposing_outputs_job_idx").on(table.jobId),
    index("video_repurposing_outputs_asset_idx").on(table.visualAssetId),
  ],
);

export const insertVideoRepurposingJobSchema = createInsertSchema(videoRepurposingJobs).omit({
  id: true,
  createdAt: true,
});
export const insertVideoRepurposingOutputSchema = createInsertSchema(videoRepurposingOutputs).omit({
  id: true,
  createdAt: true,
});
export type VideoRepurposingJob = typeof videoRepurposingJobs.$inferSelect;
export type InsertVideoRepurposingJob = z.infer<typeof insertVideoRepurposingJobSchema>;
export type VideoRepurposingOutput = typeof videoRepurposingOutputs.$inferSelect;
export type InsertVideoRepurposingOutput = z.infer<typeof insertVideoRepurposingOutputSchema>;

// ── AUTOMATION / AUTOPILOT FOUNDATION (Phase 13) ──────────────────────────────
// Durable automation *intent*, not a second orchestration system. An
// AutomationPolicy describes WHEN (trigger) and WHAT (research → targets →
// generation → approval → publication); an AutomationRun records one logical
// execution of that policy.
//
// Automation creates durable intent and then drives the EXISTING primitives —
// it owns no domain state of its own:
//
//   AutomationPolicy ──▶ AutomationRun ──▶ ResearchJob → Story → Opportunity[N]
//                                        → GenerationPolicy → GenerationJob
//                                        → Artifact → approval → Schedule
//                                        → Occurrence → Publication → Result
//
// A run freezes the policy it started under (`policyVersion` +
// `policySnapshot`), so editing a policy can never change a running
// execution — the same discipline GenerationPolicy established for
// GenerationJob. `idempotencyKey` is the durable arbiter that collapses
// duplicate deliveries of one logical trigger slot into a single run.

export const automationPolicies = pgTable(
  "automation_policies",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    name: varchar("name", { length: 200 }).notNull(),
    /** active | paused | archived */
    status: varchar("status", { length: 20 }).notNull().default("active"),
    /**
     * Monotonic revision counter, bumped on every mutation. An AutomationRun
     * freezes the version it started under; nothing re-reads this row mid-run.
     */
    version: integer("version").notNull().default(1),
    /** Content hash of the resolved policy spec (change detection / observability). */
    specHash: varchar("spec_hash", { length: 64 }).notNull(),
    /** manual | scheduled */
    triggerType: varchar("trigger_type", { length: 30 }).notNull(),
    /**
     * Trigger configuration. `manual` takes none; `scheduled` takes
     * `{ startAt, recurrence?, timezone? }` where `recurrence` is the EXISTING
     * bounded grammar `every:<n><unit>` (m/h/d/w) — no second cron framework
     * and no RRULE parsing.
     */
    triggerConfig: jsonb("trigger_config").$type<Record<string, unknown>>().notNull().default({}),
    /**
     * Research configuration — validated by the EXISTING research request
     * schema and executed by the EXISTING ResearchEngine. Automation never
     * creates a research engine of its own.
     */
    researchConfig: jsonb("research_config").$type<Record<string, unknown>>().notNull().default({}),
    /**
     * Bounded target definitions consumed verbatim by Phase 12's
     * `repurposeStory()` (format/channel/concept/objective/…). No
     * automation-specific target model exists.
     */
    targets: jsonb("targets").$type<unknown[]>().notNull().default([]),
    /** Generation overrides forwarded to `createGenerationJob` (voice/template/model/constraints). */
    generationConfig: jsonb("generation_config").$type<Record<string, unknown>>().notNull().default({}),
    /**
     * approval_required | trusted — the policy's EXPLICIT approval declaration.
     * `approval_required` (default): automation stops at a durable
     * `awaiting_approval` state. `trusted`: automation may move generated
     * artifacts through the Artifact model's OWN documented transitions
     * (`draft → in_review → approved`); there is no hidden approval state.
     */
    approvalMode: varchar("approval_mode", { length: 30 }).notNull().default("approval_required"),
    /**
     * Publication behavior declaration: `{ mode: "none" | "on_approval" }`.
     * Defaults to `none`, so auto-publishing is never the default. `on_approval`
     * requires `approvalMode = "trusted"` and still publishes only through the
     * existing `approved Artifact → Schedule → Occurrence → Publication` path.
     */
    publicationConfig: jsonb("publication_config").$type<Record<string, unknown>>().notNull().default({}),
    /**
     * Operational bounds (not billing): `maxRunsPerDay`,
     * `maxOpportunitiesPerRun`, `maxGeneratedArtifactsPerRun`.
     */
    limits: jsonb("limits").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("automation_policies_user_idx").on(table.userId),
    index("automation_policies_status_idx").on(table.status),
    index("automation_policies_trigger_idx").on(table.triggerType, table.status),
  ],
);

/**
 * AutomationRun — one durable execution record for one logical trigger.
 *
 * It carries IDs and normalized durable references only — never a pipeline
 * payload or a content blob. `outcomes` is a bounded per-target result list
 * (the partial-success representation §16 requires), not a state machine.
 */
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    policyId: integer("policy_id").notNull().references(() => automationPolicies.id),
    /** FROZEN policy identity — captured at run creation, never re-read. */
    policyVersion: integer("policy_version").notNull(),
    policySpecHash: varchar("policy_spec_hash", { length: 64 }).notNull(),
    policySnapshot: jsonb("policy_snapshot").$type<Record<string, unknown>>().notNull(),
    /** manual | scheduled */
    triggerType: varchar("trigger_type", { length: 30 }).notNull(),
    /**
     * Logical trigger identity — a manual `requestKey` or the scheduled slot's
     * absolute ISO instant. UNIQUE, so the DATABASE (not a lock) is the arbiter
     * that collapses duplicate deliveries of one trigger slot into ONE run.
     */
    idempotencyKey: varchar("idempotency_key", { length: 300 }).notNull().unique(),
    /** pending | running | awaiting_approval | completed | partial | failed */
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    /** Durable reference to the ResearchJob this run created (idempotent by key). */
    researchJobId: integer("research_job_id").references(() => researchJobs.id),
    /**
     * Bounded per-target outcomes:
     * `[{ format, channel, status, opportunityId, generationJobId, artifactId, scheduleId, error }]`.
     * IDs only — the entities remain the source of truth for their own state.
     */
    outcomes: jsonb("outcomes").$type<unknown[]>().notNull().default([]),
    /** transient | rate_limited | permanent | policy_human (see jobs/failures). */
    errorClass: varchar("error_class", { length: 30 }),
    errorMessage: text("error_message"),
    /**
     * Single-flight orchestrator lease (mirrors the Publication lease). The DB
     * is the only arbiter; a crashed advance is reclaimed when the lease expires.
     */
    advanceLeaseExpiresAt: timestamp("advance_lease_expires_at"),
    /** How many times the orchestrator advanced this run. */
    attempt: integer("attempt").notNull().default(0),
    correlationId: varchar("correlation_id", { length: 100 }).notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("automation_runs_policy_idx").on(table.policyId),
    index("automation_runs_status_idx").on(table.status),
    index("automation_runs_user_idx").on(table.userId),
    index("automation_runs_research_idx").on(table.researchJobId),
  ],
);

export const insertAutomationPolicySchema = createInsertSchema(automationPolicies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertAutomationRunSchema = createInsertSchema(automationRuns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AutomationPolicy = typeof automationPolicies.$inferSelect;
export type InsertAutomationPolicy = z.infer<typeof insertAutomationPolicySchema>;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type InsertAutomationRun = z.infer<typeof insertAutomationRunSchema>;
export type AutomationRunStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "partial"
  | "failed";
export type AutomationTriggerType = "manual" | "scheduled";
export type AutomationApprovalMode = "approval_required" | "trusted";

export type VisualGenerationStatus = "requested" | "generating" | "ready" | "failed";
export type VisualAssetStatus = "requested" | "generating" | "ready" | "failed" | "archived";
export type OpportunityStatus = "proposed" | "selected" | "killed";
export type ArtifactReadiness = "draft" | "in_review" | "approved" | "rejected";
export type PublicationState =
  | "scheduled"
  | "queued"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

// ── P-8 LEARNING / ANALYTICS (Phase 14) ───────────────────────────────────────
/**
 * PerformanceSignal — one timestamped, versioned metric observation for a
 * Publication. Snapshots at T1/T2/T3 coexist; identity is the uniqueness
 * arbiter so repeated polling cannot duplicate the same logical measurement.
 * Missing provider data is stored as availability=`not_available` with a NULL
 * value — never fabricated as zero.
 */
export const performanceSignals = pgTable(
  "performance_signals",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    publicationId: integer("publication_id")
      .notNull()
      .references(() => publications.id),
    resultId: integer("result_id").references(() => results.id),
    artifactId: integer("artifact_id").references(() => artifacts.id),
    channel: varchar("channel", { length: 50 }).notNull(),
    provider: varchar("provider", { length: 60 }).notNull(),
    externalId: varchar("external_id", { length: 200 }),
    metric: varchar("metric", { length: 60 }).notNull(),
    /** Null when availability is not_available — never coerced to 0. */
    value: decimal("value", { precision: 18, scale: 6 }),
    /** observed | not_available */
    availability: varchar("availability", { length: 20 }).notNull(),
    observedAt: timestamp("observed_at").notNull(),
    retrievedAt: timestamp("retrieved_at").notNull(),
    measurementWindow: varchar("measurement_window", { length: 80 }),
    /** e.g. performance.v1 — changing interpretation does not rewrite history. */
    normalizationVersion: varchar("normalization_version", { length: 40 }).notNull(),
    sourceRevision: varchar("source_revision", { length: 80 }),
    /** Bounded diagnostic provenance — never a full provider payload. */
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
    identityKey: varchar("identity_key", { length: 300 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("performance_signals_identity_uq").on(table.identityKey),
    index("performance_signals_user_idx").on(table.userId),
    index("performance_signals_publication_idx").on(table.publicationId),
    index("performance_signals_observed_idx").on(table.publicationId, table.observedAt),
  ],
);

/**
 * LearningSignal — the canonical durable representation of an observation that
 * may later influence personalization. Payloads are typed and versioned; this
 * is not a second ContextAssembly and does not mutate profile/style/memory.
 */
export const learningSignals = pgTable(
  "learning_signals",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    /** edit | approval | publication | performance | derived */
    signalType: varchar("signal_type", { length: 40 }).notNull(),
    /** artifact_revision | publication | result | performance_signal */
    sourceType: varchar("source_type", { length: 40 }).notNull(),
    sourceId: integer("source_id").notNull(),
    artifactId: integer("artifact_id").references(() => artifacts.id),
    priorArtifactId: integer("prior_artifact_id").references(() => artifacts.id),
    publicationId: integer("publication_id").references(() => publications.id),
    resultId: integer("result_id").references(() => results.id),
    performanceSignalId: integer("performance_signal_id").references(() => performanceSignals.id),
    generationJobId: integer("generation_job_id").references(() => generationJobs.id),
    generationPolicyId: integer("generation_policy_id").references(() => generationPolicies.id),
    opportunityId: integer("opportunity_id").references(() => opportunities.id),
    storyId: integer("story_id").references(() => stories.id),
    automationRunId: integer("automation_run_id").references(() => automationRuns.id),
    channel: varchar("channel", { length: 50 }),
    format: varchar("format", { length: 50 }),
    observedAt: timestamp("observed_at").notNull(),
    schemaVersion: varchar("schema_version", { length: 40 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Evidence strength of the observation — not a quality/viral score. */
    confidence: varchar("confidence", { length: 40 }),
    identityKey: varchar("identity_key", { length: 300 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("learning_signals_identity_uq").on(table.identityKey),
    index("learning_signals_user_idx").on(table.userId),
    index("learning_signals_type_idx").on(table.signalType),
    index("learning_signals_artifact_idx").on(table.artifactId),
    index("learning_signals_publication_idx").on(table.publicationId),
    index("learning_signals_story_idx").on(table.storyId),
  ],
);

export const insertPerformanceSignalSchema = createInsertSchema(performanceSignals).omit({
  id: true,
  createdAt: true,
});
export const insertLearningSignalSchema = createInsertSchema(learningSignals).omit({
  id: true,
  createdAt: true,
});

export type PerformanceSignal = typeof performanceSignals.$inferSelect;
export type InsertPerformanceSignal = z.infer<typeof insertPerformanceSignalSchema>;
export type LearningSignal = typeof learningSignals.$inferSelect;
export type InsertLearningSignal = z.infer<typeof insertLearningSignalSchema>;
export type LearningSignalType = "edit" | "approval" | "publication" | "performance" | "derived";
export type PerformanceAvailability = "observed" | "not_available";

/**
 * LearningObservation — durable persistence of multi-sample empirical observations
 * across content, distribution, style, and production dimensions.
 * Retains candidate vs comparison population, measured values, and evidence quality.
 */
export const learningObservations = pgTable(
  "learning_observations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    /** content | distribution | style | production */
    dimension: varchar("dimension", { length: 40 }).notNull(),
    /** e.g. format_channel_performance | style_approval_rate | model_cost_efficiency | workflow_reliability */
    observationType: varchar("observation_type", { length: 60 }).notNull(),
    /** e.g. channel:linkedin | format:carousel | model:gemini-1.5-pro */
    targetScope: varchar("target_scope", { length: 100 }).notNull(),
    /** Candidate population criteria, sample count, and primary entity IDs */
    candidatePopulation: jsonb("candidate_population").$type<Record<string, unknown>>().notNull().default({}),
    /** Baseline/comparison population criteria, sample count, and comparison entity IDs */
    comparisonPopulation: jsonb("comparison_population").$type<Record<string, unknown>>().notNull().default({}),
    /** e.g. engagement_rate | approval_rate | failure_rate | duration_ms | cost */
    metricName: varchar("metric_name", { length: 60 }).notNull(),
    candidateValue: decimal("candidate_value", { precision: 12, scale: 4 }),
    comparisonValue: decimal("comparison_value", { precision: 12, scale: 4 }),
    differencePercentage: decimal("difference_percentage", { precision: 8, scale: 2 }),
    /** insufficient_data | observed | directional | repeatable | confirmed */
    evidenceQuality: varchar("evidence_quality", { length: 30 }).notNull(),
    /** Bounded IDs of artifacts, publications, results, or learning signals supporting this observation */
    evidenceEntityIds: jsonb("evidence_entity_ids").$type<Record<string, number[]>>().notNull().default({}),
    measurementWindow: varchar("measurement_window", { length: 80 }),
    identityKey: varchar("identity_key", { length: 300 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("learning_observations_identity_uq").on(table.identityKey),
    index("learning_observations_user_idx").on(table.userId),
    index("learning_observations_dimension_idx").on(table.dimension),
    index("learning_observations_type_idx").on(table.observationType),
  ],
);

/**
 * LearningProposal — durable optimization proposals grounded in learning observations.
 * A proposal is NOT an applied production change.
 * States: proposed | accepted | rejected | superseded | expired.
 */
export const learningProposals = pgTable(
  "learning_proposals",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    observationId: integer("observation_id").references(() => learningObservations.id),
    /** format_distribution | style_association | cost_efficiency | workflow_reliability */
    proposalType: varchar("proposal_type", { length: 60 }).notNull(),
    targetScope: varchar("target_scope", { length: 100 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    rationale: text("rationale").notNull(),
    expectedImpactHypothesis: text("expected_impact_hypothesis").notNull(),
    /** insufficient_data | observed | directional | repeatable | confirmed */
    evidenceQuality: varchar("evidence_quality", { length: 30 }).notNull(),
    /** Summary snapshot: sample counts, candidate vs baseline values, source IDs */
    evidenceSummary: jsonb("evidence_summary").$type<Record<string, unknown>>().notNull().default({}),
    /** proposed | accepted | rejected | superseded | expired */
    status: varchar("status", { length: 30 }).notNull().default("proposed"),
    reviewedAt: timestamp("reviewed_at"),
    reviewedBy: integer("reviewed_by"),
    reviewNotes: text("review_notes"),
    identityKey: varchar("identity_key", { length: 300 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("learning_proposals_identity_uq").on(table.identityKey),
    index("learning_proposals_user_idx").on(table.userId),
    index("learning_proposals_status_idx").on(table.status),
    index("learning_proposals_type_idx").on(table.proposalType),
  ],
);

export const insertLearningObservationSchema = createInsertSchema(learningObservations).omit({
  id: true,
  createdAt: true,
});
export const insertLearningProposalSchema = createInsertSchema(learningProposals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type LearningObservation = typeof learningObservations.$inferSelect;
export type InsertLearningObservation = z.infer<typeof insertLearningObservationSchema>;
export type LearningProposal = typeof learningProposals.$inferSelect;
export type InsertLearningProposal = z.infer<typeof insertLearningProposalSchema>;

export type EvidenceQuality = "insufficient_data" | "observed" | "directional" | "repeatable" | "confirmed";
export type ProposalStatus = "proposed" | "accepted" | "rejected" | "superseded" | "expired";
export type ProposalType = "format_distribution" | "style_association" | "cost_efficiency" | "workflow_reliability";
export type LearningDimension = "content" | "distribution" | "style" | "production";

// ── AGENT RUNTIME (Phase 22) ─────────────────────────────────────────────────
// Durable agent execution identity. Agents never write domain tables; they
// create AgentRun / AgentToolCall rows and invoke existing domain services.

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    backendId: varchar("backend_id", { length: 80 }).notNull(),
    providerSnapshot: jsonb("provider_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    objective: text("objective").notNull(),
    /** requested | running | waiting | completed | failed | cancelled */
    status: varchar("status", { length: 20 }).notNull().default("requested"),
    currentStep: integer("current_step").notNull().default(0),
    attempt: integer("attempt").notNull().default(1),
    idempotencyKey: varchar("idempotency_key", { length: 300 }).notNull().unique(),
    correlationId: varchar("correlation_id", { length: 100 }).notNull(),
    errorClass: varchar("error_class", { length: 30 }),
    errorMessage: text("error_message"),
    cancellationRequested: boolean("cancellation_requested").notNull().default(false),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("agent_runs_user_idx").on(table.userId),
    index("agent_runs_status_idx").on(table.status),
  ],
);

export const agentToolCalls = pgTable(
  "agent_tool_calls",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    agentRunId: integer("agent_run_id")
      .notNull()
      .references(() => agentRuns.id),
    toolName: varchar("tool_name", { length: 80 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 300 }).notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    /** requested | running | queued | completed | denied | failed */
    status: varchar("status", { length: 20 }).notNull().default("requested"),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    resourceRefs: jsonb("resource_refs").$type<Record<string, unknown>>().notNull().default({}),
    errorClass: varchar("error_class", { length: 30 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("agent_tool_calls_idempotency_uq").on(table.idempotencyKey),
    index("agent_tool_calls_run_idx").on(table.agentRunId),
    index("agent_tool_calls_user_idx").on(table.userId),
  ],
);

export const insertAgentRunSchema = createInsertSchema(agentRuns).omit({
  id: true,
  createdAt: true,
});
export const insertAgentToolCallSchema = createInsertSchema(agentToolCalls).omit({
  id: true,
  createdAt: true,
});
export type AgentRun = typeof agentRuns.$inferSelect;
export type InsertAgentRun = z.infer<typeof insertAgentRunSchema>;
export type AgentToolCall = typeof agentToolCalls.$inferSelect;
export type InsertAgentToolCall = z.infer<typeof insertAgentToolCallSchema>;

// ── CONTROLLED OPTIMIZATION & EXPERIMENTATION (Phase 29.2) ───────────────────
// Hypothesis → Experiment → Measure → Decide
// Provides durable experimentation infrastructure.
// Strictly non-mutating: Experiments test whether a learned hypothesis produces
// a measurable improvement. Winning variants produce PolicyCandidate records
// for human review; live production policies and active prompts remain untouched.

export const experiments = pgTable(
  "experiments",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    sourceProposalId: integer("source_proposal_id").references(() => learningProposals.id),
    name: varchar("name", { length: 255 }).notNull(),
    hypothesis: text("hypothesis").notNull(),
    objective: text("objective").notNull(),
    targetScope: varchar("target_scope", { length: 100 }).notNull(),
    experimentType: varchar("experiment_type", { length: 50 }).notNull(),
    primaryMetric: varchar("primary_metric", { length: 60 }).notNull(),
    guardrailMetrics: jsonb("guardrail_metrics").$type<string[]>().notNull().default([]),
    eligibilityRules: jsonb("eligibility_rules").$type<Record<string, unknown>>().notNull().default({}),
    allocationMethod: varchar("allocation_method", { length: 50 }).notNull().default("deterministic_hash"),
    /** draft | ready | running | paused | completed | cancelled | invalidated */
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    /** pending | inconclusive | control_preferred | variant_promising | variant_preferred | guardrail_failed | invalidated */
    decision: varchar("decision", { length: 30 }).notNull().default("pending"),
    decisionNotes: text("decision_notes"),
    decidedAt: timestamp("decided_at"),
    decidedBy: integer("decided_by"),
    minSampleSize: integer("min_sample_size").notNull().default(3),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    identityKey: varchar("identity_key", { length: 300 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("experiments_identity_uq").on(table.identityKey),
    index("experiments_user_idx").on(table.userId),
    index("experiments_status_idx").on(table.status),
    index("experiments_type_idx").on(table.experimentType),
    index("experiments_proposal_idx").on(table.sourceProposalId),
  ],
);

export const experimentVariants = pgTable(
  "experiment_variants",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    experimentId: integer("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    variantKey: varchar("variant_key", { length: 50 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    isControl: boolean("is_control").notNull().default(false),
    /** Immutable configuration snapshot for this variant */
    policySnapshot: jsonb("policy_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    generationPolicyId: integer("generation_policy_id").references(() => generationPolicies.id),
    trafficWeight: integer("traffic_weight").notNull().default(50),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("experiment_variants_exp_key_uq").on(table.experimentId, table.variantKey),
    index("experiment_variants_user_idx").on(table.userId),
    index("experiment_variants_exp_idx").on(table.experimentId),
  ],
);

export const experimentAssignments = pgTable(
  "experiment_assignments",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    experimentId: integer("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    variantId: integer("variant_id")
      .notNull()
      .references(() => experimentVariants.id, { onDelete: "cascade" }),
    opportunityId: integer("opportunity_id")
      .notNull()
      .references(() => opportunities.id),
    artifactId: integer("artifact_id").references(() => artifacts.id),
    publicationId: integer("publication_id").references(() => publications.id),
    assignedAt: timestamp("assigned_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 300 }).notNull(),
  },
  (table) => [
    uniqueIndex("experiment_assignments_idempotency_uq").on(table.idempotencyKey),
    uniqueIndex("experiment_assignments_opp_uq").on(table.opportunityId),
    index("experiment_assignments_exp_idx").on(table.experimentId),
    index("experiment_assignments_variant_idx").on(table.variantId),
    index("experiment_assignments_user_idx").on(table.userId),
    index("experiment_assignments_artifact_idx").on(table.artifactId),
    index("experiment_assignments_pub_idx").on(table.publicationId),
  ],
);

export const experimentEvaluations = pgTable(
  "experiment_evaluations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    experimentId: integer("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    evaluationWindow: varchar("evaluation_window", { length: 50 }).notNull().default("interim"),
    primaryMetric: varchar("primary_metric", { length: 60 }).notNull(),
    controlMetrics: jsonb("control_metrics").$type<{
      sampleCount: number;
      measuredCount: number;
      mean: string | null;
      availability: string;
    }>().notNull().default({ sampleCount: 0, measuredCount: 0, mean: null, availability: "insufficient_data" }),
    variantMetrics: jsonb("variant_metrics").$type<Array<{
      variantId: number;
      variantKey: string;
      sampleCount: number;
      measuredCount: number;
      mean: string | null;
      difference: string | null;
      differencePercentage: string | null;
      availability: string;
    }>>().notNull().default([]),
    guardrailResults: jsonb("guardrail_results").$type<Array<{
      metric: string;
      controlValue: string | null;
      variantValue: string | null;
      differencePercentage: string | null;
      status: "passed" | "regressed" | "not_available";
    }>>().notNull().default([]),
    /** insufficient_data | observed | directional | repeatable | confirmed */
    evidenceQuality: varchar("evidence_quality", { length: 30 }).notNull(),
    /** inconclusive | control_preferred | variant_promising | variant_preferred | guardrail_failed */
    recommendedDecision: varchar("recommended_decision", { length: 30 }).notNull(),
    summary: text("summary").notNull(),
    evaluatedAt: timestamp("evaluated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    identityKey: varchar("identity_key", { length: 300 }).notNull(),
  },
  (table) => [
    uniqueIndex("experiment_evaluations_identity_uq").on(table.identityKey),
    index("experiment_evaluations_exp_idx").on(table.experimentId),
    index("experiment_evaluations_user_idx").on(table.userId),
  ],
);

export const policyCandidates = pgTable(
  "policy_candidates",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    experimentId: integer("experiment_id")
      .notNull()
      .references(() => experiments.id),
    variantId: integer("variant_id")
      .notNull()
      .references(() => experimentVariants.id),
    evaluationId: integer("evaluation_id").references(() => experimentEvaluations.id),
    title: varchar("title", { length: 255 }).notNull(),
    rationale: text("rationale").notNull(),
    targetScope: varchar("target_scope", { length: 100 }).notNull(),
    proposedConfiguration: jsonb("proposed_configuration").$type<Record<string, unknown>>().notNull().default({}),
    /** candidate | under_review | approved_for_future | rejected | archived */
    status: varchar("status", { length: 30 }).notNull().default("candidate"),
    reviewedBy: integer("reviewed_by"),
    reviewedAt: timestamp("reviewed_at"),
    reviewNotes: text("review_notes"),
    identityKey: varchar("identity_key", { length: 300 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("policy_candidates_identity_uq").on(table.identityKey),
    index("policy_candidates_user_idx").on(table.userId),
    index("policy_candidates_exp_idx").on(table.experimentId),
    index("policy_candidates_status_idx").on(table.status),
  ],
);

export const insertExperimentSchema = createInsertSchema(experiments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertExperimentVariantSchema = createInsertSchema(experimentVariants).omit({
  id: true,
  createdAt: true,
});
export const insertExperimentAssignmentSchema = createInsertSchema(experimentAssignments).omit({
  id: true,
  assignedAt: true,
});
export const insertExperimentEvaluationSchema = createInsertSchema(experimentEvaluations).omit({
  id: true,
  evaluatedAt: true,
});
export const insertPolicyCandidateSchema = createInsertSchema(policyCandidates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Experiment = typeof experiments.$inferSelect;
export type InsertExperiment = z.infer<typeof insertExperimentSchema>;
export type ExperimentVariant = typeof experimentVariants.$inferSelect;
export type InsertExperimentVariant = z.infer<typeof insertExperimentVariantSchema>;
export type ExperimentAssignment = typeof experimentAssignments.$inferSelect;
export type InsertExperimentAssignment = z.infer<typeof insertExperimentAssignmentSchema>;
export type ExperimentEvaluation = typeof experimentEvaluations.$inferSelect;
export type InsertExperimentEvaluation = z.infer<typeof insertExperimentEvaluationSchema>;
export type PolicyCandidate = typeof policyCandidates.$inferSelect;
export type InsertPolicyCandidate = z.infer<typeof insertPolicyCandidateSchema>;

export type ExperimentStatus =
  | "draft"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "invalidated";

export type ExperimentDecision =
  | "pending"
  | "inconclusive"
  | "control_preferred"
  | "variant_promising"
  | "variant_preferred"
  | "guardrail_failed"
  | "invalidated";

export type PolicyCandidateStatus =
  | "candidate"
  | "under_review"
  | "approved_for_future"
  | "rejected"
  | "archived";

// ── HUMAN-GATED POLICY ACTIVATION (Phase 29.3) ────────────────────────────────
// Approve -> Activate -> Preserve History.
// Records every production-policy activation/rollback as an immutable audit
// event. A GenerationPolicy row is never mutated after creation (Phase 1
// invariant, reused as-is here); activation only flips which revision is
// `status = 'active'` for a given policyKey, enforced by a single partial
// unique index so exactly one revision is ever active per scope.

export const policyActivations = pgTable(
  "policy_activations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    /** activate | rollback */
    action: varchar("action", { length: 20 }).notNull(),
    policyCandidateId: integer("policy_candidate_id").references(() => policyCandidates.id),
    experimentId: integer("experiment_id").references(() => experiments.id),
    evaluationId: integer("evaluation_id").references(() => experimentEvaluations.id),
    activatedPolicyId: integer("activated_policy_id")
      .notNull()
      .references(() => generationPolicies.id),
    previousPolicyId: integer("previous_policy_id").references(() => generationPolicies.id),
    policyKey: varchar("policy_key", { length: 200 }).notNull(),
    reason: text("reason"),
    /** human | autonomous_controller -- who actually took this action (Phase 29.4 §35). Never impersonated. */
    actor: varchar("actor", { length: 30 }).notNull().default("human"),
    identityKey: varchar("identity_key", { length: 300 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("policy_activations_identity_uq").on(table.identityKey),
    index("policy_activations_user_idx").on(table.userId),
    index("policy_activations_policy_key_idx").on(table.policyKey),
    index("policy_activations_candidate_idx").on(table.policyCandidateId),
    index("policy_activations_actor_idx").on(table.actor),
  ],
);

export const insertPolicyActivationSchema = createInsertSchema(policyActivations).omit({
  id: true,
  createdAt: true,
});

export type PolicyActivation = typeof policyActivations.$inferSelect;
export type InsertPolicyActivation = z.infer<typeof insertPolicyActivationSchema>;
export type PolicyActivationAction = "activate" | "rollback";
export type PolicyActivationActor = "human" | "autonomous_controller";

// ── BOUNDED AUTONOMOUS OPTIMIZATION (Phase 29.4) ──────────────────────────────
// Observe → Learn → Experiment → Evaluate → Deterministic Eligibility →
// Bounded Autonomous Action → Monitor → Rollback / Continue / Stop.
// The autonomy controller is deterministic and server-authoritative; it never
// bypasses Phase 29.1 evidence rules, Phase 29.2 experimentation, or Phase
// 29.3 immutable human-gated activation -- it only decides WHEN those existing
// mechanisms may be invoked without a human in the loop, under strict,
// human-configured, human-clearable bounds.

export const autonomyConfigs = pgTable(
  "autonomy_configs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    /** Master kill switch. Defaults false -- no deployment silently enables autonomy. */
    enabled: boolean("enabled").notNull().default(false),
    /** disabled | observe_only | recommend | experiment_only | bounded_activation */
    mode: varchar("mode", { length: 30 }).notNull().default("disabled"),
    experimentAutomationEnabled: boolean("experiment_automation_enabled").notNull().default(false),
    activationAutomationEnabled: boolean("activation_automation_enabled").notNull().default(false),
    rollbackEnabled: boolean("rollback_enabled").notNull().default(false),
    /** insufficient_data | observed | directional | repeatable | confirmed. Autonomy never activates below this. */
    minimumEvidenceQuality: varchar("minimum_evidence_quality", { length: 30 }).notNull().default("confirmed"),
    maxActiveExperiments: integer("max_active_experiments").notNull().default(1),
    maxExperimentsPerDay: integer("max_experiments_per_day").notNull().default(1),
    maxActivationsPerDay: integer("max_activations_per_day").notNull().default(1),
    maxActivationsPerWeek: integer("max_activations_per_week").notNull().default(2),
    maxConsecutiveActivations: integer("max_consecutive_activations").notNull().default(2),
    cooldownMinutes: integer("cooldown_minutes").notNull().default(1440),
    /** Empty/null = no restriction beyond ownership. Non-empty = allowlist of targetScope values. */
    allowedScopes: jsonb("allowed_scopes").$type<string[]>(),
    /** open | closed. Only a human (via resetCircuitBreaker) may close it once opened. */
    circuitBreakerState: varchar("circuit_breaker_state", { length: 20 }).notNull().default("closed"),
    circuitBreakerReason: text("circuit_breaker_reason"),
    circuitBreakerOpenedAt: timestamp("circuit_breaker_opened_at"),
    pausedAt: timestamp("paused_at"),
    updatedBy: integer("updated_by"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [uniqueIndex("autonomy_configs_user_uq").on(table.userId)],
);

export const insertAutonomyConfigSchema = createInsertSchema(autonomyConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type AutonomyConfig = typeof autonomyConfigs.$inferSelect;
export type InsertAutonomyConfig = z.infer<typeof insertAutonomyConfigSchema>;
export type AutonomyMode = "disabled" | "observe_only" | "recommend" | "experiment_only" | "bounded_activation";

/**
 * Durable decision journal. Every autonomous evaluation -- allowed OR denied
 * -- is recorded here, so "why did it act" and "why didn't it act" are both
 * always answerable from the database, never only from logs.
 */
export const autonomyDecisions = pgTable(
  "autonomy_decisions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    /** experiment_selection | activation | rollback */
    decisionType: varchar("decision_type", { length: 30 }).notNull(),
    targetScope: varchar("target_scope", { length: 100 }),
    proposalId: integer("proposal_id").references(() => learningProposals.id),
    experimentId: integer("experiment_id").references(() => experiments.id),
    evaluationId: integer("evaluation_id").references(() => experimentEvaluations.id),
    candidateId: integer("candidate_id").references(() => policyCandidates.id),
    previousPolicyId: integer("previous_policy_id").references(() => generationPolicies.id),
    newPolicyId: integer("new_policy_id").references(() => generationPolicies.id),
    evidenceQuality: varchar("evidence_quality", { length: 30 }),
    /** Snapshot of the gate state actually evaluated -- budget counts, cooldown remaining, guardrails, etc. */
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    /** allowed | denied */
    outcome: varchar("outcome", { length: 10 }).notNull(),
    /** Machine-readable gate code, e.g. KILL_SWITCH, CIRCUIT_OPEN, BUDGET_EXHAUSTED, ELIGIBLE. */
    code: varchar("code", { length: 40 }).notNull(),
    reason: text("reason").notNull(),
    identityKey: varchar("identity_key", { length: 300 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("autonomy_decisions_identity_uq").on(table.identityKey),
    index("autonomy_decisions_user_idx").on(table.userId),
    index("autonomy_decisions_scope_idx").on(table.targetScope),
    index("autonomy_decisions_outcome_idx").on(table.outcome),
  ],
);

export const insertAutonomyDecisionSchema = createInsertSchema(autonomyDecisions).omit({
  id: true,
  createdAt: true,
});
export type AutonomyDecision = typeof autonomyDecisions.$inferSelect;
export type InsertAutonomyDecision = z.infer<typeof insertAutonomyDecisionSchema>;

