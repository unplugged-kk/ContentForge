/**
 * last30days — optional external SourceProvider.
 *
 * last30days is not a second ResearchEngine. ContentForge remains authoritative:
 * doctor JSON decides which sources are actually available, results are
 * normalized into NormalizedSource, and cookie/session backends are never used
 * on the hosted path (`--no-browser-cookies`).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { JobFailure } from "../../jobs/failures";
import type {
  BackendProbeResult,
  DiscoverContext,
  NormalizedSource,
  ProviderBackend,
  ProviderDefinition,
  ResearchQuery,
  SearchContext,
} from "../contracts";
import { buildExcerpt, canonicalizeUrl, computeSourceHash, normalizeText, toIsoOrNull } from "../normalize";

export const LAST30DAYS_PROVIDER_ID = "last30days";
export const LAST30DAYS_PROVIDER_VERSION = "1.0.0";

/** Cookie-free sources ContentForge is willing to ingest from last30days. */
export const LAST30DAYS_HOSTED_SOURCES = [
  "reddit",
  "hackernews",
  "web",
  "github",
  "polymarket",
  "arxiv",
  "techmeme",
  "digg",
] as const;

export const last30daysProviderConfigSchema = z.object({
  defaultLimit: z.number().int().positive().max(50).default(10),
  sources: z.array(z.string().trim().min(1)).max(12).optional(),
});

export type Last30DaysProviderConfig = z.infer<typeof last30daysProviderConfigSchema>;

export interface Last30DaysCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface Last30DaysProviderDeps {
  runCommand: (args: string[], timeoutMs: number) => Promise<Last30DaysCommandResult>;
  scriptPath: string | null;
  now?: () => Date;
}

export interface Last30DaysDoctorSource {
  name: string;
  tier: string;
  status: string;
  activeBackend: string | null;
  available: boolean;
}

export interface Last30DaysDoctorReport {
  engineVersion: string | null;
  sources: Last30DaysDoctorSource[];
  availableHosted: string[];
  raw: Record<string, unknown>;
}

function defaultScriptPath(): string | null {
  const configured = process.env.LAST30DAYS_SCRIPT?.trim();
  if (configured) return configured;
  const homedir = os.homedir();
  const candidates = [
    path.join(homedir, ".cursor/skills/last30days/scripts/last30days.py"),
    path.join(homedir, ".agents/skills/last30days/scripts/last30days.py"),
    path.join(homedir, ".claude/skills/last30days/scripts/last30days.py"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function spawnLast30Days(
  scriptPath: string,
  args: string[],
  timeoutMs: number,
): Promise<Last30DaysCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [scriptPath, ...args], {
      env: { ...process.env, LAST30DAYS_NO_BROWSER_COOKIES: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(JobFailure.transient(`last30days timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 2 * 1024 * 1024) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk.slice(0, 8_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(JobFailure.transient(`last30days spawn failed: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function parseDoctorReport(raw: unknown): Last30DaysDoctorReport {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const sourcesRaw = record.sources && typeof record.sources === "object" && !Array.isArray(record.sources)
    ? (record.sources as Record<string, unknown>)
    : {};
  const sources: Last30DaysDoctorSource[] = Object.entries(sourcesRaw).map(([name, value]) => {
    const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const tier = String(row.tier ?? row.status ?? "off");
    const status = String(row.status ?? tier);
    const available = tier === "ok" || tier === "warn" || status === "ok" || status === "degraded";
    return {
      name,
      tier,
      status,
      activeBackend: typeof row.active_backend === "string" ? row.active_backend : null,
      available,
    };
  });
  const availableHosted = sources
    .filter((source) => source.available && LAST30DAYS_HOSTED_SOURCES.includes(source.name as typeof LAST30DAYS_HOSTED_SOURCES[number]))
    .map((source) => source.name);
  return {
    engineVersion: typeof record.engine_version === "string" ? record.engine_version : null,
    sources,
    availableHosted,
    raw: record,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function collectItems(node: unknown, acc: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) collectItems(item, acc);
    return acc;
  }
  const record = asRecord(node);
  if (!record) return acc;
  if (typeof record.url === "string" && (record.title || record.body || record.snippet)) {
    acc.push(record);
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") collectItems(value, acc);
  }
  return acc;
}

export function normalizeLast30DaysItems(
  payload: unknown,
  now: Date,
  limit: number,
): NormalizedSource[] {
  const items = collectItems(payload);
  const out: NormalizedSource[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const url = canonicalizeUrl(String(item.url ?? item.canonical_url ?? ""));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const sourceName = String(item.source ?? item.provider ?? "last30days");
    if (!LAST30DAYS_HOSTED_SOURCES.includes(sourceName as typeof LAST30DAYS_HOSTED_SOURCES[number]) && sourceName !== "last30days") {
      continue;
    }
    const title = typeof item.title === "string" ? item.title : null;
    const body = String(item.body ?? item.snippet ?? item.excerpt ?? title ?? "");
    const nativeId = String(item.item_id ?? item.id ?? url);
    out.push({
      ref: { provider: LAST30DAYS_PROVIDER_ID, kind: sourceName, nativeId, canonicalUrl: url },
      provider: LAST30DAYS_PROVIDER_ID,
      backend: "last30days-cli",
      providerVersion: LAST30DAYS_PROVIDER_VERSION,
      retrievalMethod: "external-cli",
      accessClass: "open",
      canonicalUrl: url,
      title,
      author: typeof item.author === "string" ? { name: item.author } : null,
      publishedAt: toIsoOrNull(item.published_at ?? item.publishedAt),
      retrievedAt: now.toISOString(),
      excerpt: buildExcerpt(body),
      contentHash: computeSourceHash(url, body),
      engagement: item.engagement && typeof item.engagement === "object"
        ? { raw: item.engagement as Record<string, number | string> }
        : undefined,
      metadata: {
        last30daysSource: sourceName,
        origin: "last30days",
      },
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function createLast30DaysDeps(): Last30DaysProviderDeps {
  const scriptPath = defaultScriptPath();
  return {
    scriptPath,
    runCommand: async (args, timeoutMs) => {
      if (!scriptPath) throw JobFailure.permanent("last30days script is not configured");
      return spawnLast30Days(scriptPath, args, timeoutMs);
    },
  };
}

function readConfig(ctx: { config: Readonly<Record<string, unknown>> }): Last30DaysProviderConfig {
  return last30daysProviderConfigSchema.parse(ctx.config ?? {});
}

async function doctor(deps: Last30DaysProviderDeps, timeoutMs: number): Promise<Last30DaysDoctorReport> {
  if (!deps.scriptPath) {
    return { engineVersion: null, sources: [], availableHosted: [], raw: { reason: "unconfigured" } };
  }
  const result = await deps.runCommand(["doctor", "--json"], timeoutMs);
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw JobFailure.transient("last30days doctor returned unparseable JSON");
  }
  return parseDoctorReport(parsed);
}

export function createLast30DaysProvider(
  overrides: Partial<Last30DaysProviderDeps> = {},
): ProviderDefinition {
  const deps: Last30DaysProviderDeps = { ...createLast30DaysDeps(), ...overrides };
  const now = deps.now ?? (() => new Date());

  const backend: ProviderBackend = {
    id: "last30days-cli",
    capabilities: ["discover", "search"],
    sourceCapabilities: ["time-window", "historical", "engagement", "structured-metadata"],

    async probe(): Promise<BackendProbeResult> {
      if (!deps.scriptPath) {
        return { state: "unavailable", message: "LAST30DAYS_SCRIPT not found; provider unconfigured" };
      }
      try {
        const report = await doctor(deps, 20_000);
        const hosted = report.availableHosted;
        if (hosted.length === 0) {
          return {
            state: "degraded",
            message: "last30days doctor ran but no cookie-free hosted sources are available",
            capabilities: {
              discover: { state: "degraded", message: "no hosted sources" },
              search: { state: "degraded", message: "no hosted sources" },
            },
          };
        }
        return {
          state: "healthy",
          message: `doctor availableHosted=${hosted.join(",")}`,
          capabilities: {
            discover: { state: "healthy" },
            search: { state: "healthy" },
          },
        };
      } catch (error) {
        return {
          state: "unavailable",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async discover(ctx: DiscoverContext): Promise<NormalizedSource[]> {
      const query: ResearchQuery = { text: "trending", window: ctx.window, limit: ctx.limit };
      return this.search!(ctx, query);
    },

    async search(ctx: SearchContext, research: ResearchQuery): Promise<NormalizedSource[]> {
      const config = readConfig(ctx);
      const limit = research.limit ?? ctx.limit ?? config.defaultLimit;
      if (!deps.scriptPath) return [];
      const report = await doctor(deps, Math.min(15_000, Math.max(1, ctx.deadline.getTime() - Date.now())));
      const requested = config.sources?.length ? config.sources : LAST30DAYS_HOSTED_SOURCES;
      const allowed = requested.filter((name) => report.availableHosted.includes(name));
      if (allowed.length === 0) {
        throw JobFailure.permanent("last30days has no cookie-free hosted sources available");
      }
      const remainingMs = Math.max(1, ctx.deadline.getTime() - Date.now());
      const args = [
        research.text,
        "--emit=json",
        "--json-profile=agent",
        "--no-browser-cookies",
        "--quick",
        `--max-results=${limit}`,
        `--search=${allowed.join(",")}`,
      ];
      if (research.window?.asOf) args.push(`--as-of=${research.window.asOf}`);
      const result = await deps.runCommand(args, remainingMs);
      if (result.code !== 0) {
        throw JobFailure.transient(`last30days exited ${result.code}`);
      }
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        throw JobFailure.transient("last30days returned unparseable JSON");
      }
      return normalizeLast30DaysItems(parsed, now(), limit);
    },
  };

  return {
    id: LAST30DAYS_PROVIDER_ID,
    contractVersion: "1",
    version: LAST30DAYS_PROVIDER_VERSION,
    accessClass: "open",
    description: "External last30days CLI (cookie-free hosted sources only; doctor-gated)",
    backends: [backend],
    configSchema: last30daysProviderConfigSchema,
  };
}

export const last30daysProvider = createLast30DaysProvider();

export function last30daysConfigured(): boolean {
  return process.env.LAST30DAYS_ENABLED === "1" || Boolean(process.env.LAST30DAYS_SCRIPT?.trim());
}
