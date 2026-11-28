import { Router } from "express";
import { z } from "zod";
import { getUserId } from "../middleware/userContext";
import { probeProvider } from "./probe";
import { providerStorage } from "./provider-storage";
import { decryptSecret } from "../middleware/crypto";
import { allowLocalAiProviderUrls, assertSafeUrl, UnsafeUrlError } from "../security/ssrf";

const headerSchema = z.record(z.string().max(200)).refine(
  (headers) => Object.keys(headers).every((key) => !/^authorization$|^cookie$|^set-cookie$/i.test(key)),
  "authorization and cookie headers are not accepted here",
);

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(80).default("openai-compatible"),
  baseUrl: z.string().trim().url().max(500),
  apiKey: z.string().min(1).max(500).optional(),
  model: z.string().trim().min(1).max(200),
  organization: z.string().trim().max(120).optional(),
  project: z.string().trim().max(120).optional(),
  headers: headerSchema.optional(),
  transport: z.enum(["auto", "chat_completions", "responses"]).default("auto"),
  isDefault: z.boolean().optional(),
});

const patchBody = createBody.partial().extend({
  enabled: z.boolean().optional(),
});

const routeBody = z.object({
  purpose: z.string().trim().min(1).max(80),
  providerId: z.number().int().positive(),
  model: z.string().trim().max(200).optional(),
  priority: z.number().int().min(0).max(1000).default(0),
  allowFallback: z.boolean().default(false),
  fallbackProviderId: z.number().int().positive().nullable().optional(),
  fallbackModel: z.string().trim().max(200).nullable().optional(),
});

const deleteBody = z.object({
  confirmName: z.string().trim().min(1).max(120),
});

function ownerId(req: { userId?: number }): number {
  const id = getUserId(req as never);
  if (!id) throw new Error("provider routes require an authenticated session");
  return id;
}

function missingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ai_providers|ai_model_routes|does not exist|42P01/i.test(message);
}

export interface ProviderRouterDeps {
  storage?: typeof providerStorage;
  probe?: typeof probeProvider;
  validateUrl?: (url: string) => Promise<URL>;
}

export function createProviderRouter(deps: ProviderRouterDeps = {}): Router {
  const router = Router();
  const store = deps.storage ?? providerStorage;
  const runProbe = deps.probe ?? probeProvider;
  const validateUrl =
    deps.validateUrl ??
    ((url: string) => assertSafeUrl(url, { allowLoopback: allowLocalAiProviderUrls() }));

  router.get("/providers", async (req, res, next) => {
    try {
      const userId = ownerId(req);
      const rows = await store.list(userId);
      const routes = await store.listRoutes(userId);
      return res.json({
        providers: rows.map((row) => store.toPublic(row)),
        routes: routes.map((row) => store.toPublicRoute(row)),
      });
    } catch (error) {
      if (missingTable(error)) return res.status(503).json({ message: "ai_providers table is missing. Run db:push." });
      return next(error);
    }
  });

  router.post("/providers", async (req, res, next) => {
    const parsed = createBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map((issue) => issue.message).join(", ") });
    try {
      await validateUrl(parsed.data.baseUrl);
    } catch (error) {
      if (error instanceof UnsafeUrlError) {
        return res.status(400).json({ message: error.message });
      }
      return next(error);
    }
    try {
      const userId = ownerId(req);
      const body = parsed.data;
      const existing = await store.list(userId);
      const row = await store.insert({
        userId,
        name: body.name,
        type: body.type,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey ?? null,
        organization: body.organization ?? null,
        project: body.project ?? null,
        extraHeaders: body.headers ?? {},
        transport: body.transport,
        defaultModel: body.model,
        isDefault: body.isDefault ?? existing.length === 0,
      });
      return res.status(201).json({ provider: store.toPublic(row) });
    } catch (error) {
      if (missingTable(error)) return res.status(503).json({ message: "ai_providers table is missing. Run db:push." });
      return next(error);
    }
  });

  router.patch("/providers/:id", async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "invalid provider id" });
    const parsed = patchBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map((issue) => issue.message).join(", ") });
    if (parsed.data.baseUrl !== undefined) {
      try {
        await validateUrl(parsed.data.baseUrl);
      } catch (error) {
        if (error instanceof UnsafeUrlError) {
          return res.status(400).json({ message: error.message });
        }
        return next(error);
      }
    }
    try {
      const row = await store.update(ownerId(req), id, {
        name: parsed.data.name,
        type: parsed.data.type,
        baseUrl: parsed.data.baseUrl,
        apiKey: parsed.data.apiKey,
        organization: parsed.data.organization,
        project: parsed.data.project,
        extraHeaders: parsed.data.headers,
        transport: parsed.data.transport,
        defaultModel: parsed.data.model,
        enabled: parsed.data.enabled,
      });
      if (!row) return res.status(404).json({ message: "provider not found" });
      return res.json({ provider: store.toPublic(row) });
    } catch (error) {
      if (missingTable(error)) return res.status(503).json({ message: "ai_providers table is missing. Run db:push." });
      return next(error);
    }
  });

  router.post("/providers/:id/default", async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "invalid provider id" });
    try {
      const row = await store.setDefault(ownerId(req), id);
      if (!row) return res.status(404).json({ message: "provider not found" });
      return res.json({ provider: store.toPublic(row) });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/providers/:id/test", async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "invalid provider id" });
    try {
      const userId = ownerId(req);
      const row = await store.get(userId, id);
      if (!row) return res.status(404).json({ message: "provider not found" });
      const preference = row.transport === "responses" || row.transport === "chat_completions" ? row.transport : "auto";
      const result = await runProbe({
        baseUrl: row.baseUrl,
        apiKey: row.secretCiphertext ? decryptSecret(row.secretCiphertext) : null,
        model: row.defaultModel,
        organization: row.organization,
        project: row.project,
        extraHeaders: row.extraHeaders ?? {},
        transport: preference,
      });
      const updated = await store.update(userId, id, {
        models: result.models,
        detectedTransport: result.transport === "unknown" ? null : result.transport,
        capabilities: result.capabilities,
        lastHealthAt: new Date(),
        lastHealthOk: result.ok,
        lastHealthError: result.error,
      });
      return res.json({
        ok: result.ok,
        transport: result.transport,
        models: result.models,
        capabilities: result.capabilities,
        error: result.error,
        errorCategory: result.errorCategory,
        latencyMs: result.latencyMs,
        provider: updated ? store.toPublic(updated) : null,
      });
    } catch (error) {
      if (missingTable(error)) return res.status(503).json({ message: "ai_providers table is missing. Run db:push." });
      return next(error);
    }
  });

  router.delete("/providers/:id", async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "invalid provider id" });
    const parsed = deleteBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "confirmName is required" });
    try {
      const userId = ownerId(req);
      const row = await store.get(userId, id);
      if (!row) return res.status(404).json({ message: "provider not found" });
      if (row.name !== parsed.data.confirmName) return res.status(400).json({ message: "confirmation name does not match" });
      await store.remove(userId, id);
      return res.json({ deleted: true });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/routes", async (req, res, next) => {
    const parsed = routeBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map((issue) => issue.message).join(", ") });
    try {
      const userId = ownerId(req);
      const provider = await store.get(userId, parsed.data.providerId);
      if (!provider) return res.status(404).json({ message: "provider not found" });
      if (parsed.data.fallbackProviderId) {
        const fallback = await store.get(userId, parsed.data.fallbackProviderId);
        if (!fallback) return res.status(404).json({ message: "fallback provider not found" });
      }
      const row = await store.insertRoute({
        userId,
        purpose: parsed.data.purpose,
        providerId: parsed.data.providerId,
        model: parsed.data.model ?? null,
        priority: parsed.data.priority,
        allowFallback: parsed.data.allowFallback,
        fallbackProviderId: parsed.data.fallbackProviderId ?? null,
        fallbackModel: parsed.data.fallbackModel ?? null,
      });
      return res.status(201).json({ route: store.toPublicRoute(row) });
    } catch (error) {
      if (missingTable(error)) return res.status(503).json({ message: "ai_model_routes table is missing. Run db:push." });
      return next(error);
    }
  });

  return router;
}
