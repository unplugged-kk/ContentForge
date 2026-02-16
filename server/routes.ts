import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { discoveredIdeas } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import OpenAI from "openai";
import * as cheerio from "cheerio";
import Parser from "rss-parser";
import path from "path";
import fs from "fs";
import multer from "multer";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const rssParser = new Parser();

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const SYSTEM_PROMPT = `You are a ghostwriter for Kishore Kumar Behera, a senior Infrastructure Engineering Lead with 11+ years in DevOps, Cloud (AWS/Azure/GCP), Kubernetes, and Platform Engineering. He is building a personal brand on X (Twitter) and Threads at the intersection of Data & AI and DevOps/Infrastructure.

VIRAL CONTENT PRINCIPLES — Apply these to every piece of content:
1. LEAD WITH VALUE: The first 2 lines must deliver or promise specific, actionable value.
2. SPECIFICITY WINS: Use specific metrics, tool names, and real scenarios.
3. CONTRARIAN + CREDIBLE: Challenge conventional wisdom WITH evidence.
4. TEACH ONE THING: Every piece should leave the reader knowing ONE new thing.
5. STORY > ADVICE: Lead with real scenarios, not generic advice.
6. USE THE READER'S LANGUAGE: Write how engineers talk in Slack, not documentation.
7. NUMBERS ARE HOOKS: "5 things", "40% reduction", "$500K saved" — numbers stop the scroll.
8. END WITH ENGAGEMENT: End with a question or bold prediction that invites debate.
9. PATTERN INTERRUPT: Start with something unexpected.
10. THE SAVE TEST: Would someone bookmark this to reference later?

Writing style:
- Write in first person as Kishore
- Be technically credible — use specific tools, metrics, and real-world scenarios
- Short, punchy sentences for tweets. No fluff.
- For threads, start with a killer hook
- For X: Stay within 280 characters per individual tweet
- For Threads: Stay within 500 characters per individual post
- Never use hashtags inside post body`;

function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    const match = str.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return null; }
    }
    return null;
  }
}

async function aiCall(messages: any[], jsonMode = false) {
  const msgs = jsonMode
    ? messages.map((m: any, i: number) =>
        i === 0 && m.role === "system"
          ? { ...m, content: m.content + "\nRespond in JSON format." }
          : m
      )
    : messages;
  const opts: any = { model: "gpt-4o-mini", messages: msgs, max_completion_tokens: 8192 };
  if (jsonMode) opts.response_format = { type: "json_object" };
  const startTime = Date.now();
  const response = await openai.chat.completions.create(opts);
  return {
    content: response.choices[0]?.message?.content || "",
    usage: response.usage,
    latency: Date.now() - startTime,
  };
}

async function logAiUsage(usage: any, latency: number, feature: string) {
  await storage.createAiUsageLog({
    model: "gpt-4o-mini",
    inputTokens: usage?.prompt_tokens || 0,
    outputTokens: usage?.completion_tokens || 0,
    totalTokens: usage?.total_tokens || 0,
    latencyMs: latency,
    feature,
  });
}

const createPostBody = z.object({
  pillarId: z.union([z.number(), z.string().transform(Number), z.null()]).optional(),
  postType: z.string().min(1),
  tone: z.string().optional().nullable(),
  targetPlatform: z.string().default("both"),
  status: z.string().default("draft"),
  aiModel: z.string().optional().nullable(),
  scheduledAt: z.string().optional().nullable(),
  tweets: z.array(z.object({
    content: z.string().min(1),
    position: z.number(),
    charCount: z.number().optional(),
  })).default([]),
});

const createIdeaBody = z.object({
  title: z.string().min(1).max(280),
  notes: z.string().optional().nullable(),
  pillarId: z.union([z.number(), z.string().transform(Number), z.null()]).optional().nullable(),
});

const updateStatusBody = z.object({
  status: z.enum(["draft", "ready", "scheduled", "posted", "failed"]),
  scheduledAt: z.string().optional(),
});

const generateBody = z.object({
  pillar: z.string().optional(),
  postType: z.string().min(1),
  tone: z.string().min(1),
  platform: z.string().min(1),
  context: z.string().optional(),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.use("/uploads", (await import("express")).default.static(uploadsDir));

  // ==================== PILLARS ====================
  app.get("/api/pillars", async (_req, res) => {
    try { res.json(await storage.getPillars()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ==================== POSTS ====================
  app.get("/api/posts", async (_req, res) => {
    try { res.json(await storage.getPosts()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/posts/:id", async (req, res) => {
    try {
      const result = await storage.getPost(parseInt(req.params.id));
      if (!result) return res.status(404).json({ message: "Post not found" });
      res.json(result);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/posts", async (req, res) => {
    try {
      const parsed = createPostBody.parse(req.body);
      const { tweets: tweetData, ...postData } = parsed;
      const result = await storage.createPost(
        {
          pillarId: postData.pillarId ?? null,
          postType: postData.postType,
          tone: postData.tone ?? null,
          targetPlatform: postData.targetPlatform,
          status: postData.status,
          aiModel: postData.aiModel ?? null,
          scheduledAt: postData.scheduledAt ? new Date(postData.scheduledAt) : null,
        },
        tweetData.map((t) => ({ postId: 0, content: t.content, position: t.position, charCount: t.charCount ?? t.content.length }))
      );
      res.status(201).json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors.map((e) => e.message).join(", ") });
      res.status(400).json({ message: err.message });
    }
  });

  app.put("/api/posts/:id", async (req, res) => {
    try {
      const result = await storage.updatePost(parseInt(req.params.id), req.body);
      if (!result) return res.status(404).json({ message: "Post not found" });
      res.json(result);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch("/api/posts/:id/status", async (req, res) => {
    try {
      const parsed = updateStatusBody.parse(req.body);
      const result = await storage.updatePostStatus(parseInt(req.params.id), parsed.status, parsed.scheduledAt);
      if (!result) return res.status(404).json({ message: "Post not found" });
      res.json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors.map((e) => e.message).join(", ") });
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/posts/:id", async (req, res) => {
    try { await storage.deletePost(parseInt(req.params.id)); res.status(204).send(); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ==================== IDEAS ====================
  app.get("/api/ideas", async (_req, res) => {
    try { res.json(await storage.getIdeas()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/ideas", async (req, res) => {
    try {
      const parsed = createIdeaBody.parse(req.body);
      const result = await storage.createIdea({ title: parsed.title, notes: parsed.notes ?? null, pillarId: parsed.pillarId ?? null });
      res.status(201).json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors.map((e) => e.message).join(", ") });
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/ideas/:id", async (req, res) => {
    try { await storage.deleteIdea(parseInt(req.params.id)); res.status(204).send(); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/ideas/:id/expand", async (req, res) => {
    try {
      const idea = (await storage.getIdeas()).find((i) => i.id === parseInt(req.params.id));
      if (!idea) return res.status(404).json({ message: "Idea not found" });
      const allPillars = await storage.getPillars();
      const pillar = allPillars.find((p) => p.id === idea.pillarId);

      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Expand this content idea into a ready-to-post tweet thread (3-5 tweets).\n\nTopic: ${idea.title}\n${idea.notes ? `Notes: ${idea.notes}` : ""}\n${pillar ? `Content Pillar: ${pillar.name} - ${pillar.description}` : ""}\n\nReturn ONLY a JSON object: {"tweets": [{"content": "tweet text"}]}\nEach tweet under 280 characters. First tweet is a hook.` },
      ], true);

      await logAiUsage(usage, latency, "expand_idea");
      const parsed = safeJsonParse(content);
      if (!parsed?.tweets) return res.status(500).json({ message: "AI returned invalid response. Please try again." });

      const post = await storage.createPost(
        { pillarId: idea.pillarId, postType: "thread", tone: "conversational", targetPlatform: "both", status: "draft", aiModel: "gpt-4o-mini" },
        parsed.tweets.map((t: any, i: number) => ({ content: String(t.content || ""), position: i, charCount: String(t.content || "").length, postId: 0 }))
      );
      await storage.updateIdea(parseInt(req.params.id), { isExpanded: true });
      res.json(post);
    } catch (err: any) {
      console.error("Expand idea error:", err);
      res.status(500).json({ message: "Failed to expand idea. Please try again." });
    }
  });

  // ==================== TEMPLATES ====================
  app.get("/api/templates", async (_req, res) => {
    try { res.json(await storage.getTemplates()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/templates/fill", async (req, res) => {
    try {
      const { templateId } = req.body;
      if (!templateId) return res.status(400).json({ message: "templateId is required" });
      const allTemplates = await storage.getTemplates();
      const template = allTemplates.find((t) => t.id === Number(templateId));
      if (!template) return res.status(404).json({ message: "Template not found" });
      const allPillars = await storage.getPillars();
      const pillar = allPillars.find((p) => p.id === template.pillarId);

      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Fill in this tweet template with specific, real-world content.\n\nTemplate: "${template.pattern}"\n${pillar ? `Content Pillar: ${pillar.name}` : ""}\n\nReturn ONLY the filled-in tweet text. Keep it under 280 characters if possible.` },
      ]);
      await logAiUsage(usage, latency, "fill_template");
      res.json({ content: content.trim(), model: "gpt-4o-mini" });
    } catch (err: any) {
      console.error("Fill template error:", err);
      res.status(500).json({ message: "Failed to fill template. Please try again." });
    }
  });

  // ==================== GENERATE ====================
  app.post("/api/generate", async (req, res) => {
    try {
      const parsed = generateBody.parse(req.body);
      const allPillars = await storage.getPillars();
      const pillar = parsed.pillar ? allPillars.find((p) => p.id === parseInt(parsed.pillar!)) : null;
      const charLimit = parsed.platform === "threads" ? 500 : 280;
      const tweetCount = parsed.postType === "thread" ? "5-7" : "1";

      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Generate 3 variations of a ${parsed.postType} post for ${parsed.platform === "both" ? "X and Threads" : parsed.platform}.\n\n${pillar ? `Content Pillar: ${pillar.name} - ${pillar.description}` : ""}\nPost Type: ${parsed.postType} (${tweetCount} tweets/posts per variation)\nTone: ${parsed.tone}\nCharacter limit per tweet/post: ${charLimit}\n${parsed.context ? `Context/Topic: ${parsed.context}` : ""}\n\nReturn JSON: {"variations": [{"tweets": [{"content": "text"}]}, {"tweets": [{"content": "text"}]}, {"tweets": [{"content": "text"}]}]}\n\nEach variation should have ${tweetCount} tweet(s). Each tweet MUST be under ${charLimit} characters. Make them distinct.` },
      ], true);

      await logAiUsage(usage, latency, "generate");
      const result = safeJsonParse(content);
      if (!result?.variations) return res.status(500).json({ message: "AI returned invalid response. Please try again." });

      const variations = result.variations.map((v: any) => ({
        tweets: (v.tweets || []).map((t: any) => ({ content: String(t.content || ""), charCount: String(t.content || "").length })),
      }));
      res.json({ variations, model: "gpt-4o-mini" });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors.map((e) => e.message).join(", ") });
      console.error("Generate error:", err);
      res.status(500).json({ message: "Failed to generate content. Please try again." });
    }
  });

  // ==================== ANALYTICS ====================
  app.get("/api/analytics/summary", async (_req, res) => {
    try { res.json(await storage.getAnalyticsSummary()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/analytics", async (req, res) => {
    try { res.status(201).json(await storage.createAnalytics(req.body)); }
    catch (err: any) { res.status(400).json({ message: err.message }); }
  });

  app.get("/api/usage", async (_req, res) => {
    try { res.json(await storage.getAiUsageLogs()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ==================== ARTICLES ====================
  app.get("/api/articles", async (_req, res) => {
    try { res.json(await storage.getArticles()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/articles/:id", async (req, res) => {
    try {
      const result = await storage.getArticle(parseInt(req.params.id));
      if (!result) return res.status(404).json({ message: "Article not found" });
      res.json(result);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/articles", async (req, res) => {
    try {
      const body = z.object({
        title: z.string().min(1).max(200),
        subtitle: z.string().max(300).optional().nullable(),
        contentJson: z.any().default({}),
        contentHtml: z.string().optional().nullable(),
        contentMarkdown: z.string().optional().nullable(),
        wordCount: z.number().optional().default(0),
        estimatedReadMinutes: z.number().optional().default(0),
        seoDescription: z.string().max(200).optional().nullable(),
        articleTemplate: z.string().optional().nullable(),
        status: z.string().default("draft"),
        pillarId: z.union([z.number(), z.string().transform(Number), z.null()]).optional().nullable(),
        coverImageUrl: z.string().optional().nullable(),
      }).parse(req.body);
      const result = await storage.createArticle(body as any);
      res.status(201).json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors.map((e) => e.message).join(", ") });
      res.status(400).json({ message: err.message });
    }
  });

  app.put("/api/articles/:id", async (req, res) => {
    try {
      const result = await storage.updateArticle(parseInt(req.params.id), req.body);
      if (!result) return res.status(404).json({ message: "Article not found" });
      res.json(result);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/articles/:id", async (req, res) => {
    try { await storage.deleteArticle(parseInt(req.params.id)); res.status(204).send(); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/articles/upload-image", upload.single("image"), (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No image uploaded" });
    res.json({ url: `/uploads/${req.file.filename}` });
  });

  app.post("/api/articles/:id/generate-outline", async (req, res) => {
    try {
      const article = await storage.getArticle(parseInt(req.params.id));
      if (!article) return res.status(404).json({ message: "Article not found" });
      const { topic } = req.body;
      const allPillars = await storage.getPillars();
      const pillar = allPillars.find((p) => p.id === article.pillarId);

      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Generate a detailed article outline for an X Article (long-form post).\n\nTitle: ${article.title}\n${topic ? `Topic/Focus: ${topic}` : ""}\n${article.articleTemplate ? `Template Style: ${article.articleTemplate}` : ""}\n${pillar ? `Content Pillar: ${pillar.name}` : ""}\n\nReturn JSON: {"sections": [{"heading": "Section Title", "description": "What to cover in 1-2 sentences", "key_points": ["point1", "point2"]}]}\n\nCreate 5-8 sections that flow logically. Include intro and conclusion.` },
      ], true);

      await logAiUsage(usage, latency, "article_outline");
      const parsed = safeJsonParse(content);
      if (!parsed?.sections) return res.status(500).json({ message: "AI returned invalid response." });
      res.json(parsed);
    } catch (err: any) {
      console.error("Generate outline error:", err);
      res.status(500).json({ message: "Failed to generate outline." });
    }
  });

  app.post("/api/articles/:id/expand-section", async (req, res) => {
    try {
      const article = await storage.getArticle(parseInt(req.params.id));
      if (!article) return res.status(404).json({ message: "Article not found" });
      const { heading, description, keyPoints } = req.body;

      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Expand this section of an X Article into 2-4 detailed paragraphs.\n\nArticle Title: ${article.title}\nSection Heading: ${heading}\n${description ? `Description: ${description}` : ""}\n${keyPoints ? `Key Points: ${keyPoints.join(", ")}` : ""}\n\nWrite in Kishore's voice. Include specific tools, metrics, code examples where relevant. Make it technically credible and engaging.\n\nReturn ONLY the expanded section text (HTML format with <p>, <code>, <strong> tags). No JSON wrapper.` },
      ]);

      await logAiUsage(usage, latency, "expand_section");
      res.json({ content: content.trim() });
    } catch (err: any) {
      console.error("Expand section error:", err);
      res.status(500).json({ message: "Failed to expand section." });
    }
  });

  app.post("/api/articles/:id/generate-full", async (req, res) => {
    try {
      const article = await storage.getArticle(parseInt(req.params.id));
      if (!article) return res.status(404).json({ message: "Article not found" });
      const { outline } = req.body;
      const allPillars = await storage.getPillars();
      const pillar = allPillars.find((p) => p.id === article.pillarId);

      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Write a complete X Article (1,500-2,500 words) based on this outline.\n\nTitle: ${article.title}\n${article.subtitle ? `Subtitle: ${article.subtitle}` : ""}\n${pillar ? `Content Pillar: ${pillar.name}` : ""}\n${outline ? `Outline:\n${JSON.stringify(outline)}` : ""}\n\nWrite in rich HTML format with proper headings (h2, h3), paragraphs, code blocks, lists, and blockquotes. Make it technically deep, engaging, and full of specific examples. Include code snippets where relevant.\n\nReturn the full article as HTML content.` },
      ]);

      await logAiUsage(usage, latency, "generate_full_article");
      const wordCount = content.replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
      res.json({ content: content.trim(), wordCount, estimatedReadMinutes: Math.ceil(wordCount / 200) });
    } catch (err: any) {
      console.error("Generate full article error:", err);
      res.status(500).json({ message: "Failed to generate article." });
    }
  });

  app.post("/api/articles/:id/improve", async (req, res) => {
    try {
      const article = await storage.getArticle(parseInt(req.params.id));
      if (!article) return res.status(404).json({ message: "Article not found" });
      const { text, goal } = req.body;

      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Improve this section of text from an X Article.\n\nOriginal text: "${text}"\nGoal: ${goal || "Improve clarity, impact, and technical depth"}\n\nReturn ONLY the improved text. Keep the same format (HTML if it was HTML).` },
      ]);

      await logAiUsage(usage, latency, "improve_section");
      res.json({ content: content.trim() });
    } catch (err: any) {
      console.error("Improve error:", err);
      res.status(500).json({ message: "Failed to improve text." });
    }
  });

  app.post("/api/articles/:id/generate-meta", async (req, res) => {
    try {
      const article = await storage.getArticle(parseInt(req.params.id));
      if (!article) return res.status(404).json({ message: "Article not found" });

      const articleText = article.contentHtml || article.contentMarkdown || article.title;
      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Generate metadata for this X Article.\n\nTitle: ${article.title}\nContent preview: ${String(articleText).substring(0, 500)}\n\nReturn JSON: {"suggestions": [{"title": "...", "subtitle": "...", "seoDescription": "max 160 chars"}]}\n\nGenerate 5 title/subtitle/SEO combos optimized for clicks and engagement.` },
      ], true);

      await logAiUsage(usage, latency, "generate_meta");
      const parsed = safeJsonParse(content);
      if (!parsed?.suggestions) return res.status(500).json({ message: "AI returned invalid response." });
      res.json(parsed);
    } catch (err: any) {
      console.error("Generate meta error:", err);
      res.status(500).json({ message: "Failed to generate metadata." });
    }
  });

  app.post("/api/articles/:id/to-thread", async (req, res) => {
    try {
      const article = await storage.getArticle(parseInt(req.params.id));
      if (!article) return res.status(404).json({ message: "Article not found" });

      const articleText = article.contentHtml || article.contentMarkdown || "";
      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Convert this X Article into a 5-10 tweet thread for cross-promotion.\n\nTitle: ${article.title}\nContent: ${articleText.substring(0, 3000)}\n\nReturn JSON: {"tweets": [{"content": "tweet text"}]}\nEach tweet under 280 chars. First tweet is the hook. Last tweet links to the article.` },
      ], true);

      await logAiUsage(usage, latency, "article_to_thread");
      const parsed = safeJsonParse(content);
      if (!parsed?.tweets) return res.status(500).json({ message: "AI returned invalid response." });

      const post = await storage.createPost(
        { pillarId: article.pillarId, postType: "thread", tone: "educational", targetPlatform: "x", status: "draft", aiModel: "gpt-4o-mini" },
        parsed.tweets.map((t: any, i: number) => ({ content: String(t.content || ""), position: i, charCount: String(t.content || "").length, postId: 0 }))
      );
      res.json(post);
    } catch (err: any) {
      console.error("Article to thread error:", err);
      res.status(500).json({ message: "Failed to convert article to thread." });
    }
  });

  app.post("/api/articles/:id/to-tweet", async (req, res) => {
    try {
      const article = await storage.getArticle(parseInt(req.params.id));
      if (!article) return res.status(404).json({ message: "Article not found" });

      const articleText = article.contentHtml || article.contentMarkdown || "";
      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Create a compelling single tweet (under 280 chars) promoting this X Article.\n\nTitle: ${article.title}\nContent preview: ${articleText.substring(0, 1000)}\n\nReturn ONLY the tweet text. Make it a scroll-stopper.` },
      ]);

      await logAiUsage(usage, latency, "article_to_tweet");
      res.json({ content: content.trim() });
    } catch (err: any) {
      console.error("Article to tweet error:", err);
      res.status(500).json({ message: "Failed to create tweet summary." });
    }
  });

  app.post("/api/threads/:id/to-article", async (req, res) => {
    try {
      const post = await storage.getPost(parseInt(req.params.id));
      if (!post) return res.status(404).json({ message: "Thread not found" });

      const threadText = post.tweets.map((t) => t.content).join("\n\n");
      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Expand this tweet thread into a full X Article (1,500-2,500 words).\n\nThread:\n${threadText}\n\nWrite in rich HTML format with h2, h3, paragraphs, code blocks, lists, blockquotes. Expand each tweet into a full section. Add depth, examples, and technical detail.\n\nReturn the full article as HTML.` },
      ]);

      await logAiUsage(usage, latency, "thread_to_article");
      const wordCount = content.replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;

      const article = await storage.createArticle({
        title: post.tweets[0]?.content.substring(0, 100) || "Expanded Article",
        contentJson: {},
        contentHtml: content.trim(),
        wordCount,
        estimatedReadMinutes: Math.ceil(wordCount / 200),
        pillarId: post.pillarId,
        status: "draft",
        postId: post.id,
      });
      res.json(article);
    } catch (err: any) {
      console.error("Thread to article error:", err);
      res.status(500).json({ message: "Failed to convert thread to article." });
    }
  });

  // ==================== SOURCE ANALYSIS / REFERENCES ====================
  app.get("/api/references", async (_req, res) => {
    try { res.json(await storage.getReferences()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/references/:id", async (req, res) => {
    try {
      const result = await storage.getReference(parseInt(req.params.id));
      if (!result) return res.status(404).json({ message: "Reference not found" });
      res.json(result);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ==================== URL DETECTION & EXTRACTION HELPERS ====================

  function detectSourceType(url: string): { sourceType: string; sourcePlatform: string } {
    const u = url.toLowerCase();
    if (u.includes("x.com/") || u.includes("twitter.com/")) {
      if (/\/status\/\d+/.test(u)) return { sourceType: "x_tweet", sourcePlatform: "x" };
      return { sourceType: "x_account", sourcePlatform: "x" };
    }
    if (u.includes("reddit.com/r/") && u.includes("/comments/")) return { sourceType: "reddit_thread", sourcePlatform: "reddit" };
    if (u.includes("reddit.com/r/")) return { sourceType: "reddit_subreddit", sourcePlatform: "reddit" };
    if (u.includes("github.com/") && (u.includes("/issues/") || u.includes("/discussions/"))) return { sourceType: "github_discussion", sourcePlatform: "github" };
    if (u.includes("github.com/") && u.split("/").filter(Boolean).length >= 4) return { sourceType: "github_repo", sourcePlatform: "github" };
    if (u.includes("arxiv.org/abs/") || u.includes("arxiv.org/pdf/")) return { sourceType: "arxiv_paper", sourcePlatform: "arxiv" };
    if (u.includes("youtube.com/watch") || u.includes("youtu.be/")) return { sourceType: "youtube_video", sourcePlatform: "youtube" };
    if (u.includes("linkedin.com/posts/") || u.includes("linkedin.com/feed/")) return { sourceType: "linkedin_post", sourcePlatform: "linkedin" };
    if (u.includes("linkedin.com/pulse/")) return { sourceType: "linkedin_article", sourcePlatform: "linkedin" };
    if (u.includes("substack.com")) return { sourceType: "blog_article", sourcePlatform: "substack" };
    if (u.includes("medium.com") || u.includes("dev.to") || u.includes("hashnode.dev")) return { sourceType: "blog_article", sourcePlatform: "blog" };
    return { sourceType: "generic_webpage", sourcePlatform: "web" };
  }

  async function extractRedditThread(url: string) {
    let cleanUrl = url.replace(/\?.*$/, "").replace(/\/$/, "");
    if (!cleanUrl.endsWith(".json")) cleanUrl += ".json";
    const response = await fetch(cleanUrl, {
      headers: { "User-Agent": "ContentForge/1.0 (content analysis tool)", "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`Reddit returned ${response.status}`);
    const text = await response.text();
    let data: any[];
    try { data = JSON.parse(text); } catch { throw new Error("Reddit did not return JSON. The URL may be invalid."); }
    if (!Array.isArray(data) || data.length < 1) throw new Error("Invalid Reddit response");

    const post = data[0]?.data?.children?.[0]?.data;
    if (!post) throw new Error("Could not parse Reddit post");

    const comments = (data[1]?.data?.children || [])
      .filter((c: any) => c.kind === "t1")
      .slice(0, 30)
      .map((c: any) => ({
        author: c.data.author,
        body: (c.data.body || "").substring(0, 500),
        score: c.data.score,
      }));

    return {
      title: post.title,
      selftext: (post.selftext || "").substring(0, 3000),
      author: post.author,
      subreddit: post.subreddit,
      score: post.score,
      numComments: post.num_comments,
      url: `https://reddit.com${post.permalink}`,
      comments,
    };
  }

  async function extractGitHubRepo(url: string) {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/\?#]+)/);
    if (!match) throw new Error("Invalid GitHub URL");
    const [, owner, repo] = match;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const response = await fetch(apiUrl, {
      headers: { "User-Agent": "ContentForge/1.0", "Accept": "application/vnd.github.v3+json" },
      signal: AbortSignal.timeout(10000),
    });
    const repoData = await response.json() as any;
    let readme = "";
    try {
      const readmeRes = await fetch(`${apiUrl}/readme`, {
        headers: { "User-Agent": "ContentForge/1.0", "Accept": "application/vnd.github.v3.raw" },
        signal: AbortSignal.timeout(10000),
      });
      readme = (await readmeRes.text()).substring(0, 3000);
    } catch (e) { /* no readme */ }

    return {
      name: repoData.full_name,
      description: repoData.description,
      stars: repoData.stargazers_count,
      forks: repoData.forks_count,
      language: repoData.language,
      topics: repoData.topics || [],
      openIssues: repoData.open_issues_count,
      readme,
    };
  }

  async function extractArxivPaper(url: string) {
    const idMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/);
    if (!idMatch) throw new Error("Invalid ArXiv URL");
    const arxivId = idMatch[1];
    const apiUrl = `http://export.arxiv.org/api/query?id_list=${arxivId}`;
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
    const xml = await response.text();
    const $ = cheerio.load(xml, { xml: true });
    const entry = $("entry").first();
    return {
      title: entry.find("title").text().trim(),
      abstract: entry.find("summary").text().trim().substring(0, 3000),
      authors: entry.find("author name").map((_: any, el: any) => $(el).text()).get(),
      published: entry.find("published").text(),
      categories: entry.find("category").map((_: any, el: any) => $(el).attr("term")).get(),
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    };
  }

  async function extractGenericWebpage(url: string) {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ContentForge/1.0)" },
      signal: AbortSignal.timeout(10000),
    });
    const html = await response.text();
    const $ = cheerio.load(html);
    $("script, style, nav, footer, header, aside, .sidebar, .ad, .advertisement, .cookie-banner").remove();

    const title = $('meta[property="og:title"]').attr("content") || $("title").text().trim() || $("h1").first().text().trim() || url;
    const author = $('meta[name="author"]').attr("content") || $('meta[property="article:author"]').attr("content") || "";
    const description = $('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content") || "";
    const mainContent = $("article, main, .content, .post-content, .entry-content, [role='main']").text().trim();
    const bodyText = mainContent || $("body").text().trim();
    const cleanedContent = bodyText.replace(/\s+/g, " ").substring(0, 5000);

    return { title, author, description, content: cleanedContent, html };
  }

  // ==================== UNIVERSAL INGEST ENDPOINT ====================

  app.post("/api/ingest", async (req, res) => {
    try {
      const { url, text: pastedText, xUsername } = req.body;

      if (xUsername) {
        const username = xUsername.replace(/^@/, "").replace(/^https?:\/\/(x|twitter)\.com\//, "").replace(/\/.*$/, "");
        const { content, usage, latency } = await aiCall([
          { role: "system", content: "You are a content strategy analyst specializing in X/Twitter accounts. Analyze writing styles and strategies deeply." },
          { role: "user", content: `Analyze the X account @${username}. Based on your knowledge of this account's public presence and content strategy, provide a detailed analysis.

Return JSON:
{
  "account_summary": {
    "niche": "What topics they cover",
    "positioning": "How they position themselves",
    "audience": "Who follows them and why",
    "posting_frequency": "How often they post",
    "engagement_rate": "Estimated engagement level"
  },
  "content_strategy": {
    "content_mix": {"threads": "30%", "single_tweets": "50%", "replies": "15%", "polls": "5%"},
    "top_topics": ["topic1", "topic2", "topic3"],
    "thread_frequency": "How often they post threads"
  },
  "writing_style": {
    "tone": "casual/technical/provocative/educational/humorous/inspirational",
    "voice_characteristics": ["direct", "uses metaphors", "data-heavy"],
    "sentence_length": "short/medium/long/mixed",
    "vocabulary_level": "simple/intermediate/advanced",
    "emoji_usage": "none/minimal/moderate/heavy",
    "hashtag_strategy": "none/minimal/heavy",
    "hook_patterns": ["Types of hooks they use"],
    "cta_patterns": ["How they end posts"],
    "formatting_style": "How they use line breaks, capitalization"
  },
  "viral_patterns": {
    "common_viral_triggers": ["What triggers their best content uses"],
    "format_patterns": ["What formats perform best"],
    "topic_performance": {"topic1": "high", "topic2": "medium"}
  },
  "lessons_for_kishore": {
    "techniques_to_adopt": ["Specific techniques Kishore can borrow"],
    "techniques_to_skip": ["Things that wouldn't work for Kishore's niche"],
    "content_gaps": ["Topics Kishore could cover with a DevOps/Infra angle"],
    "style_elements_to_borrow": ["Specific style elements worth adopting"]
  }
}` },
        ], true);

        await logAiUsage(usage, latency, "analyze_x_account");
        const analysis = safeJsonParse(content);
        if (!analysis) return res.status(500).json({ message: "AI analysis failed." });

        const stylePrompt = analysis.writing_style ? `STYLE REFERENCE: Mimic the following writing style characteristics while keeping Kishore's voice and expertise:
- Tone: ${analysis.writing_style.tone}
- Sentence structure: ${analysis.writing_style.sentence_length}
- Hook technique: ${(analysis.writing_style.hook_patterns || []).join(", ")}
- Formatting: ${analysis.writing_style.formatting_style}
- Emoji usage: ${analysis.writing_style.emoji_usage}
- Vocabulary level: ${analysis.writing_style.vocabulary_level}
IMPORTANT: Do NOT copy any specific content. Only mirror the structural and stylistic patterns.
Kishore's unique expertise (DevOps, multi-cloud, Kubernetes, platform engineering) must remain central.` : "";

        const ref = await storage.createReference({
          sourceUrl: `https://x.com/${username}`,
          sourceType: "x_account",
          sourcePlatform: "x",
          sourceAuthorUsername: username,
          sourceAuthorDisplayName: username,
          rawContent: `X account analysis: @${username}`,
          analysisJson: analysis,
          styleAnalysisJson: analysis.writing_style || {},
          title: `@${username} — X Account Analysis`,
          tags: analysis.content_strategy?.top_topics || [],
        });

        return res.json(ref);
      }

      if (!url && !pastedText) return res.status(400).json({ message: "Provide a URL, text, or X username." });

      let extractedData: any = {};
      let { sourceType, sourcePlatform } = url ? detectSourceType(url) : { sourceType: "pasted_text", sourcePlatform: "manual" };
      let rawContent = "";
      let title = "";
      let author = "";
      let engagementMetrics: any = null;
      let analysisPrompt = "";

      if (url) {
        try {
          switch (sourceType) {
            case "reddit_thread": {
              const reddit = await extractRedditThread(url);
              rawContent = `POST: ${reddit.title}\n\n${reddit.selftext}\n\nTOP COMMENTS:\n${reddit.comments.map((c: any) => `[${c.score}pts] ${c.author}: ${c.body}`).join("\n\n")}`;
              title = reddit.title;
              author = reddit.author;
              engagementMetrics = { score: reddit.score, numComments: reddit.numComments };
              analysisPrompt = `Analyze this Reddit discussion for content creation opportunities:

SUBREDDIT: r/${reddit.subreddit}
POST TITLE: ${reddit.title}
POST BODY: ${reddit.selftext}
POST SCORE: ${reddit.score} upvotes, ${reddit.numComments} comments

TOP COMMENTS (sorted by score):
${JSON.stringify(reddit.comments)}

Return JSON:
{
  "discussion_summary": "What's being discussed and why it's generating engagement",
  "key_opinions": [{"opinion": "Main stance", "support_level": "How many agree", "counter_arguments": ["pushback"]}],
  "insights_worth_sharing": ["Genuine insights Kishore's audience would find valuable"],
  "common_pain_points": ["Frustrations people express — content goldmines"],
  "controversial_takes": ["Divisive opinions that make great hot takes"],
  "questions_asked": ["Questions Kishore could answer authoritatively"],
  "content_ideas": [{"idea": "Content idea", "format": "thread/tweet/article/hot_take", "hook": "Opening line", "angle": "Kishore's unique angle"}],
  "notable_quotes": ["Memorable paraphrased comments"],
  "topic_tags": ["relevant tags"]
}`;
              break;
            }
            case "github_repo":
            case "github_discussion": {
              const gh = await extractGitHubRepo(url);
              rawContent = `${gh.name}: ${gh.description}\nStars: ${gh.stars} | Forks: ${gh.forks} | Language: ${gh.language}\nTopics: ${gh.topics.join(", ")}\n\nREADME:\n${gh.readme}`;
              title = gh.name;
              engagementMetrics = { stars: gh.stars, forks: gh.forks, openIssues: gh.openIssues };
              analysisPrompt = `Analyze this GitHub repository for content creation opportunities:

REPO: ${gh.name}
DESCRIPTION: ${gh.description}
STARS: ${gh.stars} | FORKS: ${gh.forks} | LANGUAGE: ${gh.language}
TOPICS: ${gh.topics.join(", ")}
README (excerpt): ${gh.readme}

Return JSON:
{
  "summary": "What this project does and why it matters",
  "key_features": ["Notable features or innovations"],
  "tech_stack_analysis": "Analysis of the technology choices",
  "community_signals": "What the stars/forks/issues say about adoption",
  "content_ideas": [{"idea": "Content idea", "format": "thread/tweet/article", "hook": "Opening line", "angle": "Kishore's DevOps/Infra perspective"}],
  "comparison_opportunities": ["Tools/projects to compare against"],
  "tutorial_potential": "Could this make a good tutorial or deep dive?",
  "gaps_and_angles": ["Where Kishore's expertise adds unique value"],
  "topic_tags": ["relevant tags"]
}`;
              break;
            }
            case "arxiv_paper": {
              const paper = await extractArxivPaper(url);
              rawContent = `${paper.title}\nAuthors: ${paper.authors.join(", ")}\nCategories: ${paper.categories.join(", ")}\n\nAbstract: ${paper.abstract}`;
              title = paper.title;
              author = paper.authors.join(", ");
              analysisPrompt = `Analyze this research paper for content creation opportunities:

TITLE: ${paper.title}
AUTHORS: ${paper.authors.join(", ")}
CATEGORIES: ${paper.categories.join(", ")}
ABSTRACT: ${paper.abstract}

Return JSON:
{
  "summary": "Plain-English summary of the paper's contributions",
  "key_findings": ["Main findings and results"],
  "practical_implications": ["What this means for practitioners"],
  "content_ideas": [{"idea": "Content idea", "format": "thread/tweet/article", "hook": "Opening line", "angle": "Kishore's infrastructure perspective"}],
  "eli5_explanation": "Explain the paper's core idea simply",
  "industry_relevance": "How this applies to real-world infrastructure/AI",
  "gaps_and_angles": ["Where Kishore can add practitioner perspective"],
  "topic_tags": ["relevant tags"]
}`;
              break;
            }
            default: {
              const webpage = await extractGenericWebpage(url);
              rawContent = webpage.content;
              title = webpage.title;
              author = webpage.author;
              analysisPrompt = `Analyze the following content thoroughly:

TITLE: ${webpage.title}
AUTHOR: ${webpage.author}
DESCRIPTION: ${webpage.description}

CONTENT:
${webpage.content}

Return JSON:
{
  "summary": "2-3 sentence summary of the core message",
  "key_points": ["5-10 main arguments or insights"],
  "writing_style": {
    "tone": "technical/casual/provocative/storytelling/academic/humorous",
    "sentence_structure": "short_punchy/long_flowing/mixed",
    "vocabulary_level": "beginner/intermediate/advanced/expert",
    "hook_technique": "question/bold_claim/statistic/story/controversy",
    "cta_technique": "question/call_to_action/summary/open_ended"
  },
  "engagement_signals": {
    "why_it_works": "why this content resonates",
    "emotional_triggers": ["curiosity", "contrarian", etc.],
    "structural_patterns": ["numbered list", "problem/solution", etc.]
  },
  "content_ideas": [{"idea": "Content idea", "format": "thread/tweet/article/hot_take", "hook": "Opening line", "angle": "Kishore's DevOps/Infra perspective"}],
  "data_points": ["statistics or numbers mentioned"],
  "quotes_worth_referencing": ["notable quotes"],
  "gaps_and_angles": ["things the source missed or where Kishore could add unique value"],
  "topic_tags": ["relevant topics"]
}`;
              break;
            }
          }
        } catch (fetchErr: any) {
          if (!pastedText) return res.status(400).json({ message: `Could not fetch URL: ${fetchErr.message}. Try pasting the content instead.` });
        }
      }

      if (pastedText && !rawContent) {
        rawContent = pastedText.substring(0, 5000);
        title = pastedText.substring(0, 100);
        sourceType = "pasted_text";
        sourcePlatform = "manual";
        analysisPrompt = `Analyze this pasted content thoroughly:

CONTENT:
${rawContent}

Return JSON:
{
  "summary": "2-3 sentence summary",
  "key_points": ["main arguments or insights"],
  "writing_style": {
    "tone": "technical/casual/provocative/storytelling",
    "sentence_structure": "short_punchy/long_flowing/mixed",
    "vocabulary_level": "beginner/intermediate/advanced/expert",
    "hook_technique": "question/bold_claim/statistic/story",
    "cta_technique": "question/call_to_action/summary"
  },
  "engagement_signals": {
    "why_it_works": "analysis of resonance",
    "emotional_triggers": ["triggers"],
    "structural_patterns": ["patterns"]
  },
  "content_ideas": [{"idea": "Content idea", "format": "thread/tweet/article/hot_take", "hook": "Opening line", "angle": "Kishore's unique angle"}],
  "gaps_and_angles": ["Where Kishore could add unique value"],
  "topic_tags": ["relevant topics"]
}`;
      }

      if (!rawContent) return res.status(400).json({ message: "No content extracted." });

      const { content, usage, latency } = await aiCall([
        { role: "system", content: "You are a content analysis expert for social media strategy. Analyze content deeply for style, structure, engagement patterns, and content creation opportunities." },
        { role: "user", content: analysisPrompt },
      ], true);

      await logAiUsage(usage, latency, `ingest_${sourceType}`);
      const analysis = safeJsonParse(content);
      if (!analysis) return res.status(500).json({ message: "AI analysis failed. Please try again." });

      const ref = await storage.createReference({
        sourceUrl: url || null,
        sourceType,
        sourcePlatform,
        sourceAuthorUsername: author || null,
        rawContent,
        analysisJson: analysis,
        styleAnalysisJson: analysis.writing_style || null,
        title: title.substring(0, 500),
        author: author || null,
        sourceEngagementMetrics: engagementMetrics,
        tags: analysis.topic_tags || [],
        wordCount: rawContent.split(/\s+/).length,
      });

      res.json(ref);
    } catch (err: any) {
      console.error("Ingest error:", err);
      res.status(500).json({ message: "Failed to analyze content." });
    }
  });

  // Keep legacy endpoint as alias
  app.post("/api/references/analyze", async (req, res) => {
    req.url = "/api/ingest";
    app.handle(req, res);
  });

  // ==================== BATCH INGEST ====================

  app.post("/api/ingest/batch", async (req, res) => {
    try {
      const { sources } = req.body;
      if (!Array.isArray(sources) || sources.length === 0) return res.status(400).json({ message: "Provide an array of sources." });
      if (sources.length > 10) return res.status(400).json({ message: "Maximum 10 sources per batch." });

      const batchId = `batch_${Date.now()}`;
      const results: any[] = [];
      const analysisTexts: string[] = [];

      for (const src of sources) {
        try {
          const fakeRes: any = {
            json: (data: any) => { results.push(data); analysisTexts.push(JSON.stringify(data.analysisJson || {})); },
            status: (code: number) => ({ json: (data: any) => { results.push({ error: data.message, source: src }); }, send: () => {} }),
          };
          const fakeReq: any = { body: src, url: "/api/ingest" };
          await new Promise<void>((resolve) => {
            const origJson = fakeRes.json;
            fakeRes.json = (data: any) => { origJson(data); resolve(); };
            const origStatus = fakeRes.status;
            fakeRes.status = (code: number) => {
              const s = origStatus(code);
              const origSJson = s.json;
              s.json = (data: any) => { origSJson(data); resolve(); };
              return s;
            };
            app.handle(fakeReq, fakeRes);
          });
        } catch (e) {
          results.push({ error: "Failed to process source", source: src });
        }
      }

      const successRefs = results.filter((r) => r.id);
      for (const ref of successRefs) {
        await storage.updateReference(ref.id, { batchId });
      }

      if (successRefs.length >= 2) {
        try {
          const { content, usage, latency } = await aiCall([
            { role: "system", content: "You are a content synthesis expert. Analyze multiple sources together to find patterns and unique content angles." },
            { role: "user", content: `I have collected ${successRefs.length} sources on related topics. Synthesize:

${analysisTexts.map((a, i) => `SOURCE ${i + 1}: ${a.substring(0, 1500)}`).join("\n\n")}

Return JSON:
{
  "unified_topic": "Common topic across sources",
  "consensus_points": ["What most sources agree on"],
  "disagreement_points": ["Where sources contradict — GOLD for content"],
  "unique_per_source": [{"source": 1, "unique_insight": "What only this source mentions"}],
  "missing_perspectives": ["What NONE cover — especially from DevOps/Infra angle"],
  "synthesis_content_ideas": [{"idea": "Content synthesizing multiple perspectives", "format": "thread/article/tweet", "angle": "Kishore's unique take", "hook": "Opening line"}],
  "debate_content_ideas": [{"idea": "Content highlighting disagreements", "format": "thread/hot_take", "kishore_stance": "Where Kishore stands", "supporting_evidence": "From which sources"}]
}` },
          ], true);

          await logAiUsage(usage, latency, "batch_synthesis");
          const synthesis = safeJsonParse(content);
          if (synthesis) {
            for (const ref of successRefs) {
              await storage.updateReference(ref.id, { batchSynthesisJson: synthesis });
            }
          }
        } catch (e) {
          console.error("Batch synthesis error:", e);
        }
      }

      res.json({ batchId, references: successRefs, errors: results.filter((r) => r.error), totalProcessed: sources.length });
    } catch (err: any) {
      console.error("Batch ingest error:", err);
      res.status(500).json({ message: "Batch processing failed." });
    }
  });

  // ==================== SCREENSHOT INGEST ====================

  app.post("/api/ingest/screenshot", upload.array("screenshots", 10), async (req: any, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) return res.status(400).json({ message: "Upload at least one screenshot." });

      const imageContents = await Promise.all(files.map(async (f) => {
        const imageData = fs.readFileSync(f.path);
        const base64 = imageData.toString("base64");
        const mimeType = f.mimetype || "image/png";
        return { type: "image_url" as const, image_url: { url: `data:${mimeType};base64,${base64}` } };
      }));

      const { content, usage, latency } = await aiCall([
        { role: "system", content: "You are an expert at extracting and analyzing content from screenshots. Extract ALL text and context." },
        { role: "user", content: [
          { type: "text" as const, text: `Analyze ${files.length > 1 ? "these screenshots" : "this screenshot"}. Extract ALL text and provide structured analysis.

Return JSON:
{
  "extracted_text": "Full text visible in the screenshot, preserving structure",
  "source_type": "tweet|thread|linkedin_post|article|slack_message|code|slide|chart|infographic|other",
  "source_platform": "x|linkedin|reddit|slack|discord|medium|other",
  "author": "Username or name if visible",
  "engagement_metrics": {"likes": null, "retweets": null, "comments": null, "views": null},
  "content_summary": "2-3 sentence summary",
  "content_quality_signals": "Why this content might be noteworthy",
  "content_ideas": [{"idea": "Content idea from this", "format": "thread/tweet/article", "hook": "Opening line", "angle": "Kishore's unique angle"}],
  "topic_tags": ["relevant tags"]
}` },
          ...imageContents,
        ] as any },
      ], true);

      await logAiUsage(usage, latency, "screenshot_analysis");
      const analysis = safeJsonParse(content);
      if (!analysis) return res.status(500).json({ message: "Screenshot analysis failed." });

      const ref = await storage.createReference({
        sourceType: analysis.source_type || "screenshot",
        sourcePlatform: analysis.source_platform || "manual",
        sourceAuthorUsername: analysis.author || null,
        rawContent: analysis.extracted_text || "",
        screenshotUrls: files.map((f) => f.filename),
        analysisJson: analysis,
        title: analysis.content_summary?.substring(0, 200) || "Screenshot Analysis",
        sourceEngagementMetrics: analysis.engagement_metrics,
        tags: analysis.topic_tags || [],
        wordCount: (analysis.extracted_text || "").split(/\s+/).length,
      });

      res.json(ref);
    } catch (err: any) {
      console.error("Screenshot ingest error:", err);
      res.status(500).json({ message: "Screenshot analysis failed." });
    }
  });

  // ==================== CONTENT ACTIONS ====================

  app.post("/api/content-actions/:action", async (req, res) => {
    try {
      const { action } = req.params;
      const { referenceId, contentType, topic } = req.body;
      const ref = await storage.getReference(parseInt(referenceId));
      if (!ref) return res.status(404).json({ message: "Reference not found" });

      const analysis = ref.analysisJson as any;
      const charLimit = contentType === "thread" ? 280 : contentType === "article" ? 25000 : 280;

      const actionPrompts: Record<string, string> = {
        "my-take": `Based on this source analysis, create Kishore's ORIGINAL take on the topic. Share his perspective from years of infrastructure engineering. ${contentType === "thread" ? "Create a compelling thread." : contentType === "article" ? "Write a full article." : "Write a punchy tweet."}`,
        "remix": `Take the STRUCTURE and FORMAT of this content but apply it to a different topic from Kishore's expertise: ${topic || "DevOps/Infrastructure/Platform Engineering"}. Same structural pattern, completely different content.`,
        "one-up": `This content is good, but Kishore can create a SUPERIOR version. Identify what they missed, got wrong, or could have gone deeper on. Create a more comprehensive, more technically credible version.`,
        "bridge": `Bridge this topic to DevOps/AI/Infrastructure. Start with: "This topic about [X] has huge implications for infrastructure engineers. Here's why:" — Connect the dots between the source topic and Kishore's expertise.`,
        "opposite": `Create a respectful CONTRARIAN take. If the source says X is good, explore why X has challenges. If they're bearish, show the bull case. Contrarian content drives engagement when backed by real experience.`,
        "summarize": `Create a single tweet that summarizes the key insight from this source + adds Kishore's hot take reaction. Format: "[Key insight from source] — My take: [Kishore's reaction]. [Engagement hook]"`,
        "debate": `Create content that respectfully challenges the main thesis. Present Kishore's counter-argument backed by his infrastructure engineering experience. Be specific and constructive, not dismissive.`,
        "quote-tweet": `Generate 5 different quote tweet reactions to this content. Range from: 1) Strongly agree + add nuance, 2) Interesting counterpoint, 3) "Here's what they missed", 4) Personal experience that confirms/denies, 5) Bold prediction building on this.`,
      };

      const promptBase = actionPrompts[action];
      if (!promptBase) return res.status(400).json({ message: `Unknown action: ${action}` });

      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `${promptBase}

SOURCE ANALYSIS:
${JSON.stringify(analysis).substring(0, 3000)}

SOURCE TITLE: ${ref.title}
SOURCE URL: ${ref.sourceUrl || "N/A"}

INSTRUCTIONS:
- Create ORIGINAL content — NEVER copy
- Add Kishore's unique angle: infrastructure engineering, multi-cloud, Kubernetes, platform engineering
- Generate 3 variations with different angles/hooks
${contentType === "thread" ? "- Each tweet under 280 characters" : contentType === "article" ? "- Full article up to 25000 characters" : "- Single tweet under 280 characters"}

Return JSON: {"variations": [{"tweets": [{"content": "text"}]}]}` },
      ], true);

      await logAiUsage(usage, latency, `content_action_${action}`);
      const parsed = safeJsonParse(content);
      if (!parsed?.variations) return res.status(500).json({ message: "AI returned invalid response." });

      const variations = parsed.variations.map((v: any) => ({
        tweets: (v.tweets || []).map((t: any) => ({ content: String(t.content || ""), charCount: String(t.content || "").length })),
      }));

      await storage.createReferenceContent({
        referenceId: ref.id,
        creationAction: action,
      });

      res.json({ variations, model: "gpt-4o-mini", action });
    } catch (err: any) {
      console.error("Content action error:", err);
      res.status(500).json({ message: "Failed to generate content." });
    }
  });

  // ==================== STYLE PROFILES ====================

  app.get("/api/styles", async (req, res) => {
    try { res.json(await storage.getStyleProfiles()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/styles", async (req, res) => {
    try {
      const { name, sourceReferenceId, styleJson, stylePromptSnippet } = req.body;
      if (!name || !stylePromptSnippet) return res.status(400).json({ message: "Name and style prompt snippet are required." });
      const profile = await storage.createStyleProfile({ name, sourceReferenceId, styleJson: styleJson || {}, stylePromptSnippet });
      if (sourceReferenceId) {
        await storage.updateReference(sourceReferenceId, { isStyleSaved: true });
      }
      res.json(profile);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/styles/:id", async (req, res) => {
    try { await storage.deleteStyleProfile(parseInt(req.params.id)); res.status(204).send(); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/styles/:id/apply", async (req, res) => {
    try {
      const profile = await storage.getStyleProfile(parseInt(req.params.id));
      if (!profile) return res.status(404).json({ message: "Style profile not found" });
      const { topic, contentType, pillarId } = req.body;

      await storage.incrementStyleUsage(profile.id);

      const { content, usage, latency } = await aiCall([
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${profile.stylePromptSnippet}` },
        { role: "user", content: `Generate a ${contentType || "thread"} about: ${topic || "a trending DevOps/AI topic"}

${pillarId ? `Content pillar context: #${pillarId}` : ""}

Return JSON: {"variations": [{"tweets": [{"content": "text"}]}]}
${contentType === "thread" ? "Each tweet under 280 characters." : "Single tweet under 280 characters."}` },
      ], true);

      await logAiUsage(usage, latency, "style_apply");
      const parsed = safeJsonParse(content);
      if (!parsed?.variations) return res.status(500).json({ message: "AI returned invalid response." });

      const variations = parsed.variations.map((v: any) => ({
        tweets: (v.tweets || []).map((t: any) => ({ content: String(t.content || ""), charCount: String(t.content || "").length })),
      }));
      res.json({ variations, model: "gpt-4o-mini", styleName: profile.name });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ==================== ENHANCED REFERENCES ENDPOINTS ====================

  app.post("/api/references/:id/generate", async (req, res) => {
    try {
      const ref = await storage.getReference(parseInt(req.params.id));
      if (!ref) return res.status(404).json({ message: "Reference not found" });
      const { contentType, tone, styleProfileId } = req.body;

      let styleSnippet = "";
      if (styleProfileId) {
        const profile = await storage.getStyleProfile(parseInt(styleProfileId));
        if (profile) {
          styleSnippet = `\n\n${profile.stylePromptSnippet}`;
          await storage.incrementStyleUsage(profile.id);
        }
      }

      const charLimit = contentType === "thread" ? 280 : contentType === "article" ? 25000 : 280;
      const { content, usage, latency } = await aiCall([
        { role: "system", content: `${SYSTEM_PROMPT}${styleSnippet}` },
        { role: "user", content: `Based on the following source analysis, create a ${contentType || "thread"} for Kishore's X/Threads account.

SOURCE ANALYSIS:
${JSON.stringify(ref.analysisJson)}

INSTRUCTIONS:
- Create ORIGINAL content inspired by the source — NEVER copy
- Add Kishore's unique angle: infrastructure engineering, multi-cloud, Kubernetes
- Mirror the effective style elements but make it authentically Kishore's voice
- Generate 3 variations with different angles/hooks
${tone ? `- Tone: ${tone}` : ""}

Return JSON: {"variations": [{"tweets": [{"content": "text"}]}]}
Each tweet under ${charLimit} characters.` },
      ], true);

      await logAiUsage(usage, latency, "generate_from_reference");
      const parsed = safeJsonParse(content);
      if (!parsed?.variations) return res.status(500).json({ message: "AI returned invalid response." });

      const variations = parsed.variations.map((v: any) => ({
        tweets: (v.tweets || []).map((t: any) => ({ content: String(t.content || ""), charCount: String(t.content || "").length })),
      }));
      res.json({ variations, model: "gpt-4o-mini" });
    } catch (err: any) {
      console.error("Generate from reference error:", err);
      res.status(500).json({ message: "Failed to generate from reference." });
    }
  });

  app.delete("/api/references/:id", async (req, res) => {
    try { await storage.deleteReference(parseInt(req.params.id)); res.status(204).send(); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/references/:id/bookmark", async (req, res) => {
    try {
      const ref = await storage.getReference(parseInt(req.params.id));
      if (!ref) return res.status(404).json({ message: "Reference not found" });
      const result = await storage.updateReference(parseInt(req.params.id), { isBookmarked: !ref.isBookmarked });
      res.json(result);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/references/:id/note", async (req, res) => {
    try {
      const { notes } = req.body;
      const result = await storage.updateReference(parseInt(req.params.id), { notes });
      if (!result) return res.status(404).json({ message: "Reference not found" });
      res.json(result);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/references/batch/:batchId", async (req, res) => {
    try {
      const refs = await storage.getReferencesByBatch(req.params.batchId);
      res.json(refs);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/bookmarklet", (req, res) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const bookmarklet = `javascript:void(fetch('${baseUrl}/api/ingest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:window.location.href})}).then(r=>r.json()).then(d=>alert('ContentForge: Saved! '+d.title)).catch(e=>alert('ContentForge: Error - '+e.message)))`;
    res.json({ bookmarklet, instructions: "Drag this to your bookmarks bar to capture any page into ContentForge." });
  });

  // ==================== IDEA DISCOVERY ====================
  app.get("/api/discover/ideas", async (req, res) => {
    try {
      const batchId = req.query.batchId as string | undefined;
      res.json(await storage.getDiscoveredIdeas(batchId));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/discover/refresh", async (req, res) => {
    try {
      const batchId = `batch_${Date.now()}`;
      const rawData: any[] = [];

      // Fetch from Hacker News
      try {
        const hnResponse = await fetch("https://hn.algolia.com/api/v1/search?query=AI+OR+kubernetes+OR+devops+OR+MLOps+OR+data+engineering&tags=story&hitsPerPage=15");
        const hnData = await hnResponse.json() as any;
        if (hnData.hits) {
          rawData.push(...hnData.hits.slice(0, 15).map((h: any) => ({
            source: "Hacker News",
            sourceType: "hackernews",
            category: "tech",
            title: h.title,
            url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
            points: h.points,
            comments: h.num_comments,
          })));
        }
      } catch (e) { console.error("HN fetch error:", e); }

      // Fetch from Reddit
      const subreddits = ["dataengineering", "devops", "kubernetes", "MachineLearning", "mlops"];
      for (const sub of subreddits) {
        try {
          const redditResponse = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=week&limit=5`, {
            headers: { "User-Agent": "ContentForge/1.0" },
            signal: AbortSignal.timeout(5000),
          });
          const redditData = await redditResponse.json() as any;
          if (redditData?.data?.children) {
            rawData.push(...redditData.data.children.map((c: any) => ({
              source: `Reddit r/${sub}`,
              sourceType: "reddit",
              category: sub === "MachineLearning" || sub === "mlops" ? "mlops" : sub === "kubernetes" ? "devops" : "tech",
              title: c.data.title,
              url: `https://reddit.com${c.data.permalink}`,
              points: c.data.score,
              comments: c.data.num_comments,
            })));
          }
        } catch (e) { /* skip failed subreddit */ }
      }

      // Fetch from RSS feeds
      const rssFeedSources = await storage.getRssSources();
      const activeFeeds = rssFeedSources.filter((f) => f.isActive);
      for (const feed of activeFeeds.slice(0, 8)) {
        try {
          const parsed = await rssParser.parseURL(feed.feedUrl);
          rawData.push(...(parsed.items || []).slice(0, 3).map((item) => ({
            source: feed.name,
            sourceType: "rss",
            category: feed.category || "tech",
            title: item.title || "",
            url: item.link || "",
            summary: item.contentSnippet?.substring(0, 200) || "",
          })));
        } catch (e) { /* skip failed feed */ }
      }

      // Fetch from GitHub Trending
      try {
        const ghResponse = await fetch("https://api.github.com/search/repositories?q=AI+OR+kubernetes+OR+devops+OR+mlops+created:>2026-02-01&sort=stars&order=desc&per_page=10", {
          headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "ContentForge/1.0" },
          signal: AbortSignal.timeout(8000),
        });
        const ghData = await ghResponse.json() as any;
        if (ghData?.items) {
          rawData.push(...ghData.items.slice(0, 10).map((r: any) => ({
            source: "GitHub",
            sourceType: "github",
            category: "tech",
            title: `${r.full_name}: ${r.description || ""}`.substring(0, 200),
            url: r.html_url,
            points: r.stargazers_count,
            summary: `Stars: ${r.stargazers_count}, Language: ${r.language || "N/A"}, ${r.description || ""}`.substring(0, 200),
          })));
        }
      } catch (e) { console.error("GitHub fetch error:", e); }

      // Fetch from ArXiv
      try {
        const arxivResponse = await fetch("http://export.arxiv.org/api/query?search_query=all:AI+infrastructure+OR+all:MLOps+OR+all:kubernetes+machine+learning&start=0&max_results=8&sortBy=submittedDate&sortOrder=descending", {
          signal: AbortSignal.timeout(8000),
        });
        const arxivText = await arxivResponse.text();
        const arxivEntries = arxivText.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
        for (const entry of arxivEntries.slice(0, 8)) {
          const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
          const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
          const linkMatch = entry.match(/<id>([\s\S]*?)<\/id>/);
          if (titleMatch) {
            rawData.push({
              source: "ArXiv",
              sourceType: "arxiv",
              category: "ai_research",
              title: titleMatch[1].replace(/\s+/g, " ").trim().substring(0, 200),
              url: linkMatch?.[1]?.trim() || "",
              summary: summaryMatch?.[1]?.replace(/\s+/g, " ").trim().substring(0, 200) || "",
            });
          }
        }
      } catch (e) { console.error("ArXiv fetch error:", e); }

      if (rawData.length === 0) {
        rawData.push(
          { source: "Hacker News", sourceType: "hackernews", category: "tech", title: "The rise of AI agents in infrastructure automation", url: "" },
          { source: "Reddit r/devops", sourceType: "reddit", category: "devops", title: "Platform engineering is replacing DevOps teams", url: "" },
          { source: "Newsletter", sourceType: "rss", category: "ai", title: "Kubernetes 1.30 brings AI workload scheduling improvements", url: "" },
        );
      }

      const allPillars = await storage.getPillars();
      const pillarNames = allPillars.map((p) => p.name).join(", ");

      const { content, usage, latency } = await aiCall([
        { role: "system", content: `You are a content strategist for Kishore Kumar Behera, a DevOps/Infrastructure engineering leader building a brand on X and Threads at the intersection of Data & AI and Platform Engineering.` },
        { role: "user", content: `Here are raw trending topics and posts from various sources this week:

${JSON.stringify(rawData.slice(0, 30))}

Analyze these and return exactly 20 content ideas ranked by viral potential. For each idea, provide:

{"ideas": [{"rank": 1, "title": "Compelling content idea title", "description": "2-3 sentences explaining the angle", "summary": "One-line summary", "source_inspiration": "What source inspired this", "source_url": "URL if applicable", "source_type": "hackernews|reddit|rss|github|arxiv", "category": "ai|devops|mlops|tech|leadership|system_design|ai_research", "content_type_suggestion": "thread|tweet|article|hot_take", "content_angles": ["angle 1", "angle 2", "angle 3"], "pillar": "Which pillar from: ${pillarNames}", "viral_score": 8.5, "viral_reasoning": "Why this has viral potential", "value_proposition": "What value the audience gets", "unique_angle": "How Kishore's background makes this unique", "timeliness": "evergreen|trending_now|this_week", "target_audience": "Who would engage", "suggested_hook": "Draft opening line", "hashtag_suggestions": ["2-3 hashtags"]}]}

Rank by: Value Density > Unique Angle > Emotional Trigger > Timeliness > Discussion Potential` },
      ], true);

      await logAiUsage(usage, latency, "discover_ideas");
      const parsed = safeJsonParse(content);
      if (!parsed?.ideas) return res.status(500).json({ message: "AI returned invalid response." });

      const ideaRecords = parsed.ideas.map((idea: any, i: number) => {
        const matchedPillar = allPillars.find((p) => p.name.toLowerCase().includes(String(idea.pillar || "").toLowerCase().split(" ")[0]));
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
      res.json({ batchId, ideas: saved, newIdeasCount: saved.length, sourcesScanned: rawData.length });
    } catch (err: any) {
      console.error("Discover refresh error:", err);
      res.status(500).json({ message: "Failed to discover ideas. Please try again." });
    }
  });

  app.patch("/api/discover/ideas/:id/status", async (req, res) => {
    try {
      const { status } = req.body;
      if (!["new", "saved", "drafted", "dismissed"].includes(status)) return res.status(400).json({ message: "Invalid status" });
      const result = await storage.updateDiscoveredIdeaStatus(parseInt(req.params.id), status);
      if (!result) return res.status(404).json({ message: "Idea not found" });
      res.json(result);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/discover/ideas/:id/to-draft", async (req, res) => {
    try {
      const discovered = (await storage.getDiscoveredIdeas()).find((i) => i.id === parseInt(req.params.id));
      if (!discovered) return res.status(404).json({ message: "Idea not found" });

      const idea = await storage.createIdea({
        title: discovered.title.substring(0, 280),
        notes: `${discovered.description || ""}\n\nSuggested hook: ${discovered.suggestedHook || ""}\nAngle: ${discovered.uniqueAngle || ""}`,
        pillarId: discovered.pillarId,
      });
      await storage.updateDiscoveredIdeaStatus(parseInt(req.params.id), "saved");
      res.json(idea);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ==================== DISCOVERY SETTINGS & SOURCES ====================
  app.get("/api/discover/settings", async (_req, res) => {
    try { res.json(await storage.getDiscoverySettings()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/discover/settings", async (req, res) => {
    try { res.json(await storage.updateDiscoverySettings(req.body)); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/discover/sources", async (_req, res) => {
    try {
      const [accounts, feeds] = await Promise.all([storage.getMonitoredAccounts(), storage.getRssSources()]);
      res.json({ accounts, feeds });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/discover/sources/rss", async (req, res) => {
    try {
      const body = z.object({ name: z.string().min(1), feedUrl: z.string().url(), category: z.string().optional() }).parse(req.body);
      res.status(201).json(await storage.createRssSource(body as any));
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors.map((e) => e.message).join(", ") });
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/discover/sources/account", async (req, res) => {
    try {
      const body = z.object({ platform: z.string().min(1), username: z.string().min(1), displayName: z.string().optional(), category: z.string().optional() }).parse(req.body);
      res.status(201).json(await storage.createMonitoredAccount(body as any));
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors.map((e) => e.message).join(", ") });
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/discover/rss-sources", async (_req, res) => {
    try { res.json(await storage.getRssSources()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/discover/monitored-accounts", async (_req, res) => {
    try { res.json(await storage.getMonitoredAccounts()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/discover/ideas/:id/bookmark", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [idea] = await db.select().from(discoveredIdeas).where(eq(discoveredIdeas.id, id));
      if (!idea) return res.status(404).json({ message: "Idea not found" });
      const [updated] = await db.update(discoveredIdeas).set({ isBookmarked: !idea.isBookmarked }).where(eq(discoveredIdeas.id, id)).returning();
      res.json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/discover/ideas/:id/expand", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [idea] = await db.select().from(discoveredIdeas).where(eq(discoveredIdeas.id, id));
      if (!idea) return res.status(404).json({ message: "Idea not found" });
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are an expert social media content writer specializing in Data & AI infrastructure topics. Convert this discovered idea into a ready-to-post thread." },
          { role: "user", content: `Turn this idea into a compelling Twitter/X thread (5-7 tweets, each under 280 characters):\n\nTitle: ${idea.title}\nDescription: ${idea.description || idea.summary || ""}\nUnique Angle: ${idea.uniqueAngle || ""}\nSuggested Hook: ${idea.suggestedHook || ""}\n\nReturn JSON: { "tweets": [{ "content": "tweet text", "position": 0 }] }` }
        ],
        temperature: 0.8,
        response_format: { type: "json_object" },
      });
      const result = JSON.parse(response.choices[0]?.message?.content || "{}");
      const post = await storage.createPost({ postType: "thread", tone: "conversational", targetPlatform: "both", status: "draft", aiModel: "gpt-4o-mini" } as any);
      if (result.tweets) {
        for (const tweet of result.tweets) {
          await storage.createTweet({ postId: post.id, content: tweet.content, position: tweet.position, charCount: tweet.content.length });
        }
      }
      await db.update(discoveredIdeas).set({ status: "used" }).where(eq(discoveredIdeas.id, id));
      res.json({ postId: post.id, tweets: result.tweets });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/discover/sources/:id", async (req, res) => {
    try {
      const { type } = req.query;
      if (type === "rss") await storage.deleteRssSource(parseInt(req.params.id));
      else await storage.deleteMonitoredAccount(parseInt(req.params.id));
      res.status(204).send();
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ==================== VIRAL OPTIMIZATION ====================
  app.post("/api/viral/score", async (req, res) => {
    try {
      const { content: postContent, postId, articleId, platform } = req.body;
      if (!postContent) return res.status(400).json({ message: "Content is required" });

      const { content, usage, latency } = await aiCall([
        { role: "system", content: "You are a viral content scoring expert for X (Twitter) and Threads. Be brutally honest — most content scores 4-6. Only truly exceptional content gets 8+." },
        { role: "user", content: `Score this content for viral potential on ${platform || "X"}. 

CONTENT:
${postContent}

CONTEXT: Posted by Kishore Kumar Behera (DevOps/Infrastructure Engineering Lead, 11+ years, multi-cloud expert)

Return JSON:
{
  "overall_score": 7.2,
  "dimensions": {
    "hook_power": {"score": 8, "feedback": "explanation"},
    "value_density": {"score": 7, "feedback": "explanation"},
    "emotional_trigger": {"score": 6, "feedback": "explanation"},
    "shareability": {"score": 7, "feedback": "explanation"},
    "uniqueness": {"score": 8, "feedback": "explanation"},
    "readability": {"score": 7, "feedback": "explanation"},
    "cta_strength": {"score": 5, "feedback": "explanation"},
    "timeliness": {"score": 6, "feedback": "explanation"}
  },
  "improvements": ["specific actionable improvement 1", "improvement 2", "improvement 3"],
  "predicted_engagement": {
    "estimated_impressions": "5K-15K",
    "estimated_likes": "50-200",
    "estimated_retweets": "10-50",
    "estimated_replies": "5-20"
  }
}` },
      ], true);

      await logAiUsage(usage, latency, "viral_score");
      const parsed = safeJsonParse(content);
      if (!parsed?.overall_score) return res.status(500).json({ message: "AI returned invalid response." });

      const existingScores = postId ? await storage.getViralScores(postId) : articleId ? await storage.getViralScores(undefined, articleId) : [];
      const version = existingScores.length + 1;

      const score = await storage.createViralScore({
        postId: postId || null,
        articleId: articleId || null,
        version,
        overallScore: String(parsed.overall_score),
        dimensionScores: parsed.dimensions,
        improvements: parsed.improvements,
        predictedEngagement: parsed.predicted_engagement,
        scoredByModel: "gpt-4o-mini",
      });

      res.json({ ...score, parsed });
    } catch (err: any) {
      console.error("Viral score error:", err);
      res.status(500).json({ message: "Failed to score content." });
    }
  });

  app.post("/api/viral/optimize", async (req, res) => {
    try {
      const { content: postContent, improvements, platform } = req.body;
      if (!postContent) return res.status(400).json({ message: "Content is required" });

      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Rewrite this content applying ALL the improvement suggestions to maximize viral potential on ${platform || "X"}.

ORIGINAL CONTENT:
${postContent}

IMPROVEMENTS TO APPLY:
${(improvements || []).map((imp: string, i: number) => `${i + 1}. ${imp}`).join("\n")}

Return the rewritten content in the same format (if it was a thread with multiple tweets, keep it as multiple tweets).
Return JSON: {"tweets": [{"content": "optimized text"}]}
Each tweet under 280 characters.` },
      ], true);

      await logAiUsage(usage, latency, "viral_optimize");
      const parsed = safeJsonParse(content);
      if (!parsed?.tweets) return res.status(500).json({ message: "AI returned invalid response." });
      res.json(parsed);
    } catch (err: any) {
      console.error("Viral optimize error:", err);
      res.status(500).json({ message: "Failed to optimize content." });
    }
  });

  app.post("/api/viral/apply-fix", async (req, res) => {
    try {
      const { content: postContent, improvement } = req.body;
      if (!postContent || !improvement) return res.status(400).json({ message: "Content and improvement are required" });

      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Apply this specific improvement to the content.

CONTENT:
${postContent}

IMPROVEMENT TO APPLY:
${improvement}

Return ONLY the improved content text. Keep the same format and length constraints.` },
      ]);

      await logAiUsage(usage, latency, "viral_apply_fix");
      res.json({ content: content.trim() });
    } catch (err: any) {
      console.error("Apply fix error:", err);
      res.status(500).json({ message: "Failed to apply improvement." });
    }
  });

  app.get("/api/viral/scores/:postId", async (req, res) => {
    try { res.json(await storage.getViralScores(parseInt(req.params.postId))); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  return httpServer;
}
