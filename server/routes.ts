import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertPostSchema, insertIdeaSchema, insertAnalyticsSchema } from "@shared/schema";
import { z } from "zod";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const SYSTEM_PROMPT = `You are a ghostwriter for Kishore Kumar Behera, a senior Infrastructure Engineering Lead with 11+ years in DevOps, Cloud (AWS/Azure/GCP), Kubernetes, and Platform Engineering. He is building a personal brand on X (Twitter) and Threads at the intersection of Data & AI and DevOps/Infrastructure.

Writing style guidelines:
- Write in first person as Kishore
- Be technically credible — use specific tools, metrics, and real-world scenarios
- Avoid generic AI hype; focus on practical, hands-on insights
- Mix technical depth with accessibility
- Use short, punchy sentences for tweets. No fluff.
- For threads, start with a killer hook
- End threads with a clear takeaway or call to action
- Tone should match the selected tone
- For X: Stay within 280 characters per individual tweet
- For Threads: Stay within 500 characters per individual post
- Use line breaks for readability
- Never use hashtags inside post body`;

function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    const match = str.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
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

  app.get("/api/pillars", async (_req, res) => {
    try {
      const result = await storage.getPillars();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/posts", async (_req, res) => {
    try {
      const result = await storage.getPosts();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/posts/:id", async (req, res) => {
    try {
      const result = await storage.getPost(parseInt(req.params.id));
      if (!result) return res.status(404).json({ message: "Post not found" });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
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
        tweetData.map((t) => ({
          postId: 0,
          content: t.content,
          position: t.position,
          charCount: t.charCount ?? t.content.length,
        }))
      );
      res.status(201).json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors.map((e) => e.message).join(", ") });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.put("/api/posts/:id", async (req, res) => {
    try {
      const result = await storage.updatePost(parseInt(req.params.id), req.body);
      if (!result) return res.status(404).json({ message: "Post not found" });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/posts/:id/status", async (req, res) => {
    try {
      const parsed = updateStatusBody.parse(req.body);
      const result = await storage.updatePostStatus(parseInt(req.params.id), parsed.status, parsed.scheduledAt);
      if (!result) return res.status(404).json({ message: "Post not found" });
      res.json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors.map((e) => e.message).join(", ") });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/posts/:id", async (req, res) => {
    try {
      await storage.deletePost(parseInt(req.params.id));
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ideas", async (_req, res) => {
    try {
      const result = await storage.getIdeas();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ideas", async (req, res) => {
    try {
      const parsed = createIdeaBody.parse(req.body);
      const result = await storage.createIdea({
        title: parsed.title,
        notes: parsed.notes ?? null,
        pillarId: parsed.pillarId ?? null,
      });
      res.status(201).json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors.map((e) => e.message).join(", ") });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/ideas/:id", async (req, res) => {
    try {
      await storage.deleteIdea(parseInt(req.params.id));
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ideas/:id/expand", async (req, res) => {
    try {
      const idea = (await storage.getIdeas()).find((i) => i.id === parseInt(req.params.id));
      if (!idea) return res.status(404).json({ message: "Idea not found" });

      const allPillars = await storage.getPillars();
      const pillar = allPillars.find((p) => p.id === idea.pillarId);

      const startTime = Date.now();
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Expand this content idea into a ready-to-post tweet thread (3-5 tweets). Make it engaging and informative.

Topic: ${idea.title}
${idea.notes ? `Notes: ${idea.notes}` : ""}
${pillar ? `Content Pillar: ${pillar.name} - ${pillar.description}` : ""}

Return ONLY a JSON object with this structure:
{"tweets": [{"content": "tweet text here"}]}

Each tweet must be under 280 characters. The first tweet should be a hook.`,
          },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 8192,
      });

      const latency = Date.now() - startTime;
      const content = response.choices[0]?.message?.content || "{}";
      const parsed = safeJsonParse(content);

      if (!parsed || !Array.isArray(parsed.tweets)) {
        return res.status(500).json({ message: "AI returned an invalid response. Please try again." });
      }

      await storage.createAiUsageLog({
        model: "gpt-4o-mini",
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        latencyMs: latency,
        feature: "expand_idea",
      });

      const tweetData = parsed.tweets.map((t: any, i: number) => ({
        content: String(t.content || ""),
        position: i,
        charCount: String(t.content || "").length,
        postId: 0,
      }));

      const post = await storage.createPost(
        {
          pillarId: idea.pillarId,
          postType: "thread",
          tone: "conversational",
          targetPlatform: "both",
          status: "draft",
          aiModel: "gpt-4o-mini",
        },
        tweetData
      );

      await storage.updateIdea(parseInt(req.params.id), { isExpanded: true });
      res.json(post);
    } catch (err: any) {
      console.error("Expand idea error:", err);
      res.status(500).json({ message: "Failed to expand idea. Please try again." });
    }
  });

  app.get("/api/templates", async (_req, res) => {
    try {
      const result = await storage.getTemplates();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
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

      const startTime = Date.now();
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Fill in this tweet template with specific, real-world content based on Kishore's expertise in DevOps, Cloud Infrastructure, and Data & AI.

Template: "${template.pattern}"
${pillar ? `Content Pillar: ${pillar.name}` : ""}

Return ONLY the filled-in tweet text (no JSON, no explanation). Keep it under 280 characters if possible.`,
          },
        ],
        max_completion_tokens: 8192,
      });

      const latency = Date.now() - startTime;
      const content = response.choices[0]?.message?.content || "";

      await storage.createAiUsageLog({
        model: "gpt-4o-mini",
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        latencyMs: latency,
        feature: "fill_template",
      });

      res.json({ content: content.trim(), model: "gpt-4o-mini" });
    } catch (err: any) {
      console.error("Fill template error:", err);
      res.status(500).json({ message: "Failed to fill template. Please try again." });
    }
  });

  app.post("/api/generate", async (req, res) => {
    try {
      const parsed = generateBody.parse(req.body);
      const allPillars = await storage.getPillars();
      const pillar = parsed.pillar ? allPillars.find((p) => p.id === parseInt(parsed.pillar!)) : null;

      const charLimit = parsed.platform === "threads" ? 500 : 280;
      const tweetCount = parsed.postType === "thread" ? "5-7" : "1";

      const startTime = Date.now();
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Generate 3 variations of a ${parsed.postType} post for ${parsed.platform === "both" ? "X (Twitter) and Threads" : parsed.platform === "x" ? "X (Twitter)" : "Threads"}.

${pillar ? `Content Pillar: ${pillar.name} - ${pillar.description}` : ""}
Post Type: ${parsed.postType} (${tweetCount} tweets/posts per variation)
Tone: ${parsed.tone}
Character limit per tweet/post: ${charLimit}
${parsed.context ? `Context/Topic: ${parsed.context}` : ""}

Return a JSON object with this exact structure:
{"variations": [{"tweets": [{"content": "tweet text here"}]}, {"tweets": [{"content": "tweet text here"}]}, {"tweets": [{"content": "tweet text here"}]}]}

Each variation should have ${tweetCount} tweet(s). Each tweet MUST be under ${charLimit} characters. Make them distinct in approach.`,
          },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 8192,
      });

      const latency = Date.now() - startTime;
      const content = response.choices[0]?.message?.content || "{}";
      const result = safeJsonParse(content);

      if (!result || !Array.isArray(result.variations)) {
        return res.status(500).json({ message: "AI returned an invalid response. Please try again." });
      }

      await storage.createAiUsageLog({
        model: "gpt-4o-mini",
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        latencyMs: latency,
        feature: "generate",
      });

      const variations = result.variations.map((v: any) => ({
        tweets: (v.tweets || []).map((t: any) => ({
          content: String(t.content || ""),
          charCount: String(t.content || "").length,
        })),
      }));

      res.json({ variations, model: "gpt-4o-mini" });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors.map((e) => e.message).join(", ") });
      }
      console.error("Generate error:", err);
      res.status(500).json({ message: "Failed to generate content. Please try again." });
    }
  });

  app.get("/api/analytics/summary", async (_req, res) => {
    try {
      const result = await storage.getAnalyticsSummary();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/analytics", async (req, res) => {
    try {
      const result = await storage.createAnalytics(req.body);
      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/usage", async (_req, res) => {
    try {
      const result = await storage.getAiUsageLogs();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
