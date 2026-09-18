/**
 * Style analysis service — Phase 11 job lifecycle, generalized in Phase 24
 * to freeze a selected reference set (one or many), emit evidence-backed
 * StyleObservations, and produce an immutable StyleProfile revision.
 *
 * Observed style never overwrites Voice / user_profile preferences.
 * Generation still consumes style ONLY through ContextAssembly.
 */

import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { references, styleAnalyses, styleObservations, styleProfiles } from "@shared/schema";
import type { Reference, StyleAnalysis, StyleObservationRow, StyleProfile } from "@shared/schema";
import { JobFailure, describeError } from "../jobs/failures";
import {
  coerceAuthoredSourceType,
  getStyleAnalyzer,
  normalizeAuthoredText,
  validateStyleObservation,
  InvalidAuthoredContentError,
  InvalidStyleObservationError,
  type AuthoredSourceType,
  type StyleObservation,
  type StyleConfidence,
} from "./style";
import {
  STYLE_ANALYSIS_VERSION,
  MAX_REFERENCES_PER_ANALYSIS,
  MIN_CHANNEL_OVERLAY,
  aggregateTextStatistics,
  capConfidence,
  channelFromSourceType,
  computeTextStatistics,
  deriveNegativeSignals,
  extractBoundedPhrases,
  renderStatisticsSnippet,
  sampleQuality,
  type TextStatistics,
} from "./styleStats";

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

export class StyleProfileNotFoundError extends Error {
  constructor(readonly styleProfileId: number) {
    super(`Style profile ${styleProfileId} not found`);
    this.name = "StyleProfileNotFoundError";
  }
}

export interface FrozenReference {
  id: number;
  contentHash: string;
  sourceType: string;
  sourcePlatform: string | null;
  title: string | null;
}

export interface StyleObservationInsert {
  userId: number | null;
  analysisId: number;
  styleProfileId: number;
  referenceId: number | null;
  category: string;
  observationKey: string;
  value: unknown;
  confidence: string;
  evidenceReferenceIds: number[];
  analysisVersion: string;
}

export interface StyleStoragePort {
  insertReference(row: {
    userId: number;
    rawContent: string;
    sourceType: string;
    title: string | null;
    sourceUrl?: string | null;
    sourcePlatform?: string | null;
    provenance?: string | null;
    isActive?: boolean;
  }): Promise<Reference>;
  getOwnedReference(id: number, ownerId: number): Promise<Reference | undefined>;
  getOwnedReferences(ids: number[], ownerId: number): Promise<Reference[]>;
  listOwnedReferences(ownerId: number): Promise<Reference[]>;
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
  getLatestStyleProfile(referenceId: number): Promise<StyleProfile | undefined>;
  getLatestCorpusProfile(ownerId: number, sourceContentHash: string): Promise<StyleProfile | undefined>;
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
    kind?: string;
    isActive?: boolean;
    channel?: string | null;
    sampleCount?: number;
    sampleChannels?: string[] | null;
    analysisVersion?: string | null;
    channelOverlays?: Record<string, unknown>;
  }): Promise<StyleProfile>;
  getStyleProfile(id: number): Promise<StyleProfile | undefined>;
  listStyleProfiles(ownerId: number): Promise<StyleProfile[]>;
  activateStyleProfile(id: number, ownerId: number): Promise<StyleProfile | undefined>;
  insertStyleObservations(rows: StyleObservationInsert[]): Promise<StyleObservationRow[]>;
  listStyleObservations(analysisId: number): Promise<StyleObservationRow[]>;
}

export function createDatabaseStyleStorage(db: NodePgDatabase<typeof schema>): StyleStoragePort {
  return {
    async insertReference(row) {
      const [inserted] = await db
        .insert(references)
        .values({
          userId: row.userId,
          rawContent: row.rawContent,
          sourceType: row.sourceType,
          title: row.title,
          sourceUrl: row.sourceUrl ?? null,
          sourcePlatform: row.sourcePlatform ?? null,
          provenance: row.provenance ?? "pasted_text",
          isActive: row.isActive ?? true,
          wordCount: row.rawContent.trim().split(/\s+/).filter(Boolean).length,
        })
        .returning();
      return inserted;
    },
    async getOwnedReference(id, ownerId) {
      const [row] = await db.select().from(references).where(and(eq(references.id, id), eq(references.userId, ownerId))).limit(1);
      return row;
    },
    async getOwnedReferences(ids, ownerId) {
      if (ids.length === 0) return [];
      return db
        .select()
        .from(references)
        .where(and(inArray(references.id, ids), eq(references.userId, ownerId)));
    },
    async listOwnedReferences(ownerId) {
      return db.select().from(references).where(eq(references.userId, ownerId)).orderBy(desc(references.id));
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
    async getLatestCorpusProfile(ownerId, sourceContentHash) {
      const [row] = await db
        .select()
        .from(styleProfiles)
        .where(
          and(
            eq(styleProfiles.userId, ownerId),
            eq(styleProfiles.kind, "corpus"),
            eq(styleProfiles.sourceContentHash, sourceContentHash),
          ),
        )
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
          isActive: row.isActive ?? false,
          kind: row.kind ?? "single",
          channel: row.channel ?? null,
          sampleCount: row.sampleCount ?? 1,
          sampleChannels: row.sampleChannels ?? [],
          analysisVersion: row.analysisVersion ?? STYLE_ANALYSIS_VERSION,
          channelOverlays: row.channelOverlays ?? {},
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
    async listStyleProfiles(ownerId) {
      return db.select().from(styleProfiles).where(eq(styleProfiles.userId, ownerId)).orderBy(desc(styleProfiles.id));
    },
    async activateStyleProfile(id, ownerId) {
      const [current] = await db
        .select()
        .from(styleProfiles)
        .where(and(eq(styleProfiles.id, id), eq(styleProfiles.userId, ownerId)))
        .limit(1);
      if (!current) return undefined;
      const channel = current.channel ?? null;
      await db
        .update(styleProfiles)
        .set({ isActive: false })
        .where(
          and(
            eq(styleProfiles.userId, ownerId),
            eq(styleProfiles.kind, current.kind),
            channel === null ? isNull(styleProfiles.channel) : eq(styleProfiles.channel, channel),
          ),
        );
      const [updated] = await db
        .update(styleProfiles)
        .set({ isActive: true })
        .where(and(eq(styleProfiles.id, id), eq(styleProfiles.userId, ownerId)))
        .returning();
      return updated;
    },
    async insertStyleObservations(rows) {
      if (rows.length === 0) return [];
      return db.insert(styleObservations).values(rows).returning();
    },
    async listStyleObservations(analysisId) {
      return db
        .select()
        .from(styleObservations)
        .where(eq(styleObservations.analysisId, analysisId))
        .orderBy(styleObservations.id);
    },
  };
}

export interface StyleServiceDeps {
  storage: StyleStoragePort;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function renderStylePromptSnippet(
  observation: StyleObservation,
  extras?: { stats?: TextStatistics; sampleLine?: string; negative?: string[] },
): string {
  const d = observation.dimensions;
  return [
    extras?.sampleLine ?? "",
    `Tone: ${d.tone}`,
    `Sentence rhythm: ${d.sentenceRhythm}`,
    `Verbosity: ${d.verbosity}`,
    `Formatting: ${d.formattingTendencies}`,
    `Vocabulary: ${d.vocabularyRegister}`,
    d.hookPatterns.length ? `Hooks: ${d.hookPatterns.join(", ")}` : "",
    d.ctaPatterns.length ? `CTAs: ${d.ctaPatterns.join(", ")}` : "",
    d.recurringTraits.length ? `Recurring traits: ${d.recurringTraits.join(", ")}` : "",
    extras?.negative?.length ? `Rarely: ${extras.negative.join("; ")}` : "",
    extras?.stats
      ? `Stats: avg sentence ${extras.stats.averageSentenceLength}; emoji/1k ${extras.stats.emojiFrequency}; questions/1k ${extras.stats.questionMarkFrequency}`
      : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

const ANALYZER_VERSION = "style-analyzer-v1";

export interface RequestStyleAnalysisInput {
  referenceId?: number;
  referenceIds?: number[];
  analyzerId?: string;
  /** Explicit re-analysis — never triggered by duplicate delivery. */
  regenerate?: boolean;
  regenerationNonce?: string;
}

export function styleAnalysisIdempotencyKey(input: {
  referenceId?: number;
  referenceIds?: number[];
  analyzerVersion: string;
  sourceContentHash: string;
  regenerationNonce?: string | null;
}): string {
  const ids = normalizeReferenceIds(input.referenceIds ?? (input.referenceId != null ? [input.referenceId] : []));
  const base =
    ids.length <= 1
      ? `style:${ids[0] ?? input.referenceId}:${input.analyzerVersion}:${input.sourceContentHash.slice(0, 40)}`
      : `style:corpus:${ids.join(",")}:${STYLE_ANALYSIS_VERSION}:${input.sourceContentHash.slice(0, 32)}`;
  return input.regenerationNonce ? `${base}:regen:${input.regenerationNonce}` : base;
}

function normalizeReferenceIds(ids: number[]): number[] {
  return Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0))).sort((a, b) => a - b);
}

function freezeReference(reference: Reference, normalized: string): FrozenReference {
  return {
    id: reference.id,
    contentHash: sha256(normalized),
    sourceType: reference.sourceType ?? "manual",
    sourcePlatform: reference.sourcePlatform ?? null,
    title: reference.title ?? null,
  };
}

/**
 * Request (or idempotently reuse) an analysis attempt against owner-checked,
 * explicitly selected references. The selected set is frozen on the analysis
 * row. Analyzer execution happens only in `runStyleAnalysis`.
 */
export async function requestStyleAnalysis(
  userId: number,
  input: RequestStyleAnalysisInput,
  deps: StyleServiceDeps,
): Promise<{ analysis: StyleAnalysis; created: boolean }> {
  const requestedIds = normalizeReferenceIds(
    input.referenceIds?.length ? input.referenceIds : input.referenceId != null ? [input.referenceId] : [],
  );
  if (requestedIds.length === 0) {
    throw new StyleServiceInputError(["at least one referenceId is required"]);
  }
  if (requestedIds.length > MAX_REFERENCES_PER_ANALYSIS) {
    throw new StyleServiceInputError([`at most ${MAX_REFERENCES_PER_ANALYSIS} references per analysis`]);
  }

  const owned = await deps.storage.getOwnedReferences(requestedIds, userId);
  if (owned.length !== requestedIds.length) {
    const found = new Set(owned.map((r) => r.id));
    const missing = requestedIds.find((id) => !found.has(id)) ?? requestedIds[0];
    throw new ReferenceNotFoundError(missing);
  }

  const frozen: FrozenReference[] = [];
  const hashes: string[] = [];
  for (const reference of owned.sort((a, b) => a.id - b.id)) {
    if (reference.isActive === false) {
      throw new StyleServiceInputError([`reference ${reference.id} is inactive`]);
    }
    let normalized: string;
    try {
      normalized = normalizeAuthoredText(reference.rawContent ?? "");
    } catch (error) {
      if (error instanceof InvalidAuthoredContentError) {
        throw new StyleServiceInputError([`reference ${reference.id}: ${error.issues.join("; ")}`]);
      }
      throw error;
    }
    const frozenRow = freezeReference(reference, normalized);
    frozen.push(frozenRow);
    hashes.push(frozenRow.contentHash);
  }

  const sourceContentHash = sha256(hashes.join("|"));
  const regenerationNonce = input.regenerate
    ? input.regenerationNonce ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    : null;
  const kind = frozen.length > 1 ? "corpus" : "single";
  const idempotencyKey = styleAnalysisIdempotencyKey({
    referenceId: frozen[0].id,
    referenceIds: frozen.map((r) => r.id),
    analyzerVersion: ANALYZER_VERSION,
    sourceContentHash,
    regenerationNonce,
  });

  return deps.storage.claimStyleAnalysis({
    userId,
    referenceId: frozen[0].id,
    analyzerVersion: ANALYZER_VERSION,
    requestSnapshot: {
      sourceContentHash,
      analyzerId: input.analyzerId ?? "gateway-style",
      analysisVersion: STYLE_ANALYSIS_VERSION,
      kind,
      frozenReferences: frozen,
    },
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

interface SnapshotShape {
  sourceContentHash?: string;
  analyzerId?: string;
  analysisVersion?: string;
  kind?: string;
  frozenReferences?: FrozenReference[];
}

function observationRowsFromRun(input: {
  userId: number | null;
  analysisId: number;
  styleProfileId: number;
  stats: TextStatistics;
  observation: StyleObservation;
  phrases: ReturnType<typeof extractBoundedPhrases>;
  negatives: ReturnType<typeof deriveNegativeSignals>;
  evidenceIds: number[];
  analysisVersion: string;
}): StyleObservationInsert[] {
  const { userId, analysisId, styleProfileId, stats, observation, phrases, negatives, evidenceIds, analysisVersion } = input;
  const rows: StyleObservationInsert[] = [
    obs(userId, analysisId, styleProfileId, "sentence_structure", "average_sentence_length", stats.averageSentenceLength, observation.confidence, evidenceIds, analysisVersion),
    obs(userId, analysisId, styleProfileId, "sentence_structure", "short_sentence_frequency", stats.shortSentenceFrequency, observation.confidence, evidenceIds, analysisVersion),
    obs(userId, analysisId, styleProfileId, "sentence_structure", "long_sentence_frequency", stats.longSentenceFrequency, observation.confidence, evidenceIds, analysisVersion),
    obs(userId, analysisId, styleProfileId, "paragraph_formatting", "average_paragraph_length", stats.averageParagraphLength, observation.confidence, evidenceIds, analysisVersion),
    obs(userId, analysisId, styleProfileId, "punctuation", "question_mark_frequency", stats.questionMarkFrequency, observation.confidence, evidenceIds, analysisVersion),
    obs(userId, analysisId, styleProfileId, "emoji_symbols", "emoji_frequency", stats.emojiFrequency, observation.confidence, evidenceIds, analysisVersion),
    obs(userId, analysisId, styleProfileId, "tone", "tone", observation.dimensions.tone, observation.confidence, evidenceIds, analysisVersion),
    obs(userId, analysisId, styleProfileId, "hooks_openings", "hook_patterns", observation.dimensions.hookPatterns, observation.confidence, evidenceIds, analysisVersion),
    obs(userId, analysisId, styleProfileId, "closings", "cta_patterns", observation.dimensions.ctaPatterns, observation.confidence, evidenceIds, analysisVersion),
  ];
  if (phrases.recurring.length) {
    rows.push(obs(userId, analysisId, styleProfileId, "vocabulary", "recurring_phrases", phrases.recurring, observation.confidence, evidenceIds, analysisVersion));
  }
  if (phrases.openings.length) {
    rows.push(obs(userId, analysisId, styleProfileId, "hooks_openings", "opening_patterns", phrases.openings, observation.confidence, evidenceIds, analysisVersion));
  }
  if (phrases.closings.length) {
    rows.push(obs(userId, analysisId, styleProfileId, "closings", "closing_patterns", phrases.closings, observation.confidence, evidenceIds, analysisVersion));
  }
  for (const signal of negatives) {
    rows.push(obs(userId, analysisId, styleProfileId, "negative_signals", signal.key, signal.value, signal.confidence, evidenceIds, analysisVersion));
  }
  return rows;
}

function obs(
  userId: number | null,
  analysisId: number,
  styleProfileId: number,
  category: string,
  observationKey: string,
  value: unknown,
  confidence: string,
  evidenceReferenceIds: number[],
  analysisVersion: string,
): StyleObservationInsert {
  return {
    userId,
    analysisId,
    styleProfileId,
    referenceId: evidenceReferenceIds.length === 1 ? evidenceReferenceIds[0] : null,
    category,
    observationKey,
    value,
    confidence,
    evidenceReferenceIds,
    analysisVersion,
  };
}

function buildChannelOverlays(
  refs: Array<{ id: number; sourceType: string | null; sourcePlatform: string | null; text: string }>,
  statsByChannel: Map<string, TextStatistics[]>,
): Record<string, { snippet: string; sampleCount: number }> {
  const overlays: Record<string, { snippet: string; sampleCount: number }> = {};
  for (const [channel, samples] of Array.from(statsByChannel.entries())) {
    if (channel === "other") continue;
    if (samples.length < MIN_CHANNEL_OVERLAY) continue;
    const aggregated = aggregateTextStatistics(samples);
    overlays[channel] = {
      sampleCount: samples.length,
      snippet: `avg sentence ${aggregated.averageSentenceLength}; questions/1k ${aggregated.questionMarkFrequency}; emoji/1k ${aggregated.emojiFrequency}`,
    };
  }
  void refs;
  return overlays;
}

/**
 * Execute a persisted analysis attempt. Success persists observations THEN
 * the profile THEN marks ready. Duplicate delivery of a ready attempt is a
 * no-op. Invalid model JSON never becomes a StyleObservation.
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
    const snapshot = (analysis.requestSnapshot ?? {}) as SnapshotShape;
    const frozen = snapshot.frozenReferences?.length
      ? snapshot.frozenReferences
      : [{ id: analysis.referenceId, contentHash: snapshot.sourceContentHash ?? "", sourceType: "manual", sourcePlatform: null, title: null }];
    const ownerId = analysis.userId ?? -1;
    const owned = await deps.storage.getOwnedReferences(frozen.map((f) => f.id), ownerId);
    if (owned.length !== frozen.length) {
      throw JobFailure.permanent("one or more frozen references are missing for their owner");
    }
    const byId = new Map(owned.map((r) => [r.id, r]));

    const normalizedTexts: string[] = [];
    const perRefStats: TextStatistics[] = [];
    const statsByChannel = new Map<string, TextStatistics[]>();
    const evidenceIds: number[] = [];

    for (const item of frozen) {
      const reference = byId.get(item.id);
      if (!reference) throw JobFailure.permanent(`Reference ${item.id} not found for its owner`);
      const normalized = normalizeAuthoredText(reference.rawContent ?? "");
      const contentHash = sha256(normalized);
      if (item.contentHash && item.contentHash !== contentHash) {
        throw JobFailure.permanent(`reference ${reference.id} content changed since this analysis was requested`);
      }
      normalizedTexts.push(normalized);
      const stats = computeTextStatistics(normalized);
      perRefStats.push(stats);
      evidenceIds.push(reference.id);
      const channel = channelFromSourceType(reference.sourceType, reference.sourcePlatform);
      const bucket = statsByChannel.get(channel) ?? [];
      bucket.push(stats);
      statsByChannel.set(channel, bucket);
    }

    const combinedHash = sha256(frozen.map((f) => f.contentHash || sha256(byId.get(f.id)?.rawContent ?? "")).join("|"));
    if (snapshot.sourceContentHash && snapshot.sourceContentHash !== combinedHash && frozen.length === 1) {
      const only = sha256(normalizedTexts[0]);
      if (snapshot.sourceContentHash !== only) {
        throw JobFailure.permanent(`reference ${frozen[0].id} content changed since this analysis was requested`);
      }
    }

    const analyzerId = snapshot.analyzerId ?? "gateway-style";
    const analyzer = getStyleAnalyzer(analyzerId);
    const sourceType: AuthoredSourceType = coerceAuthoredSourceType(frozen[0]?.sourceType);
    const joined = normalizedTexts.join("\n\n---\n\n").slice(0, 10_000);
    const output = await analyzer.analyze({
      text: joined,
      sourceType,
      correlationId: analysis.correlationId,
    });

    const rawObservation = validateStyleObservation(output.observation);
    const aggregated = aggregateTextStatistics(perRefStats);
    const quality = sampleQuality({
      referenceCount: frozen.length,
      channels: Array.from(statsByChannel.keys()),
    });
    const confidence = capConfidence(rawObservation.confidence as StyleConfidence, frozen.length);
    const observation: StyleObservation = {
      ...rawObservation,
      confidence,
      confidenceReason:
        frozen.length < 8
          ? `${rawObservation.confidenceReason} (sample ${frozen.length}; ceiling ${quality.confidenceCeiling})`
          : rawObservation.confidenceReason,
    };
    const phrases = extractBoundedPhrases(normalizedTexts);
    const negatives = deriveNegativeSignals(aggregated, frozen.length);
    const overlays = buildChannelOverlays(
      owned.map((r) => ({ id: r.id, sourceType: r.sourceType, sourcePlatform: r.sourcePlatform, text: r.rawContent ?? "" })),
      statsByChannel,
    );
    const kind = frozen.length > 1 ? "corpus" : snapshot.kind ?? "single";
    const sampleLine = renderStatisticsSnippet(aggregated, quality);
    const snippet = renderStylePromptSnippet(observation, {
      stats: aggregated,
      sampleLine,
      negative: negatives.map((n) => n.value),
    });

    const prior =
      kind === "corpus"
        ? await deps.storage.getLatestCorpusProfile(ownerId, combinedHash)
        : await deps.storage.getLatestStyleProfile(analysis.referenceId);

    const structuredObservation: Record<string, unknown> = {
      ...observation,
      statistics: aggregated,
      sample: quality,
      phrases,
      negativeSignals: negatives,
      provenanceReferenceIds: evidenceIds,
      channelOverlays: overlays,
    };

    const first = byId.get(frozen[0].id)!;
    const profile = await deps.storage.insertStyleProfile({
      userId: analysis.userId,
      name:
        kind === "corpus"
          ? `corpus style (${frozen.length} refs)`
          : `${first.title ?? `reference ${first.id}`} — style observation`,
      sourceReferenceId: analysis.referenceId,
      analysisId: analysis.id,
      structuredObservation,
      stylePromptSnippet: snippet,
      confidence: observation.confidence,
      analyzerVersion: analysis.analyzerVersion,
      sourceContentHash: combinedHash,
      supersedesId: prior?.id ?? null,
      kind,
      isActive: false,
      sampleCount: frozen.length,
      sampleChannels: quality.channels,
      analysisVersion: STYLE_ANALYSIS_VERSION,
      channelOverlays: overlays,
    });

    await deps.storage.insertStyleObservations(
      observationRowsFromRun({
        userId: analysis.userId,
        analysisId: analysis.id,
        styleProfileId: profile.id,
        stats: aggregated,
        observation,
        phrases,
        negatives,
        evidenceIds,
        analysisVersion: STYLE_ANALYSIS_VERSION,
      }),
    );

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

export async function activateStyleProfile(
  userId: number,
  styleProfileId: number,
  deps: StyleServiceDeps,
): Promise<StyleProfile> {
  const updated = await deps.storage.activateStyleProfile(styleProfileId, userId);
  if (!updated) throw new StyleProfileNotFoundError(styleProfileId);
  return updated;
}

export function publicReference(row: Reference) {
  const text = row.rawContent ?? "";
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourcePlatform: row.sourcePlatform,
    sourceUrl: row.sourceUrl,
    title: row.title,
    isActive: row.isActive ?? true,
    provenance: row.provenance,
    wordCount: row.wordCount,
    createdAt: row.createdAt,
    preview: text.length > 240 ? `${text.slice(0, 240)}…` : text,
  };
}

export function publicStyleProfile(row: StyleProfile) {
  return {
    id: row.id,
    name: row.name,
    sourceReferenceId: row.sourceReferenceId,
    analysisId: row.analysisId,
    confidence: row.confidence,
    analyzerVersion: row.analyzerVersion,
    analysisVersion: row.analysisVersion,
    structuredObservation: row.structuredObservation,
    supersedesId: row.supersedesId,
    kind: row.kind,
    isActive: row.isActive,
    channel: row.channel,
    sampleCount: row.sampleCount,
    sampleChannels: row.sampleChannels,
    channelOverlays: row.channelOverlays,
    stylePromptSnippet: row.stylePromptSnippet,
    createdAt: row.createdAt,
  };
}

export type { AuthoredSourceType, StyleObservation };
