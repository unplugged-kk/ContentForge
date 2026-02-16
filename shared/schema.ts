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

export const insertPillarSchema = createInsertSchema(pillars).omit({ id: true });
export const insertPostSchema = createInsertSchema(posts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTweetSchema = createInsertSchema(tweets).omit({ id: true });
export const insertIdeaSchema = createInsertSchema(ideas).omit({ id: true, createdAt: true });
export const insertTemplateSchema = createInsertSchema(templates).omit({ id: true });
export const insertAnalyticsSchema = createInsertSchema(analytics).omit({ id: true, recordedAt: true });
export const insertAiUsageLogSchema = createInsertSchema(aiUsageLog).omit({ id: true, createdAt: true });

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
