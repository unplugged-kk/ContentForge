/**
 * ContentForgeState — the normalized, bounded state handed to Jev.
 *
 * Two jobs, both deliberate:
 *   1. **Bound.** Every string is clipped and every array capped, so a decision
 *      can never ship a huge blob (or a secret) to a model.
 *   2. **Whitelist.** Only known keys survive. A caller cannot accidentally
 *      forward an arbitrary object (a request body, a DB row) into the state.
 *
 * It reuses existing shapes rather than introducing parallel ones — evidence
 * mirrors `research_evidence`, platform mirrors `formatProfiles`, performance
 * mirrors `performance_signals` aggregates.
 */

import type { HardConstraints } from "./validator";
import { canonicalJson, sha256 } from "../utils/hash";

export const STATE_BOUNDS = {
  maxStringChars: 2000,
  maxShortChars: 500,
  maxEvidence: 5,
  maxEvidenceExcerptChars: 400,
  maxCandidates: 200,
  maxCandidateTitleChars: 200,
  maxHistory: 20,
  maxAngles: 10,
  maxDomains: 20,
  maxAudiences: 6,
  maxGoals: 6,
  maxTargets: 20,
  maxFlags: 20,
  maxHashInputChars: 60_000,
} as const;

export interface StateEvidence {
  id?: number;
  kind?: string;
  excerpt: string;
}

export interface StateCandidate {
  id?: string;
  title: string;
  summary?: string;
  url?: string;
  source?: string;
}

export interface ContentForgeState {
  topic?: { title?: string; query?: string; angles?: string[] };
  research?: { jobId?: number; sourceCount?: number; evidence?: StateEvidence[] };
  candidates?: StateCandidate[];
  /** `options` are the bounded audience candidates a strategy choice may pick from. */
  audience?: { primary?: string; description?: string; options?: string[] };
  /**
   * The allowed format × channel pairs a format decision may narrow. Bounded and
   * whitelisted like everything else: a decision can only ever select from these.
   */
  targets?: Array<{ channel: string; format: string }>;
  reach?: Record<string, number>;
  expertise?: { domains?: string[]; goals?: string[]; alignment?: number; confidence?: string };
  contentHistory?: Array<{ title?: string; format?: string; channel?: string }>;
  performance?: {
    byChannel?: Record<string, number>;
    byFormat?: Record<string, number>;
    sampleSize?: number;
  };
  quality?: { signals?: Record<string, number>; flags?: string[] };
  platform?: {
    channel?: string;
    format?: string;
    maxCharacters?: number;
    sequential?: boolean;
    hookFirst?: boolean;
    cta?: boolean;
  };
  constraints?: HardConstraints;
  requestedDepth?: "quick" | "standard" | "deep";
}

// ── primitives ───────────────────────────────────────────────────────────────
function str(value: unknown, max: number = STATE_BOUNDS.maxStringChars): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function strArray(
  value: unknown,
  maxItems: number,
  maxChars: number = STATE_BOUNDS.maxShortChars,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value.slice(0, maxItems)) {
    const s = str(item, maxChars);
    if (s !== undefined) out.push(s);
  }
  return out.length > 0 ? out : undefined;
}

function numRecord(value: unknown, maxKeys: number = 50): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, maxKeys)) {
    const n = num(raw);
    if (n !== undefined) out[key.slice(0, STATE_BOUNDS.maxShortChars)] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function record<T>(
  value: unknown,
  build: (input: Record<string, unknown>) => T,
): T | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const built = build(value as Record<string, unknown>);
  return built && Object.keys(built as object).length > 0 ? built : undefined;
}

const DEPTHS = new Set(["quick", "standard", "deep"]);

// ── normalization ────────────────────────────────────────────────────────────
/** Bounded, whitelisted normalization of a caller-supplied state. */
export function normalizeState(input: unknown): ContentForgeState {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const state: ContentForgeState = {};

  const topic = record(raw.topic, (t) => ({
    title: str(t.title),
    query: str(t.query),
    angles: strArray(t.angles, STATE_BOUNDS.maxAngles),
  }));
  if (topic) state.topic = topic;

  const research = record(raw.research, (r) => {
    const evidence: StateEvidence[] = [];
    if (Array.isArray(r.evidence)) {
      for (const item of r.evidence.slice(0, STATE_BOUNDS.maxEvidence)) {
        const e = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        const excerpt = str(e.excerpt, STATE_BOUNDS.maxEvidenceExcerptChars);
        if (excerpt === undefined) continue;
        evidence.push({
          id: num(e.id) !== undefined ? Math.trunc(num(e.id)!) : undefined,
          kind: str(e.kind, STATE_BOUNDS.maxShortChars),
          excerpt,
        });
      }
    }
    return {
      jobId: num(r.jobId) !== undefined ? Math.trunc(num(r.jobId)!) : undefined,
      sourceCount: num(r.sourceCount) !== undefined ? Math.trunc(num(r.sourceCount)!) : undefined,
      evidence,
    };
  });
  if (research) state.research = research;

  const candidates: StateCandidate[] = [];
  if (Array.isArray(raw.candidates)) {
    for (const item of raw.candidates.slice(0, STATE_BOUNDS.maxCandidates)) {
      const c = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const title = str(c.title, STATE_BOUNDS.maxCandidateTitleChars);
      if (title === undefined) continue;
      candidates.push({
        id: str(c.id, STATE_BOUNDS.maxShortChars),
        title,
        summary: str(c.summary, STATE_BOUNDS.maxShortChars),
        url: str(c.url, STATE_BOUNDS.maxShortChars),
        source: str(c.source, STATE_BOUNDS.maxShortChars),
      });
    }
  }
  if (candidates.length > 0) state.candidates = candidates;

  const audience = record(raw.audience, (a) => ({
    primary: str(a.primary, STATE_BOUNDS.maxShortChars),
    description: str(a.description),
    options: strArray(a.options, STATE_BOUNDS.maxAudiences),
  }));
  if (audience) state.audience = audience;

  const targets: Array<{ channel: string; format: string }> = [];
  if (Array.isArray(raw.targets)) {
    for (const item of raw.targets.slice(0, STATE_BOUNDS.maxTargets)) {
      const t = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const channel = str(t.channel, STATE_BOUNDS.maxShortChars);
      const format = str(t.format, STATE_BOUNDS.maxShortChars);
      if (channel === undefined || format === undefined) continue;
      targets.push({ channel, format });
    }
  }
  if (targets.length > 0) state.targets = targets;

  const reach = numRecord(raw.reach);
  if (reach) state.reach = reach;

  const expertise = record(raw.expertise, (e) => ({
    domains: strArray(e.domains, STATE_BOUNDS.maxDomains),
    goals: strArray(e.goals, STATE_BOUNDS.maxGoals),
    alignment: num(e.alignment),
    confidence: str(e.confidence, STATE_BOUNDS.maxShortChars),
  }));
  if (expertise) state.expertise = expertise;

  const history: Array<{ title?: string; format?: string; channel?: string }> = [];
  if (Array.isArray(raw.contentHistory)) {
    for (const item of raw.contentHistory.slice(0, STATE_BOUNDS.maxHistory)) {
      const h = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      history.push({
        title: str(h.title, STATE_BOUNDS.maxShortChars),
        format: str(h.format, STATE_BOUNDS.maxShortChars),
        channel: str(h.channel, STATE_BOUNDS.maxShortChars),
      });
    }
  }
  if (history.length > 0) state.contentHistory = history;

  const performance = record(raw.performance, (p) => ({
    byChannel: numRecord(p.byChannel),
    byFormat: numRecord(p.byFormat),
    sampleSize: num(p.sampleSize),
  }));
  if (performance) state.performance = performance;

  const quality = record(raw.quality, (q) => ({
    signals: numRecord(q.signals),
    flags: strArray(q.flags, STATE_BOUNDS.maxFlags),
  }));
  if (quality) state.quality = quality;

  const platform = record(raw.platform, (p) => ({
    channel: str(p.channel, STATE_BOUNDS.maxShortChars),
    format: str(p.format, STATE_BOUNDS.maxShortChars),
    maxCharacters: num(p.maxCharacters) !== undefined ? Math.trunc(num(p.maxCharacters)!) : undefined,
    sequential: bool(p.sequential),
    hookFirst: bool(p.hookFirst),
    cta: bool(p.cta),
  }));
  if (platform) state.platform = platform;

  const constraints = record(raw.constraints, (c) => ({
    artifactApproved: bool(c.artifactApproved),
    providerCalled: bool(c.providerCalled),
    retryRequested: bool(c.retryRequested),
    accessClassAllowed: bool(c.accessClassAllowed),
    payloadWithinCaps: bool(c.payloadWithinCaps),
    ownershipOk: bool(c.ownershipOk),
    leaseHeld: bool(c.leaseHeld),
    rateBudgetRemaining: num(c.rateBudgetRemaining),
    budgetRemaining: num(c.budgetRemaining),
  }));
  if (constraints) state.constraints = constraints;

  const depth = str(raw.requestedDepth, STATE_BOUNDS.maxShortChars);
  if (depth !== undefined && DEPTHS.has(depth)) {
    state.requestedDepth = depth as ContentForgeState["requestedDepth"];
  }

  return state;
}

// ── hashing ──────────────────────────────────────────────────────────────────
export function hashState(state: ContentForgeState): string {
  const canonical = canonicalJson(state).slice(0, STATE_BOUNDS.maxHashInputChars);
  return sha256(canonical);
}
