/**
 * Style analysis service (Phase 11) — job lifecycle mirroring `visualService.ts`
 * exactly: request -> claim (idempotent) -> run (worker) -> durable result.
 *
 * `references` (existing table) is the durable, owner-scoped authored-source
 * store. `style_analyses` (new) tracks one analysis *attempt*. `style_profiles`
 * (existing table, generalized in this phase) is the durable, versioned
 * *result* — read by Phase 10's `ContextStorageReader` exactly as before,
 * now carrying structured provenance instead of only a legacy prompt snippet.
 */

import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { references, styleAnalyses, styleProfiles } from "@shared/schema";
import type { Reference, StyleAnalysis, StyleProfile } from "@shared/schema";
import { JobFailure, describeError } from "../jobs/failures";
import {
  getStyleAnalyzer,
  normalizeAuthoredText,
  validateStyleObservation,
  InvalidAuthoredContentError,
  InvalidStyleObservationError,
  type AuthoredSourceType,
  type StyleObservation,
} from "./style";

export class StyleServiceInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid style request: ${issues.join("; ")}`);
    this.name = "StyleServiceInputError";
    this.issues = issues;
  }
}

export class ReferenceNotFoundError extends Error {
  constructor(readonly referenceId: number) {
    super(`Reference ${referenceId} not found`);
    this.name = "ReferenceNotFoundError";
  }
}

// ── storage boundary (self-contained, like Phase 10's ContextStorageReader) ──
export interface StyleStoragePort {
  /** The durable, owner-scoped authored-content row style analysis reads from. */
  insertReference(row: {
    userId: number;
    rawContent: string;
    sourceType: string;
    title: string | null;
  }): Promise<Reference>;
  /** Owner-checked at the SQL level — never a second app-layer-only check. */
  getOwnedReference(id: number, ownerId: number): Promise<Reference | undefined>;
  claimStyleAnalysis(row: {
    userId: number | null;
    referenceId: number;
    analyzerVersion: string;
    requestSnapshot: Record<string, unknown>;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<{ analysis: StyleAnalysis; created: boolean }>;
  getStyleAnalysis(id: number): Promise<StyleAnalysis | undefined>;
  markStyleAnalysisRunning(id: number): Promise<void>;
  markStyleAnalysisReady(id: number, attempt: number): Promise<void>;
  markStyleAnalysisFailed(id: number, failureClass: string, message: string, attempt: number): Promise<void>;
  /** The most recent READY observation for a reference, for version chaining. */
  getLatestStyleProfile(referenceId: number): Promise<StyleProfile | undefined>;
  /** The exact observation a given analysis attempt produced (idempotent re-run lookup). */
  getStyleProfileByAnalysisId(analysisId: number): Promise<StyleProfile | undefined>;
  insertStyleProfile(row: {
    userId: number | null;
    name: string;
    sourceReferenceId: number;
    analysisId: number;
    structuredObservation: Record<string, unknown>;
    stylePromptSnippet: string;
    confidence: string;
    analyzerVersion: string;
    sourceContentHash: string;
    supersedesId: number | null;
  }): Promise<StyleProfile>;
  getStyleProfile(id: number): Promise<StyleProfile | undefined>;
}

export function createDatabaseStyleStorage(db: NodePgDatabase<typeof schema>): StyleStoragePort {
  return {
    async insertReference(row) {
      const [inserted] = await db
        .insert(references)
        .values({ userId: row.userId, rawContent: row.rawContent, sourceType: row.sourceType, title: row.title })
        .returning();
      return inserted;
    },
    async getOwnedReference(id, ownerId) {
      const [row] = await db.select().from(references).where(and(eq(references.id, id), eq(references.userId, ownerId))).limit(1);
      return row;
    },
    async claimStyleAnalysis(row) {
      const inserted = await db
        .insert(styleAnalyses)
        .values({
          userId: row.userId,
          referenceId: row.referenceId,
          analyzerVersion: row.analyzerVersion,
          requestSnapshot: row.requestSnapshot,
          idempotencyKey: row.idempotencyKey,
          correlationId: row.correlationId,
          status: "requested",
        })
        .onConflictDoNothing({ target: styleAnalyses.idempotencyKey })
        .returning();
      if (inserted.length > 0) return { analysis: inserted[0], created: true };
      const [existing] = await db.select().from(styleAnalyses).where(eq(styleAnalyses.idempotencyKey, row.idempotencyKey)).limit(1);
      return { analysis: existing, created: false };
    },
    async getStyleAnalysis(id) {
      const [row] = await db.select().from(styleAnalyses).where(eq(styleAnalyses.id, id)).limit(1);
      return row;
    },
    async markStyleAnalysisRunning(id) {
      await db.update(styleAnalyses).set({ status: "analyzing", startedAt: new Date() }).where(eq(styleAnalyses.id, id));
    },
    async markStyleAnalysisReady(id, attempt) {
      await db.update(styleAnalyses).set({ status: "ready", finishedAt: new Date(), attempt }).where(eq(styleAnalyses.id, id));
    },
    async markStyleAnalysisFailed(id, failureClass, message, attempt) {
      await db
        .update(styleAnalyses)
        .set({ status: "failed", errorClass: failureClass, errorMessage: message, finishedAt: new Date(), attempt })
        .where(eq(styleAnalyses.id, id));
    },
    async getLatestStyleProfile(referenceId) {
      const [row] = await db
        .select()
        .from(styleProfiles)
        .where(eq(styleProfiles.sourceReferenceId, referenceId))
        .orderBy(desc(styleProfiles.id))
        .limit(1);
      return row;
    },
    async insertStyleProfile(row) {
      const [inserted] = await db
        .insert(styleProfiles)
        .values({
          userId: row.userId,
          name: row.name,
          sourceReferenceId: row.sourceReferenceId,
          analysisId: row.analysisId,
          structuredObservation: row.structuredObservation,
          stylePromptSnippet: row.stylePromptSnippet,
          confidence: row.confidence,
          analyzerVersion: row.analyzerVersion,
          sourceContentHash: row.sourceContentHash,
          supersedesId: row.supersedesId,
          isFavorite: false,
        })
        .returning();
      return inserted;
    },
    async getStyleProfile(id) {
      const [row] = await db.select().from(styleProfiles).where(eq(styleProfiles.id, id)).limit(1);
      return row;
    },
    async getStyleProfileByAnalysisId(analysisId) {
      const [row] = await db.select().from(styleProfiles).where(eq(styleProfiles.analysisId, analysisId)).limit(1);
      return row;
    },
  };
}

export interface StyleServiceDeps {
  storage: StyleStoragePort;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Deterministic snippet from a validated observation — bounded, never the raw model response. */
export function renderStylePromptSnippet(observation: StyleObservation): string {
  const d = observation.dimensions;
  return [
    `Tone: ${d.tone}`,
    `Sentence rhythm: ${d.sentenceRhythm}`,
    `Verbosity: ${d.verbosity}`,
    `Formatting: ${d.formattingTendencies}`,
    `Vocabulary: ${d.vocabularyRegister}`,
    d.hookPatterns.length ? `Hooks: ${d.hookPatterns.join(", ")}` : "",
    d.ctaPatterns.length ? `CTAs: ${d.ctaPatterns.join(", ")}` : "",
    d.recurringTraits.length ? `Recurring traits: ${d.recurringTraits.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

const ANALYZER_VERSION = "style-analyzer-v1";

export interface RequestStyleAnalysisInput {
  referenceId: number;
  analyzerId?: string;
  /** Explicit re-analysis (Ticket 11 §18) — never triggered by duplicate delivery. */
  regenerate?: boolean;
  regenerationNonce?: string;
}

/** `style:<referenceId>:<analyzerVersion>:<sourceContentHash>[:regen:<nonce>]` */
export function styleAnalysisIdempotencyKey(input: {
  referenceId: number;
  analyzerVersion: string;
  sourceContentHash: string;
  regenerationNonce?: string | null;
}): string {
  const base = `style:${input.referenceId}:${input.analyzerVersion}:${input.sourceContentHash.slice(0, 40)}`;
  return input.regenerationNonce ? `${base}:regen:${input.regenerationNonce}` : base;
}

/**
 * Request (or idempotently reuse) an analysis attempt against an
 * owner-checked, durable `references` row. Never touches an analyzer here —
 * that only happens in `runStyleAnalysis` (the worker).
 */
export async function requestStyleAnalysis(
  userId: number,
  input: RequestStyleAnalysisInput,
  deps: StyleServiceDeps,
): Promise<{ analysis: StyleAnalysis; created: boolean }> {
  const reference = await deps.storage.getOwnedReference(input.referenceId, userId);
  if (!reference) throw new ReferenceNotFoundError(input.referenceId);

  let normalized: string;
  try {
    normalized = normalizeAuthoredText(reference.rawContent ?? "");
  } catch (error) {
    if (error instanceof InvalidAuthoredContentError) {
      throw new StyleServiceInputError(error.issues);
    }
    throw error;
  }
  const sourceContentHash = sha256(normalized);

  const regenerationNonce = input.regenerate
    ? input.regenerationNonce ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    : null;
  const idempotencyKey = styleAnalysisIdempotencyKey({
    referenceId: input.referenceId,
    analyzerVersion: ANALYZER_VERSION,
    sourceContentHash,
    regenerationNonce,
  });

  return deps.storage.claimStyleAnalysis({
    userId,
    referenceId: input.referenceId,
    analyzerVersion: ANALYZER_VERSION,
    requestSnapshot: { sourceContentHash, analyzerId: input.analyzerId ?? "gateway-style" },
    idempotencyKey,
    correlationId: `${sourceContentHash.slice(0, 16)}-${Date.now().toString(36)}`,
  });
}

export interface StyleAnalysisRunResult {
  styleAnalysisId: number;
  status: "ready" | "failed";
  reused: boolean;
  styleProfileId?: number;
  failureClass?: string;
  failureMessage?: string;
}

function classifyStyleError(error: unknown): "transient" | "permanent" {
  if (error instanceof JobFailure) {
    return error.failureClass === "transient" || error.failureClass === "rate_limited" ? "transient" : "permanent";
  }
  const message = describeError(error);
  return /timeout|ECONN|ENOTFOUND|fetch failed|socket|\b5\d\d\b|429|rate.?limit/i.test(message) ? "transient" : "permanent";
}

/**
 * Execute a persisted analysis attempt (the `style.analyze` worker). Success
 * persists the observation THEN marks the attempt ready; duplicate delivery
 * of an already-ready attempt is a no-op (idempotent), never a re-analysis.
 */
export async function runStyleAnalysis(
  styleAnalysisId: number,
  deps: StyleServiceDeps,
): Promise<StyleAnalysisRunResult> {
  const analysis = await deps.storage.getStyleAnalysis(styleAnalysisId);
  if (!analysis) throw JobFailure.permanent(`StyleAnalysis ${styleAnalysisId} not found`);

  if (analysis.status === "ready") {
    const existing = await deps.storage.getStyleProfileByAnalysisId(analysis.id);
    return { styleAnalysisId: analysis.id, status: "ready", reused: true, styleProfileId: existing?.id };
  }

  await deps.storage.markStyleAnalysisRunning(analysis.id);

  try {
    const reference = await deps.storage.getOwnedReference(analysis.referenceId, analysis.userId ?? -1);
    if (!reference) throw JobFailure.permanent(`Reference ${analysis.referenceId} not found for its owner`);

    const normalized = normalizeAuthoredText(reference.rawContent ?? "");
    const sourceContentHash = sha256(normalized);
    const requestHash = (analysis.requestSnapshot as { sourceContentHash?: string } | null)?.sourceContentHash;
    if (requestHash && requestHash !== sourceContentHash) {
      // The source changed underneath an already-queued attempt. Fail this
      // attempt explicitly rather than silently analyzing different content
      // than what was requested — the caller can request a fresh analysis.
      throw JobFailure.permanent(
        `reference ${reference.id} content changed since this analysis was requested`,
      );
    }

    const analyzerId = (analysis.requestSnapshot as { analyzerId?: string } | null)?.analyzerId ?? "gateway-style";
    const analyzer = getStyleAnalyzer(analyzerId);

    const sourceType: AuthoredSourceType =
      reference.sourceType === "x_post" || reference.sourceType === "linkedin_post" ? reference.sourceType : "manual";

    const output = await analyzer.analyze({
      text: normalized,
      sourceType,
      correlationId: analysis.correlationId,
    });

    // Validate BEFORE anything durable — untrusted analyzer output.
    const observation = validateStyleObservation(output.observation);

    const prior = await deps.storage.getLatestStyleProfile(analysis.referenceId);
    const profile = await deps.storage.insertStyleProfile({
      userId: analysis.userId,
      name: `${reference.title ?? `reference ${reference.id}`} — style observation`,
      sourceReferenceId: analysis.referenceId,
      analysisId: analysis.id,
      structuredObservation: observation as unknown as Record<string, unknown>,
      stylePromptSnippet: renderStylePromptSnippet(observation),
      confidence: observation.confidence,
      analyzerVersion: analysis.analyzerVersion,
      sourceContentHash,
      supersedesId: prior?.id ?? null,
    });

    await deps.storage.markStyleAnalysisReady(analysis.id, analysis.attempt);

    return { styleAnalysisId: analysis.id, status: "ready", reused: false, styleProfileId: profile.id };
  } catch (error) {
    if (error instanceof InvalidAuthoredContentError || error instanceof InvalidStyleObservationError) {
      await deps.storage.markStyleAnalysisFailed(analysis.id, "permanent", error.message, analysis.attempt);
      return { styleAnalysisId: analysis.id, status: "failed", reused: false, failureClass: "permanent", failureMessage: error.message };
    }
    const failureClass = classifyStyleError(error);
    const message = describeError(error);
    await deps.storage.markStyleAnalysisFailed(analysis.id, failureClass, message, analysis.attempt);
    return { styleAnalysisId: analysis.id, status: "failed", reused: false, failureClass, failureMessage: message };
  }
}

export type { AuthoredSourceType, StyleObservation };
