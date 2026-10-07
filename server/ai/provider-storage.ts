import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { aiModelRoutes, aiProviders, type AiModelRouteRow, type AiProviderRow } from "@shared/schema";
import { db as defaultDb } from "../db";
import { decryptSecret, encryptSecret } from "../middleware/crypto";
import { toPublicProvider } from "./provider-view";
import type { ModelRouteCandidate, ProviderCandidate } from "./select-provider";

export type ProviderDatabase = NodePgDatabase<typeof schema>;

export type { PublicProvider } from "./provider-view";

export type PublicRoute = {
  id: number;
  purpose: string;
  providerId: number;
  model: string | null;
  priority: number;
  enabled: boolean;
  allowFallback: boolean;
  fallbackProviderId: number | null;
  fallbackModel: string | null;
};

function toCandidate(row: AiProviderRow): ProviderCandidate {
  const detected = row.detectedTransport === "responses" ? "responses" : "chat_completions";
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    apiKey: row.secretCiphertext ? decryptSecret(row.secretCiphertext) : null,
    model: row.defaultModel,
    transport: detected,
    enabled: row.enabled,
    isDefault: row.isDefault,
    headers: {
      ...(row.extraHeaders ?? {}),
      ...(row.organization ? { "openai-organization": row.organization } : {}),
      ...(row.project ? { "openai-project": row.project } : {}),
    },
  };
}

function toRoute(row: AiModelRouteRow): ModelRouteCandidate {
  return {
    purpose: row.purpose,
    providerId: row.providerId,
    model: row.model,
    priority: row.priority,
    enabled: row.enabled,
    allowFallback: row.allowFallback,
    fallbackProviderId: row.fallbackProviderId,
    fallbackModel: row.fallbackModel,
  };
}

export function createProviderStorage(database: ProviderDatabase = defaultDb) {
  return {
    async list(userId: number): Promise<AiProviderRow[]> {
      return database.select().from(aiProviders).where(eq(aiProviders.userId, userId)).orderBy(asc(aiProviders.id));
    },
    async listRoutes(userId: number): Promise<AiModelRouteRow[]> {
      return database.select().from(aiModelRoutes).where(eq(aiModelRoutes.userId, userId)).orderBy(asc(aiModelRoutes.priority));
    },
    async get(userId: number, id: number): Promise<AiProviderRow | null> {
      const [row] = await database
        .select()
        .from(aiProviders)
        .where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)));
      return row ?? null;
    },
    candidates(rows: AiProviderRow[]): ProviderCandidate[] {
      return rows.map(toCandidate);
    },
    routeCandidates(rows: AiModelRouteRow[]): ModelRouteCandidate[] {
      return rows.map(toRoute);
    },
    toPublic: toPublicProvider,
    toPublicRoute(row: AiModelRouteRow): PublicRoute {
      return {
        id: row.id,
        purpose: row.purpose,
        providerId: row.providerId,
        model: row.model,
        priority: row.priority,
        enabled: row.enabled,
        allowFallback: row.allowFallback,
        fallbackProviderId: row.fallbackProviderId,
        fallbackModel: row.fallbackModel,
      };
    },
    async insert(input: {
      userId: number;
      name: string;
      type: string;
      baseUrl: string;
      apiKey: string | null;
      organization: string | null;
      project: string | null;
      extraHeaders: Record<string, string>;
      transport: string;
      defaultModel: string;
      isDefault: boolean;
    }): Promise<AiProviderRow> {
      if (input.isDefault) {
        await database.update(aiProviders).set({ isDefault: false }).where(eq(aiProviders.userId, input.userId));
      }
      const [row] = await database
        .insert(aiProviders)
        .values({
          userId: input.userId,
          name: input.name,
          type: input.type,
          baseUrl: input.baseUrl,
          secretCiphertext: input.apiKey ? encryptSecret(input.apiKey) : null,
          organization: input.organization,
          project: input.project,
          extraHeaders: input.extraHeaders,
          transport: input.transport,
          defaultModel: input.defaultModel,
          isDefault: input.isDefault,
        })
        .returning();
      return row;
    },
    async update(
      userId: number,
      id: number,
      patch: Partial<{
        name: string;
        type: string;
        baseUrl: string;
        apiKey: string | null;
        organization: string | null;
        project: string | null;
        extraHeaders: Record<string, string>;
        transport: string;
        defaultModel: string;
        enabled: boolean;
        models: string[];
        detectedTransport: string | null;
        capabilities: Record<string, unknown>;
        lastHealthAt: Date;
        lastHealthOk: boolean;
        lastHealthError: string | null;
      }>,
    ): Promise<AiProviderRow | null> {
      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.name != null) values.name = patch.name;
      if (patch.type != null) values.type = patch.type;
      if (patch.baseUrl != null) values.baseUrl = patch.baseUrl;
      if (patch.apiKey) values.secretCiphertext = encryptSecret(patch.apiKey);
      if (patch.organization !== undefined) values.organization = patch.organization;
      if (patch.project !== undefined) values.project = patch.project;
      if (patch.extraHeaders) values.extraHeaders = patch.extraHeaders;
      if (patch.transport) values.transport = patch.transport;
      if (patch.defaultModel) values.defaultModel = patch.defaultModel;
      if (patch.enabled != null) values.enabled = patch.enabled;
      if (patch.models) values.models = patch.models;
      if (patch.detectedTransport !== undefined) values.detectedTransport = patch.detectedTransport;
      if (patch.capabilities) values.capabilities = patch.capabilities;
      if (patch.lastHealthAt) values.lastHealthAt = patch.lastHealthAt;
      if (patch.lastHealthOk != null) values.lastHealthOk = patch.lastHealthOk;
      if (patch.lastHealthError !== undefined) values.lastHealthError = patch.lastHealthError;
      const [row] = await database
        .update(aiProviders)
        .set(values)
        .where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)))
        .returning();
      return row ?? null;
    },
    async setDefault(userId: number, id: number): Promise<AiProviderRow | null> {
      await database.update(aiProviders).set({ isDefault: false, updatedAt: new Date() }).where(eq(aiProviders.userId, userId));
      const [row] = await database
        .update(aiProviders)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)))
        .returning();
      return row ?? null;
    },
    async remove(userId: number, id: number): Promise<boolean> {
      await database.delete(aiModelRoutes).where(and(eq(aiModelRoutes.userId, userId), eq(aiModelRoutes.providerId, id)));
      const deleted = await database
        .delete(aiProviders)
        .where(and(eq(aiProviders.userId, userId), eq(aiProviders.id, id)))
        .returning({ id: aiProviders.id });
      return deleted.length > 0;
    },
    async insertRoute(input: {
      userId: number;
      purpose: string;
      providerId: number;
      model: string | null;
      priority: number;
      allowFallback: boolean;
      fallbackProviderId: number | null;
      fallbackModel: string | null;
    }): Promise<AiModelRouteRow> {
      const [row] = await database.insert(aiModelRoutes).values(input).returning();
      return row;
    },
  };
}

export const providerStorage = createProviderStorage();
