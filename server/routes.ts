import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { discoveredIdeas } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import * as cheerio from "cheerio";
import path from "path";
import fs from "fs";
import multer from "multer";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { ai, MODELS } from "./ai/config";
import { aiCall, logAiUsage, safeJsonParse } from "./ai/chat";
import { runDiscoverRefresh } from "./discoverRefresh";
import { fetchTweetTextByIdViaOfficialApi, getXPostingConfigSummary, tryPublishPostById, refreshXAnalytics, syncPostAnalyticsFromX } from "./social/x";
import { isToday } from "date-fns";

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

const CONTENT_PILLARS_DATA = [
  { id: 1, name: "Data Infrastructure & MLOps" },
  { id: 2, name: "AI for DevOps / AIOps" },
  { id: 3, name: "Cloud-Native Data Platforms" },
  { id: 4, name: "Infrastructure as Code for Data" },
  { id: 5, name: "Career & Leadership" },
  { id: 6, name: "Hot Takes & Trends" },
];

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

  /** Ready + today's scheduled — approval / daily queue. */
  app.get("/api/posts/queue/today", async (_req, res) => {
    try {
      const all = await storage.getPosts();
      const queue = all.filter((p) => {
        if (p.status === "draft") return true;       // drafts always visible
        if (p.status === "ready") return true;
        if (p.status === "failed") return true;      // failed posts need attention
        if (p.status === "scheduled" && p.scheduledAt) {
          return isToday(new Date(p.scheduledAt));
        }
        return false;
      });
      // Sort: drafts first, then by scheduledAt
      queue.sort((a, b) => {
        const order: Record<string, number> = { draft: 0, ready: 1, scheduled: 2, failed: 3 };
        const ao = a.status ? (order[a.status] ?? 99) : 99;
        const bo = b.status ? (order[b.status] ?? 99) : 99;
        if (ao !== bo) return ao - bo;
        return new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime();
      });
      res.json(queue);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
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

  app.post("/api/posts/:id/publish", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid post id" });
      const result = await tryPublishPostById(id);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to publish to X" });
    }
  });

  // ==================== IDEAS ====================
  app.get("/api/ideas", async (_req, res) => {
    try { res.json(await storage.getIdeas()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/ideas/:id", async (req, res) => {
    try {
      const idea = await storage.getIdea(parseInt(req.params.id));
      if (!idea) return res.status(404).json({ message: "Idea not found" });
      res.json(idea);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
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
        { pillarId: idea.pillarId, postType: "thread", tone: "conversational", targetPlatform: "both", status: "draft", aiModel: MODELS.TEXT },
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
      res.json({ content: content.trim(), model: MODELS.TEXT });
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
      res.json({ variations, model: MODELS.TEXT });
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

  // Manual trigger: refresh X analytics for all posted posts in last 30 days
  app.post("/api/analytics/sync/x", async (_req, res) => {
    try {
      await refreshXAnalytics(30);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Manual trigger: sync analytics for one post by id
  app.post("/api/analytics/sync/x/:id", async (req, res) => {
    try {
      await syncPostAnalyticsFromX(Number(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/usage", async (_req, res) => {
    try { res.json(await storage.getAiUsageLogs()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── AI USAGE DASHBOARD ────────────────────────────────────────────────────────
  app.get("/api/ai-usage/dashboard", async (req, res) => {
    try {
      const days = Number(req.query.days ?? 30);
      const logs = await storage.getAiUsageLogsAll(days);

      // Cost per 1M tokens by model (input, output) — covers both direct OpenAI and OpenRouter pricing
      const MODEL_PRICING: Record<string, { input: number; output: number }> = {
        // OpenAI direct
        "gpt-4o-mini":                         { input: 0.15,   output: 0.60   },
        "gpt-4o":                              { input: 2.50,   output: 10.00  },
        "gpt-4o-mini-transcribe":              { input: 3.00,   output: 0      },
        "gpt-image-1":                         { input: 0,      output: 0      },
        // Anthropic (via OpenRouter)
        "claude-opus-4-7":                     { input: 15.00,  output: 75.00  },
        "anthropic/claude-opus-4-7":           { input: 15.00,  output: 75.00  },
        "claude-sonnet-4-6":                   { input: 3.00,   output: 15.00  },
        "anthropic/claude-sonnet-4-5":         { input: 3.00,   output: 15.00  },
        "claude-haiku-4-5-20251001":           { input: 0.80,   output: 4.00   },
        "anthropic/claude-haiku-4-5":          { input: 0.80,   output: 4.00   },
        // Meta Llama (via OpenRouter — free tier models = $0)
        "meta-llama/llama-3.1-8b-instruct":    { input: 0.00,   output: 0.00   }, // free on OR
        "meta-llama/llama-3.3-70b-instruct":   { input: 0.12,   output: 0.30   },
        "meta-llama/llama-4-maverick":         { input: 0.20,   output: 0.60   },
        // Google (via OpenRouter)
        "google/gemini-flash-1.5":             { input: 0.075,  output: 0.30   },
        "google/gemini-pro-1.5":               { input: 1.25,   output: 5.00   },
        "google/gemini-2.0-flash-exp:free":    { input: 0.00,   output: 0.00   },
        "google/gemini-2.0-flash-001":         { input: 0.10,   output: 0.40   },
        "google/gemini-2.0-flash-lite-001":    { input: 0.075,  output: 0.30   },
        "google/gemini-2.5-pro-preview":       { input: 1.25,   output: 10.00  },
        // Mistral (via OpenRouter)
        "mistralai/mistral-7b-instruct":       { input: 0.055,  output: 0.055  },
        "mistralai/mixtral-8x7b-instruct":     { input: 0.24,   output: 0.24   },
        // DeepSeek (via OpenRouter)
        "deepseek/deepseek-chat":              { input: 0.27,   output: 1.10   },
        "deepseek/deepseek-r1":                { input: 0.55,   output: 2.19   },
        // Qwen (via OpenRouter)
        "qwen/qwen-2.5-72b-instruct":          { input: 0.35,   output: 0.40   },
      };

      // Detect provider from env
      const isOpenRouter = !!(process.env.AI_BASE_URL?.includes("openrouter"));
      const activeModel = process.env.AI_TEXT_MODEL ?? "gpt-4o-mini";

      const estimateCost = (log: { model: string; inputTokens?: number | null; outputTokens?: number | null }): number => {
        const pricing = MODEL_PRICING[log.model] ?? { input: 0.15, output: 0.60 };
        const inCost  = ((log.inputTokens  || 0) / 1_000_000) * pricing.input;
        const outCost = ((log.outputTokens || 0) / 1_000_000) * pricing.output;
        return parseFloat((inCost + outCost).toFixed(6));
      };

      // Daily buckets
      const dailyMap: Record<string, { date: string; tokens: number; cost: number; calls: number }> = {};
      const featureMap: Record<string, { tokens: number; cost: number; calls: number }> = {};
      const modelMap:   Record<string, { tokens: number; cost: number; calls: number }> = {};

      let totalTokens = 0;
      let totalCost   = 0;
      const now = new Date();

      for (const log of logs) {
        const cost    = estimateCost(log);
        const tokens  = log.totalTokens || 0;
        const dateKey = new Date(log.createdAt).toISOString().split("T")[0];
        const feature = log.feature || "unknown";
        const model   = log.model || "unknown";

        totalTokens += tokens;
        totalCost   += cost;

        if (!dailyMap[dateKey]) dailyMap[dateKey] = { date: dateKey, tokens: 0, cost: 0, calls: 0 };
        dailyMap[dateKey].tokens += tokens;
        dailyMap[dateKey].cost   += cost;
        dailyMap[dateKey].calls  += 1;

        if (!featureMap[feature]) featureMap[feature] = { tokens: 0, cost: 0, calls: 0 };
        featureMap[feature].tokens += tokens;
        featureMap[feature].cost   += cost;
        featureMap[feature].calls  += 1;

        if (!modelMap[model]) modelMap[model] = { tokens: 0, cost: 0, calls: 0 };
        modelMap[model].tokens += tokens;
        modelMap[model].cost   += cost;
        modelMap[model].calls  += 1;
      }

      // Time window totals
      const todayKey  = now.toISOString().split("T")[0];
      const weekAgo   = new Date(now.getTime() - 7  * 86400000).toISOString().split("T")[0];
      const monthAgo  = new Date(now.getTime() - 30 * 86400000).toISOString().split("T")[0];

      const todayCost  = dailyMap[todayKey]?.cost  ?? 0;
      const weekCost   = Object.entries(dailyMap).filter(([d]) => d >= weekAgo ).reduce((s, [, v]) => s + v.cost, 0);
      const monthCost  = Object.entries(dailyMap).filter(([d]) => d >= monthAgo).reduce((s, [, v]) => s + v.cost, 0);
      const todayCalls = dailyMap[todayKey]?.calls ?? 0;

      // Fill in missing days with zero so chart has continuous x-axis
      const daily = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000).toISOString().split("T")[0];
        const entry = dailyMap[d] || { date: d, tokens: 0, cost: 0, calls: 0 };
        daily.push({ ...entry, cost: parseFloat(entry.cost.toFixed(4)) });
      }

      const byFeature = Object.entries(featureMap).map(([feature, v]) => ({
        feature, ...v, cost: parseFloat(v.cost.toFixed(4)),
      })).sort((a, b) => b.cost - a.cost);

      const byModel = Object.entries(modelMap).map(([model, v]) => ({
        model, ...v, cost: parseFloat(v.cost.toFixed(4)),
      })).sort((a, b) => b.cost - a.cost);

      const recent = logs.slice(0, 20).map((log) => ({
        id:          log.id,
        model:       log.model,
        feature:     log.feature,
        totalTokens: log.totalTokens,
        inputTokens: log.inputTokens,
        outputTokens:log.outputTokens,
        latencyMs:   log.latencyMs,
        estimatedCost: estimateCost(log),
        createdAt:   log.createdAt,
      }));

      res.json({
        summary: {
          todayCost:   parseFloat(todayCost.toFixed(4)),
          weekCost:    parseFloat(weekCost.toFixed(4)),
          monthCost:   parseFloat(monthCost.toFixed(4)),
          totalCost:   parseFloat(totalCost.toFixed(4)),
          totalTokens,
          totalCalls:  logs.length,
          todayCalls,
        },
        provider: {
          name:        isOpenRouter ? "OpenRouter" : "OpenAI",
          activeModel,
          pricing:     MODEL_PRICING[activeModel] ?? { input: 0.15, output: 0.60 },
          note:        isOpenRouter
            ? "OpenRouter pricing — free-tier models ($0) or paid as shown"
            : "OpenAI direct pricing",
        },
        daily,
        byFeature,
        byModel,
        recent,
        daysWindow: days,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
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
        { pillarId: article.pillarId, postType: "thread", tone: "educational", targetPlatform: "x", status: "draft", aiModel: MODELS.TEXT },
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
      if (/(?:status|statuses)\/(\d+)/.test(u) || /\/i\/(?:web\/)?status\/(\d+)/.test(u)) {
        return { sourceType: "x_tweet", sourcePlatform: "x" };
      }
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

  function extractXTweetIdFromUrl(url: string): string | null {
    const m = url.match(/(?:status|statuses)\/(\d+)/i) || url.match(/\/i\/(?:web\/)?status\/(\d+)/i);
    return m?.[1] ?? null;
  }

  async function extractGenericWebpage(url: string) {
    let host = "";
    try {
      host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      /* invalid URL — fall through; fetch will fail */
    }
    if (host === "x.com" || host === "twitter.com") {
      throw new Error(
        "Fetching x.com or twitter.com HTML is disabled to comply with X Developer Guidelines. Use an X post URL with configured X API credentials (we load the post via the official API), paste the text instead, or use the X username analysis option.",
      );
    }
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

      if (url && sourceType === "x_account") {
        return res.status(400).json({
          message:
            "X profile URLs cannot be fetched via web scraping (X Developer Guidelines). Use the X username field above for AI-assisted style notes from public signals, paste post text manually, or add timeline support via the official X API later.",
        });
      }

      if (url) {
        try {
          switch (sourceType) {
            case "x_tweet": {
              const tweetId = extractXTweetIdFromUrl(url);
              if (!tweetId) {
                return res.status(400).json({ message: "Could not parse the post ID from this X URL." });
              }
              const tweetText = await fetchTweetTextByIdViaOfficialApi(tweetId);
              if (!tweetText) {
                return res.status(400).json({
                  message:
                    "Could not load this post via the official X API. Configure X OAuth credentials (same as posting), or paste the post text instead. HTML scraping of x.com is disabled for policy compliance.",
                });
              }
              rawContent = tweetText;
              title = `X post ${tweetId}`;
              author = "";
              engagementMetrics = { tweetId };
              analysisPrompt = `Analyze the following post from X (text retrieved via official API only):

POST TEXT:
${tweetText}

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
    "why_it_works": "why this content might resonate",
    "emotional_triggers": ["curiosity", "contrarian", etc.],
    "structural_patterns": ["numbered list", "problem/solution", etc.]
  },
  "content_ideas": [{"idea": "Original content idea inspired by this (do not copy)", "format": "thread/tweet/article/hot_take", "hook": "Opening line", "angle": "Kishore's DevOps/Infra perspective"}],
  "data_points": ["statistics or numbers mentioned"],
  "quotes_worth_referencing": ["short fair-use quotes only if appropriate"],
  "gaps_and_angles": ["things the source missed or where Kishore could add unique value"],
  "topic_tags": ["relevant topics"]
}`;
              break;
            }
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

  app.post("/api/references/analyze", async (req, res) => {
    try {
      const ingestRes = await fetch(`http://localhost:${process.env.PORT || 5000}/api/ingest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.body) });
      const data = await ingestRes.json();
      res.status(ingestRes.status).json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
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

      const port = process.env.PORT || 5000;
      for (const src of sources) {
        try {
          const ingestRes = await fetch(`http://localhost:${port}/api/ingest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(src) });
          const data = await ingestRes.json();
          if (ingestRes.ok && data.id) {
            results.push(data);
            analysisTexts.push(JSON.stringify(data.analysisJson || {}));
          } else {
            results.push({ error: data.message || "Unknown error", source: src });
          }
        } catch (e: any) {
          results.push({ error: e.message || "Failed to process source", source: src });
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

      res.json({ variations, model: MODELS.TEXT, action });
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
      res.json({ variations, model: MODELS.TEXT, styleName: profile.name });
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
      res.json({ variations, model: MODELS.TEXT });
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

  // ==================== CONNECTED ACCOUNTS ====================

  app.get("/api/social/x/status", async (_req, res) => {
    try {
      res.json({
        ...(await getXPostingConfigSummary()),
        hint: "Posting needs OAuth 1.0a user keys (API key/secret + access token/secret) or an OAuth 2.0 user access token with tweet.write. X_CLIENT_ID / X_CLIENT_SECRET alone only identify the app.",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/accounts", async (_req, res) => {
    try {
      const accounts = await storage.getConnectedAccounts();
      const safeAccounts = accounts.map((a) => ({
        ...a,
        accessToken: a.accessToken ? "••••••" + a.accessToken.slice(-4) : null,
        refreshToken: undefined,
      }));
      res.json(safeAccounts);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/accounts/connect", async (req, res) => {
    try {
      const { platform, username, accessToken } = req.body;
      if (!platform || !accessToken) return res.status(400).json({ message: "Platform and access token are required." });

      if (platform === "x") {
        try {
          const verifyRes = await fetch("https://api.twitter.com/2/users/me", {
            headers: { "Authorization": `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10000),
          });
          if (verifyRes.ok) {
            const userData = await verifyRes.json() as any;
            const account = await storage.upsertConnectedAccount({
              platform: "x",
              username: userData.data?.username || username || "unknown",
              displayName: userData.data?.name || username,
              accessToken,
              isActive: true,
              profileData: userData.data || {},
            });
            return res.json({ ...account, accessToken: "••••••" + accessToken.slice(-4) });
          } else {
            const account = await storage.upsertConnectedAccount({
              platform: "x",
              username: username || "pending_verification",
              accessToken,
              isActive: true,
            });
            return res.json({ ...account, accessToken: "••••••" + accessToken.slice(-4), warning: "Token saved but could not verify with X API. Posting may not work until token is verified." });
          }
        } catch (e) {
          const account = await storage.upsertConnectedAccount({
            platform: "x",
            username: username || "pending_verification",
            accessToken,
            isActive: true,
          });
          return res.json({ ...account, accessToken: "••••••" + accessToken.slice(-4), warning: "Token saved but verification request failed. Check your network." });
        }
      }

      if (platform === "threads") {
        const account = await storage.upsertConnectedAccount({
          platform: "threads",
          username: username || "pending",
          accessToken,
          isActive: true,
        });
        return res.json({ ...account, accessToken: "••••••" + accessToken.slice(-4) });
      }

      return res.status(400).json({ message: `Unknown platform: ${platform}` });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/accounts/:id", async (req, res) => {
    try {
      await storage.deleteConnectedAccount(parseInt(req.params.id));
      res.status(204).send();
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/accounts/:id/test", async (req, res) => {
    try {
      const accounts = await storage.getConnectedAccounts();
      const account = accounts.find((a) => a.id === parseInt(req.params.id));
      if (!account) return res.status(404).json({ message: "Account not found" });

      if (account.platform === "x" && account.accessToken) {
        try {
          const testRes = await fetch("https://api.twitter.com/2/users/me", {
            headers: { "Authorization": `Bearer ${account.accessToken}` },
            signal: AbortSignal.timeout(10000),
          });
          if (testRes.ok) {
            const data = await testRes.json() as any;
            return res.json({ success: true, username: data.data?.username, name: data.data?.name });
          }
          return res.json({ success: false, error: "Token rejected by X API. Please reconnect." });
        } catch (e) {
          return res.json({ success: false, error: "Could not reach X API." });
        }
      }

      if (account.platform === "threads") {
        return res.json({ success: true, note: "Threads API verification is limited. Token stored." });
      }

      return res.json({ success: false, error: "Unknown platform" });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ==================== IDEA DISCOVERY ====================
  app.get("/api/discover/ideas", async (req, res) => {
    try {
      const batchId = req.query.batchId as string | undefined;
      res.json(await storage.getDiscoveredIdeas(batchId));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/discover/refresh", async (_req, res) => {
    try {
      const result = await runDiscoverRefresh();
      res.json(result);
    } catch (err: any) {
      console.error("Discover refresh error:", err);
      res.status(500).json({ message: err?.message || "Failed to discover ideas. Please try again." });
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
      const postType: string = req.body?.postType || "thread";
      const [idea] = await db.select().from(discoveredIdeas).where(eq(discoveredIdeas.id, id));
      if (!idea) return res.status(404).json({ message: "Idea not found" });

      const tweetCountHint =
        postType === "tweet"         ? "exactly 1 tweet (max 275 chars)"
        : postType === "long_thread" ? "8-12 tweets"
        : postType === "article_thread" ? "15-20 tweets — deep narrative with sections: context → problem → analysis → data/examples → lessons → implications"
        : "5-7 tweets";

      const formatNote =
        postType === "tweet"
          ? "Return JSON: { \"tweets\": [{\"content\": \"...\", \"position\": 0}], \"hashtag_suggestions\": [\"tag1\"] }"
          : "Tweet 1 = scroll-stopping hook. Each subsequent tweet ≤275 chars, numbered (1/, 2/, ...). Last tweet = CTA or bold question. Return JSON: { \"tweets\": [{\"content\": \"...\", \"position\": 0}], \"hashtag_suggestions\": [\"tag1\",\"tag2\",\"tag3\"] }";

      const { content, usage, latency } = await aiCall([
        { role: "system", content: "You are ghostwriting for Kishore Kumar Behera — Infrastructure Engineering Lead (11+ yrs). Credentials: Saved $500K at Salesforce via cloud cost optimisation. Ran multi-region K8s at Maersk. Built ML feature stores at SAP Labs. Niche: DevOps · AI/MLOps · Kubernetes · Platform Engineering. Voice: specific tool names, real metrics, contrarian angles, conversational. No generic advice." },
        { role: "user", content: `Turn this idea into ${tweetCountHint}:\n\nTitle: ${idea.title}\nDescription: ${idea.description || idea.summary || ""}\nUnique Angle: ${idea.uniqueAngle || ""}\nSuggested Hook: ${idea.suggestedHook || ""}\nContent Angles: ${(idea.contentAngles as string[] || []).join(" | ")}\n\n${formatNote}` }
      ], true);
      await logAiUsage(usage, latency, "expand_idea");

      const result = safeJsonParse(content) || {};
      const tweets = (result.tweets || []).map((t: any, i: number) => ({
        content: String(t.content || "").slice(0, 280),
        position: i,
        charCount: String(t.content || "").length,
        postId: 0,
      }));

      const post = await storage.createPost(
        { postType, tone: "conversational", targetPlatform: "x", status: "draft", aiModel: MODELS.TEXT } as any,
        tweets,
      );
      await db.update(discoveredIdeas).set({ status: "used" }).where(eq(discoveredIdeas.id, id));
      res.json({ postId: (post as any).id, postType, tweetCount: tweets.length, hashtags: result.hashtag_suggestions || [] });
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
        scoredByModel: MODELS.TEXT,
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

  // ── AUTH ROUTES ──────────────────────────────────────────────────────────────
  const { hashPassword, comparePassword, getUserByEmail, getUserById, createUser, findOrCreateGoogleUser } = await import("./auth");
  const { users: usersTable, userProfile } = await import("@shared/schema");

  // ── GOOGLE OAUTH ──────────────────────────────────────────────────────────────
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const googleEnabled = !!(googleClientId && googleClientSecret);

  if (googleEnabled) {
    const callbackURL = process.env.GOOGLE_CALLBACK_URL ||
      (process.env.REPLIT_DOMAINS
        ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}/api/auth/google/callback`
        : "http://localhost:5000/api/auth/google/callback");

    passport.use(new GoogleStrategy(
      { clientID: googleClientId!, clientSecret: googleClientSecret!, callbackURL },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value || null;
          const avatar = profile.photos?.[0]?.value || null;
          const user = await findOrCreateGoogleUser(profile.id, email, profile.displayName, avatar);
          done(null, user);
        } catch (err) { done(err); }
      }
    ));
    passport.serializeUser((user: any, done) => done(null, user.id));
    passport.deserializeUser(async (id: number, done) => {
      try { done(null, await getUserById(id)); } catch (e) { done(e); }
    });

    app.use(passport.initialize());

    app.get("/api/auth/google",
      passport.authenticate("google", { scope: ["profile", "email"], session: false })
    );

    app.get("/api/auth/google/callback",
      passport.authenticate("google", { failureRedirect: "/?error=google_auth_failed", session: false }),
      (req: any, res) => {
        if (!req.user) {
          return res.redirect("/?error=google_auth_failed");
        }
        req.session.userId = req.user.id;
        req.session.save((err: Error | null) => {
          if (err) {
            console.error("[google oauth] session save failed:", err);
            return res.redirect("/?error=session_save_failed");
          }
          console.log(`[google oauth] login ok user=${req.user.id} sid=${req.session.id}`);
          res.redirect("/");
        });
      }
    );
  }

  app.get("/api/auth/config", (_req, res) => {
    res.json({ googleEnabled });
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || !name) return res.status(400).json({ message: "Email, password, and name are required" });
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      const existing = await getUserByEmail(email);
      if (existing) return res.status(409).json({ message: "An account with that email already exists" });
      const user = await createUser(email, password, name);
      req.session.userId = user.id;
      res.json({ id: user.id, email: user.email, name: user.name, avatar: user.avatar, title: user.title });
    } catch (err: any) {
      console.error("Register error:", err);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ message: "Email and password are required" });
      const user = await getUserByEmail(email);
      if (!user || !user.passwordHash) return res.status(401).json({ message: "Invalid email or password" });
      const valid = await comparePassword(password, user.passwordHash);
      if (!valid) return res.status(401).json({ message: "Invalid email or password" });
      req.session.userId = user.id;
      res.json({ id: user.id, email: user.email, name: user.name, avatar: user.avatar, title: user.title, bio: user.bio });
    } catch (err: any) {
      console.error("Login error:", err);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {});
    res.json({ success: true });
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });
      const user = await getUserById(req.session.userId);
      if (!user) return res.status(401).json({ message: "User not found" });
      res.json({ id: user.id, email: user.email, name: user.name, avatar: user.avatar, title: user.title, bio: user.bio });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/auth/me", async (req, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });
      const { name, title, bio, avatar } = req.body;
      const [updated] = await db.update(usersTable)
        .set({ name, title, bio, avatar, updatedAt: new Date() })
        .where(eq(usersTable.id, req.session.userId!))
        .returning();
      res.json({ id: updated.id, email: updated.email, name: updated.name, avatar: updated.avatar, title: updated.title, bio: updated.bio });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PROFILE / MEMORY / BRANDING ──────────────────────────────────────────────
  app.get("/api/profile/memory", async (req, res) => {
    try {
      const userId = req.session?.userId || 1;
      const [profile] = await db.select().from(userProfile).where(eq(userProfile.userId, userId));
      res.json(profile || {});
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/profile/memory", async (req, res) => {
    try {
      const userId = req.session?.userId || 1;
      const { brandVoice, writingStyleNotes, audienceDescription, contentGoals, niche, targetPlatforms, postingFrequency, memoryJson } = req.body;
      const [existing] = await db.select().from(userProfile).where(eq(userProfile.userId, userId));
      let result;
      if (existing) {
        [result] = await db.update(userProfile)
          .set({
            brandVoice: brandVoice ?? existing.brandVoice,
            writingStyleNotes: writingStyleNotes ?? existing.writingStyleNotes,
            audienceDescription: audienceDescription ?? existing.audienceDescription,
            contentGoals: contentGoals ?? existing.contentGoals,
            niche: niche ?? existing.niche,
            targetPlatforms: targetPlatforms ?? existing.targetPlatforms,
            postingFrequency: postingFrequency ?? existing.postingFrequency,
            memoryJson: memoryJson ?? existing.memoryJson,
            updatedAt: new Date(),
          })
          .where(eq(userProfile.userId, userId))
          .returning();
      } else {
        [result] = await db.insert(userProfile)
          .values({ userId, brandVoice, writingStyleNotes, audienceDescription, contentGoals, niche, targetPlatforms, postingFrequency, memoryJson })
          .returning();
      }
      res.json(result);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/profile/branding", async (req, res) => {
    try {
      const userId = req.session?.userId || 1;
      const [profile] = await db.select().from(userProfile).where(eq(userProfile.userId, userId));
      res.json((profile?.brandingJson as any) || {});
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/profile/branding", async (req, res) => {
    try {
      const userId = req.session?.userId || 1;
      const [existing] = await db.select().from(userProfile).where(eq(userProfile.userId, userId));
      let result;
      if (existing) {
        [result] = await db.update(userProfile)
          .set({ brandingJson: req.body, updatedAt: new Date() })
          .where(eq(userProfile.userId, userId))
          .returning();
      } else {
        [result] = await db.insert(userProfile)
          .values({ userId, brandingJson: req.body })
          .returning();
      }
      res.json(result.brandingJson);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/profile/memory/ai-learn", async (req, res) => {
    try {
      const userId = req.session?.userId || 1;
      const [profile] = await db.select().from(userProfile).where(eq(userProfile.userId, userId));
      const posts = await storage.getPosts();
      const recentContent = posts.slice(0, 10).flatMap(p => p.tweets.map(t => t.content)).join("\n");
      const { content, usage, latency } = await aiCall([
        { role: "system", content: "You are an expert personal branding analyst. Analyze the content and extract key patterns about the writer's style, voice, and approach." },
        { role: "user", content: `Analyze these recent social media posts and extract a detailed personal brand profile:\n\n${recentContent}\n\nReturn JSON: { "brandVoice": "...", "writingStyleNotes": "...", "contentPatterns": ["..."], "topTopics": ["..."], "toneWords": ["..."], "uniqueStrengths": ["..."] }` },
      ], true);
      await logAiUsage(usage, latency, "memory_ai_learn");
      const learned = safeJsonParse(content);
      const currentMemory = (profile?.memoryJson as any) || {};
      const updatedMemory = { ...currentMemory, ...learned, lastLearned: new Date().toISOString() };
      const [existing] = await db.select().from(userProfile).where(eq(userProfile.userId, userId));
      let result;
      if (existing) {
        [result] = await db.update(userProfile).set({ memoryJson: updatedMemory, brandVoice: learned.brandVoice || existing.brandVoice, updatedAt: new Date() }).where(eq(userProfile.userId, userId)).returning();
      } else {
        [result] = await db.insert(userProfile).values({ userId, memoryJson: updatedMemory, brandVoice: learned.brandVoice }).returning();
      }
      res.json({ learned, profile: result });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── AI IMAGE GENERATION ───────────────────────────────────────────────────────
  const { generatedImages } = await import("@shared/schema");

  app.get("/api/images", async (req, res) => {
    try {
      const images = await db.select().from(generatedImages).orderBy(desc(generatedImages.createdAt));
      res.json(images);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/images/generate", async (req, res) => {
    try {
      const { prompt, style = "professional", aspectRatio = "1:1", pillarId, postId, enhancePrompt = true } = req.body;
      if (!prompt) return res.status(400).json({ message: "Prompt is required" });

      let finalPrompt = prompt;
      if (enhancePrompt) {
        const styleGuides: Record<string, string> = {
          professional: "clean, professional, corporate, high-quality photography or illustration",
          minimal: "minimalist, clean lines, white space, modern design",
          technical: "technical diagram, infographic style, data visualization, clean and precise",
          bold: "bold typography, strong contrast, impactful visual, attention-grabbing",
          warm: "warm colors, approachable, human-centered, relatable photography",
        };
        const styleGuide = styleGuides[style] || styleGuides.professional;
        const sizeMap: Record<string, string> = { "1:1": "1024x1024", "16:9": "1792x1024", "9:16": "1024x1792" };
        const size = sizeMap[aspectRatio] || "1024x1024";

        finalPrompt = `${prompt}. Style: ${styleGuide}. No text overlays. No watermarks. No people's faces unless specifically requested. Professional content creation context.`;

        const response = await ai.images.generate({
          model: MODELS.IMAGE,
          prompt: finalPrompt,
          n: 1,
          size: size as any,
          quality: "standard",
        });

        const imageUrl = response.data?.[0]?.url || "";
        const revisedPrompt = response.data?.[0]?.revised_prompt || finalPrompt;

        const [saved] = await db.insert(generatedImages).values({
          prompt,
          revisedPrompt,
          imageUrl,
          style,
          aspectRatio,
          pillarId: pillarId ? parseInt(pillarId) : null,
          postId: postId ? parseInt(postId) : null,
        }).returning();

        res.json(saved);
      }
    } catch (err: any) {
      console.error("Image generation error:", err);
      res.status(500).json({ message: err.message || "Image generation failed" });
    }
  });

  app.post("/api/images/:id/favorite", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [current] = await db.select().from(generatedImages).where(eq(generatedImages.id, id));
      if (!current) return res.status(404).json({ message: "Image not found" });
      const [updated] = await db.update(generatedImages).set({ isFavorite: !current.isFavorite }).where(eq(generatedImages.id, id)).returning();
      res.json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/images/:id", async (req, res) => {
    try {
      await db.delete(generatedImages).where(eq(generatedImages.id, parseInt(req.params.id)));
      res.status(204).end();
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/images/generate-for-post", async (req, res) => {
    try {
      const { postId, style = "professional" } = req.body;
      if (!postId) return res.status(400).json({ message: "postId required" });
      const post = await storage.getPost(parseInt(postId));
      if (!post) return res.status(404).json({ message: "Post not found" });
      const content = post.tweets.map(t => t.content).join(" ");
      const { content: promptSuggestion, usage, latency } = await aiCall([
        { role: "system", content: "Generate a concise image generation prompt for a social media post image. The image should complement and enhance the post content. Return just the prompt text, no explanation." },
        { role: "user", content: `Post content:\n${content}\n\nGenerate a social media image prompt (max 100 words) that visually represents this post's key message.` },
      ]);
      await logAiUsage(usage, latency, "image_prompt_for_post");
      res.json({ suggestedPrompt: promptSuggestion.trim() });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── SMART SCHEDULING ─────────────────────────────────────────────────────────
  app.post("/api/schedule/suggest", async (req, res) => {
    try {
      const { platform = "x", contentType = "thread", timezone = "UTC", count = 5 } = req.body;
      const { content, usage, latency } = await aiCall([
        { role: "system", content: "You are a social media scheduling expert. Suggest optimal posting times based on platform best practices, audience behavior research, and content type." },
        { role: "user", content: `Suggest ${count} optimal posting times for the next 7 days for a Data & AI professional on ${platform === "x" ? "X (Twitter)" : "Threads"}.
Content type: ${contentType}
Target audience: Infrastructure engineers, data scientists, tech leaders
Timezone: ${timezone}

Return JSON: { "suggestions": [{ "dayOfWeek": "Monday", "time": "09:00", "reason": "...", "expectedEngagement": "high|medium|low", "audienceActivity": "..." }] }` },
      ], true);
      await logAiUsage(usage, latency, "smart_scheduling");
      const parsed = safeJsonParse(content);
      res.json(parsed || { suggestions: [] });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── CONTEXT VAULT ────────────────────────────────────────────────────────────
  const { contextVault: vaultTable, carousels: carouselsTable } = await import("@shared/schema");

  app.get("/api/vault", async (req, res) => {
    try {
      const items = await db.select().from(vaultTable).orderBy(desc(vaultTable.createdAt));
      res.json(items);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/vault", async (req, res) => {
    try {
      const { title, content, category, tags, sourceUrl, sourceType } = req.body;
      if (!title || !content) return res.status(400).json({ message: "Title and content are required" });
      const [item] = await db.insert(vaultTable).values({ title, content, category, tags, sourceUrl, sourceType }).returning();
      res.json(item);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/vault/extract-url", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ message: "URL is required" });
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      const html = await response.text();
      const $ = cheerio.load(html);
      $("script, style, nav, footer, header").remove();
      const title = $("title").text().trim() || $("h1").first().text().trim() || "Extracted Content";
      const content = $("article, main, .content, .post-content, .entry-content").text() || $("body").text();
      const cleaned = content.replace(/\s+/g, " ").trim().substring(0, 5000);
      const { content: summary, usage, latency } = await aiCall([
        { role: "system", content: "Summarize this web content concisely, capturing the key insights and facts. Focus on the most important points for a Data & AI professional. Return a clean, well-structured summary." },
        { role: "user", content: `URL: ${url}\n\nTitle: ${title}\n\nContent:\n${cleaned}` },
      ]);
      await logAiUsage(usage, latency, "vault_extract_url");
      res.json({ title: title.substring(0, 300), summary: summary.trim(), rawContent: cleaned, url });
    } catch (err: any) {
      console.error("URL extract error:", err);
      res.status(500).json({ message: `Failed to extract URL: ${err.message}` });
    }
  });

  app.post("/api/vault/extract-image", async (req, res) => {
    try {
      const { imageBase64, mimeType = "image/jpeg" } = req.body;
      if (!imageBase64) return res.status(400).json({ message: "Image data required" });
      const response = await ai.chat.completions.create({
        model: MODELS.VISION,
        messages: [{
          role: "user",
          content: [{
            type: "text",
            text: "Analyze this image and extract all text, key information, insights, and any important visual content. Structure your response as a detailed summary that captures everything useful from the image. Include any statistics, quotes, diagrams described, or key points visible."
          }, {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` }
          }]
        }],
        max_tokens: 1000,
      });
      const extracted = response.choices[0]?.message?.content || "";
      res.json({ content: extracted, title: "Extracted from Image" });
    } catch (err: any) {
      console.error("Image extract error:", err);
      res.status(500).json({ message: `Failed to analyze image: ${err.message}` });
    }
  });

  app.post("/api/vault/:id/favorite", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [current] = await db.select().from(vaultTable).where(eq(vaultTable.id, id));
      if (!current) return res.status(404).json({ message: "Not found" });
      const [updated] = await db.update(vaultTable).set({ isFavorite: !current.isFavorite }).where(eq(vaultTable.id, id)).returning();
      res.json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/vault/:id", async (req, res) => {
    try {
      await db.delete(vaultTable).where(eq(vaultTable.id, parseInt(req.params.id)));
      res.status(204).end();
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── YOUTUBE TO POST ───────────────────────────────────────────────────────────
  app.post("/api/youtube/extract", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ message: "YouTube URL is required" });
      const videoIdMatch = url.match(/(?:v=|youtu\.be\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
      if (!videoIdMatch) return res.status(400).json({ message: "Invalid YouTube URL" });
      const videoId = videoIdMatch[1];
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const oembedRes = await fetch(oembedUrl);
      const oembed = oembedRes.ok ? await oembedRes.json() : {};
      const title = (oembed as any).title || "YouTube Video";
      const author = (oembed as any).author_name || "";
      const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      res.json({ videoId, title, author, thumbnailUrl, url: `https://www.youtube.com/watch?v=${videoId}` });
    } catch (err: any) {
      res.status(500).json({ message: `Failed to extract YouTube info: ${err.message}` });
    }
  });

  app.post("/api/youtube/generate-post", async (req, res) => {
    try {
      const { videoId, title, author, pillarId, platform = "x", tone = "educational", postType = "thread" } = req.body;
      const pillar = CONTENT_PILLARS_DATA.find(p => p.id === pillarId);
      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Create a ${postType} for ${platform === "x" ? "X (Twitter)" : platform} based on this YouTube video.

Video Title: "${title}"
Channel: ${author}
Video URL: https://www.youtube.com/watch?v=${videoId}
${pillar ? `Content Pillar: ${pillar.name}` : ""}
Tone: ${tone}

Generate a compelling social media post that:
1. References insights from the video (use your knowledge of the topic based on the title)
2. Provides YOUR unique perspective as a Data & AI infrastructure expert
3. Adds commentary, agrees/disagrees, or builds on the topic
4. Ends with a call to action to watch the video
5. If it's a thread, create 3-5 tweets

Format as a thread with tweets separated by "---"` },
      ]);
      await logAiUsage(usage, latency, "youtube_to_post");
      const tweets = content.split("---").map((t: string) => ({ content: t.trim(), charCount: t.trim().length })).filter((t: any) => t.content);
      res.json({ tweets, model: MODELS.TEXT });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GENERATE FROM SOURCES (images + URLs + combined) ─────────────────────────
  app.post("/api/generate/from-sources", async (req, res) => {
    try {
      const { sources = [], pillarId, postType = "thread", tone = "educational", platform = "x", instructions = "" } = req.body;
      if (!sources.length) return res.status(400).json({ message: "At least one source is required" });
      const pillar = CONTENT_PILLARS_DATA.find(p => p.id === parseInt(pillarId || "0"));
      let combinedContext = "";
      for (const source of sources) {
        if (source.type === "text") {
          combinedContext += `\n\n[Source: Text]\n${source.content}`;
        } else if (source.type === "url" && source.content) {
          combinedContext += `\n\n[Source: ${source.url || "URL"}]\n${source.content}`;
        } else if (source.type === "image" && source.content) {
          combinedContext += `\n\n[Source: Image Analysis]\n${source.content}`;
        } else if (source.type === "vault" && source.content) {
          combinedContext += `\n\n[Vault: ${source.title || "Context"}]\n${source.content}`;
        }
      }
      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Create 3 variations of a ${postType} for ${platform === "x" ? "X (Twitter)" : platform === "linkedin" ? "LinkedIn" : "Threads"} based on the following source material.

${pillar ? `Content Pillar: ${pillar.name}` : ""}
Tone: ${tone}
${instructions ? `Special instructions: ${instructions}` : ""}

SOURCE MATERIAL:
${combinedContext}

Important: Transform this information into YOUR unique perspective as a Data & AI infrastructure expert named Kishore Kumar Behera. Don't just summarize — add insight, commentary, and actionable takeaways.

For each variation, use "---VARIATION---" as separator. For threads, separate tweets with "---".` },
      ]);
      await logAiUsage(usage, latency, "generate_from_sources");
      const variationTexts = content.split("---VARIATION---").filter((v: string) => v.trim());
      const variations = variationTexts.map((v: string) => ({
        tweets: v.split("---").map((t: string) => ({ content: t.trim(), charCount: t.trim().length })).filter((t: any) => t.content)
      }));
      res.json({ variations: variations.length ? variations : [{ tweets: [{ content: content.trim(), charCount: content.trim().length }] }], model: MODELS.TEXT });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── HOOK GENERATOR ────────────────────────────────────────────────────────────
  app.post("/api/hooks/generate", async (req, res) => {
    try {
      const { topic, pillarId, count = 8, includeViralScore = true } = req.body;
      if (!topic) return res.status(400).json({ message: "Topic is required" });
      const pillar = CONTENT_PILLARS_DATA.find(p => p.id === parseInt(pillarId || "0"));
      const { content, usage, latency } = await aiCall([
        { role: "system", content: "You are an expert social media hook writer specializing in Data & AI, Infrastructure, and Tech content. You understand viral psychology and what makes technical professionals stop scrolling." },
        { role: "user", content: `Generate ${count} powerful hooks/openers for this topic: "${topic}"
${pillar ? `Content Pillar: ${pillar.name}` : ""}

Hook types to include:
- Contrarian/Hot take ("Everyone says X, but...")
- Stat-based ("X% of companies...")
- Story opener ("I made a $500k mistake...")
- Question hook ("What if you could...")
- List hook ("5 things nobody tells you about...")
- Confession ("I used to think X...")
- Bold claim ("X is dead. Here's what's next:")
- FOMO ("Most engineers don't know this...")

${includeViralScore ? "For each hook, rate its viral potential (1-10) and explain why." : ""}

Return JSON: { "hooks": [{ "text": "...", "type": "...", "viralScore": 8, "why": "..." }] }` },
      ], true);
      await logAiUsage(usage, latency, "hook_generate");
      const parsed = safeJsonParse(content);
      res.json(parsed || { hooks: [] });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── CAROUSEL BUILDER ──────────────────────────────────────────────────────────
  app.get("/api/carousels", async (req, res) => {
    try {
      const items = await db.select().from(carouselsTable).orderBy(desc(carouselsTable.createdAt));
      res.json(items);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/carousels", async (req, res) => {
    try {
      const { title, pillarId, slides, platform, backgroundStyle } = req.body;
      if (!title) return res.status(400).json({ message: "Title is required" });
      const [item] = await db.insert(carouselsTable).values({ title, pillarId: pillarId || null, slides: slides || [], platform, backgroundStyle }).returning();
      res.json(item);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/carousels/:id", async (req, res) => {
    try {
      const { title, slides, status, backgroundStyle, platform, pillarId } = req.body;
      const [updated] = await db.update(carouselsTable).set({ title, slides, status, backgroundStyle, platform, pillarId: pillarId || null }).where(eq(carouselsTable.id, parseInt(req.params.id))).returning();
      res.json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/carousels/:id", async (req, res) => {
    try {
      await db.delete(carouselsTable).where(eq(carouselsTable.id, parseInt(req.params.id)));
      res.status(204).end();
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/carousels/generate", async (req, res) => {
    try {
      const { topic, pillarId, slideCount = 8, tone = "educational" } = req.body;
      if (!topic) return res.status(400).json({ message: "Topic is required" });
      const pillar = CONTENT_PILLARS_DATA.find(p => p.id === parseInt(pillarId || "0"));
      const { content, usage, latency } = await aiCall([
        { role: "system", content: "You are an expert LinkedIn carousel creator for Data & AI professionals. You create highly engaging, visually-structured carousel posts that get saves and shares." },
        { role: "user", content: `Create a ${slideCount}-slide LinkedIn carousel about: "${topic}"
${pillar ? `Content Pillar: ${pillar.name}` : ""}
Tone: ${tone}

Carousel Structure:
- Slide 1: Cover/Hook (title + compelling subtitle)
- Slides 2-${slideCount - 1}: Content slides (1 key point each, max 3 bullet points)
- Slide ${slideCount}: Call to action (follow, save, comment)

Return JSON: { 
  "title": "Carousel title",
  "slides": [
    { "slideNumber": 1, "type": "cover", "heading": "...", "subheading": "...", "emoji": "🚀" },
    { "slideNumber": 2, "type": "content", "heading": "...", "bullets": ["...", "..."], "emoji": "💡" },
    { "slideNumber": ${slideCount}, "type": "cta", "heading": "...", "body": "...", "cta": "..." }
  ]
}` },
      ], true);
      await logAiUsage(usage, latency, "carousel_generate");
      const parsed = safeJsonParse(content);
      res.json(parsed || { title: topic, slides: [] });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── CHAT → POST ───────────────────────────────────────────────────────────────
  app.post("/api/chat/message", async (req, res) => {
    try {
      const { messages, pillarId, platform = "x", postType = "tweet" } = req.body;
      if (!messages?.length) return res.status(400).json({ message: "Messages are required" });
      const pillar = CONTENT_PILLARS_DATA.find(p => p.id === parseInt(pillarId || "0"));
      const systemPrompt = `${SYSTEM_PROMPT}

You are also a collaborative content creation assistant. Help the user refine their ideas through conversation. 
When they're ready to generate a post, produce it in the format specified.
${pillar ? `Current content pillar: ${pillar.name}` : ""}
Target platform: ${platform === "x" ? "X (Twitter)" : platform === "linkedin" ? "LinkedIn" : "Threads"}
Post type: ${postType}

If the user asks to generate a post or says something like "write this", "create a post", "generate", or "make it a tweet/thread/post", produce the final post content ready to publish. Mark the final post with [POST_START] and [POST_END] tags.`;
      const aiMessages = [
        { role: "system" as const, content: systemPrompt },
        ...messages.map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ];
      const { content, usage, latency } = await aiCall(aiMessages);
      await logAiUsage(usage, latency, "chat_message");
      const postMatch = content.match(/\[POST_START\]([\s\S]*?)\[POST_END\]/);
      const postContent = postMatch ? postMatch[1].trim() : null;
      const displayContent = postMatch ? content.replace(/\[POST_START\][\s\S]*?\[POST_END\]/, "").trim() : content;
      res.json({ content: displayContent, postContent, hasPost: !!postContent });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/chat/refine-post", async (req, res) => {
    try {
      const { postContent, instruction, platform = "x" } = req.body;
      const { content, usage, latency } = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Refine this social media post based on the instruction.

CURRENT POST:
${postContent}

INSTRUCTION: ${instruction}

Return only the refined post content, no explanation.` },
      ]);
      await logAiUsage(usage, latency, "chat_refine");
      res.json({ content: content.trim() });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── AUTOPILOT ─────────────────────────────────────────────────────────────────

  // GET /api/autopilot/status — pipeline health at a glance
  app.get("/api/autopilot/status", async (req, res) => {
    try {
      const { runMorningBriefing: _mb, autofillCalendar: _af, ...ap } = await import("./autopilot");
      const posts = await storage.getPosts();
      const now = new Date();
      const today = posts.filter((p) => {
        if (!p.scheduledAt) return false;
        const d = new Date(p.scheduledAt as Date);
        return d.toDateString() === now.toDateString();
      });
      const failed = posts.filter((p) => p.status === "failed");
      const scheduled = posts.filter((p) => p.status === "scheduled" && new Date(p.scheduledAt as Date) > now);
      const ideas = await storage.getDiscoveredIdeas();
      const unusedIdeas = ideas.filter((i) => i.status === "new" || i.status === "briefing_drafted");
      const pillars = await storage.getPillars();

      // Content gap: pillars not posted in 7+ days
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const recentPosts = posts.filter((p) => p.postedAt && new Date(p.postedAt) > sevenDaysAgo);
      const activePillarIds = new Set(recentPosts.map((p) => p.pillarId));
      const gaps = pillars.filter((p) => !activePillarIds.has(p.id)).map((p) => p.name);

      res.json({
        ok: true,
        todaySlots: today.length,
        scheduledAhead: scheduled.length,
        failedPosts: failed.length,
        unusedIdeas: unusedIdeas.length,
        contentGaps: gaps,
        lastUpdated: now.toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/autopilot/market-pulse — today's breaking news + X algorithm context
  app.get("/api/autopilot/market-pulse", async (_req, res) => {
    try {
      const { getMarketPulse } = await import("./marketPulse");
      const pulse = await getMarketPulse();
      res.json(pulse);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/autopilot/morning-briefing — trigger manually (also runs on cron at 05:00 UTC)
  app.post("/api/autopilot/morning-briefing", async (req, res) => {
    try {
      const { runMorningBriefing } = await import("./autopilot");
      const result = await runMorningBriefing();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/autopilot/autofill — fill next N days (default 7) with 3 posts/day
  app.post("/api/autopilot/autofill", async (req, res) => {
    try {
      const { autofillCalendar } = await import("./autopilot");
      const days = Number(req.body?.days ?? 7);
      const result = await autofillCalendar(Math.min(days, 14));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/autopilot/content-gaps — pillars not posted in N days (default 7)
  app.get("/api/autopilot/content-gaps", async (req, res) => {
    try {
      const days = Number(req.query.days ?? 7);
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const posts = await storage.getPosts();
      const pillars = await storage.getPillars();
      const recentPillarIds = new Set(
        posts.filter((p) => p.postedAt && new Date(p.postedAt) > cutoff).map((p) => p.pillarId),
      );
      const gaps = pillars
        .filter((p) => !recentPillarIds.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, color: p.color }));
      res.json({ gaps, daysWindow: days });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/schedule/best-times", async (req, res) => {
    const bestTimes = {
      x: [
        { day: "Tuesday", times: ["9:00 AM", "12:00 PM", "5:00 PM"], engagement: "highest" },
        { day: "Wednesday", times: ["8:00 AM", "1:00 PM", "5:00 PM"], engagement: "high" },
        { day: "Thursday", times: ["9:00 AM", "12:00 PM", "6:00 PM"], engagement: "high" },
        { day: "Monday", times: ["10:00 AM", "2:00 PM"], engagement: "medium" },
        { day: "Friday", times: ["9:00 AM", "11:00 AM"], engagement: "medium" },
      ],
      threads: [
        { day: "Wednesday", times: ["7:00 AM", "11:00 AM", "7:00 PM"], engagement: "highest" },
        { day: "Thursday", times: ["8:00 AM", "12:00 PM", "8:00 PM"], engagement: "high" },
        { day: "Tuesday", times: ["9:00 AM", "1:00 PM"], engagement: "high" },
        { day: "Monday", times: ["8:00 AM", "6:00 PM"], engagement: "medium" },
        { day: "Friday", times: ["10:00 AM", "2:00 PM"], engagement: "medium" },
      ],
    };
    res.json(bestTimes);
  });

  // ── MANUAL SCHEDULING ──────────────────────────────────────────────────────────

  // POST /api/posts/schedule — manually schedule a post at any time
  app.post("/api/posts/schedule", async (req, res) => {
    try {
      const { ideaId, scheduledAt, postType, imageUrl } = req.body;
      if (!ideaId || !scheduledAt) {
        return res.status(400).json({ message: "ideaId and scheduledAt are required" });
      }
      const scheduleTime = new Date(scheduledAt);
      if (Number.isNaN(scheduleTime.getTime()) || scheduleTime <= new Date()) {
        return res.status(400).json({ message: "scheduledAt must be a valid future datetime" });
      }

      const { scheduleManualPost } = await import("./autopilot");
      const result = await scheduleManualPost(Number(ideaId), scheduleTime, postType);
      if (result.error) {
        return res.status(500).json({ message: result.error });
      }
      res.json({ success: true, postId: result.postId, scheduledAt: scheduleTime });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/autopilot/smoke-test — trigger immediate pipeline run for testing
  app.post("/api/autopilot/smoke-test", async (req, res) => {
    try {
      const { runDailyAutoPost } = await import("./autopilot");
      console.log("[smoke-test] Triggering immediate auto-post pipeline...");
      const result = await runDailyAutoPost();
      res.json({
        success: true,
        message: `Smoke test complete. Scheduled ${result.postsScheduled} posts for today.`,
        newIdeas: result.newIdeas,
        postsScheduled: result.postsScheduled,
        errors: result.errors,
        topIdeas: result.topIdeas.slice(0, 3),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
