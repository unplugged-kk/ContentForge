/**
 * Persistence for the core content lifecycle.
 *
 * ResearchJob → Story → Opportunity → GenerationJob → Artifact → Schedule
 * (series + occurrences) → Publication → Result. One storage layer because the
 * entities form one chain and share the same durability rules; the domain
 * *decisions* live in the per-boundary service files, not here.
 *
 * Behind an interface so services are testable without a database.
 */

import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import {
  artifacts,
  contentTemplates,
  generationJobs,
  generationPolicies,
  opportunities,
  publications,
  results,
  scheduleOccurrences,
  schedules,
  visualAssetRefs,
  visualAssets,
  visualGenerations,
  voices,
  type Artifact,
  type ArtifactReadiness,
  type ContentTemplate,
  type GenerationJob,
  type GenerationPolicy,
  type Opportunity,
  type OpportunityStatus,
  type Publication,
  type PublicationState,
  type Result,
  type Schedule,
  type ScheduleOccurrence,
  type VisualAsset,
  type VisualAssetRef,
  type VisualGeneration,
  type VisualGenerationStatus,
  type Voice,
} from "@shared/schema";
import { db as defaultDb } from "../db";

export type ContentDatabase = NodePgDatabase<typeof schema>;

export type JsonRecord = Record<string, unknown>;

// ── Opportunity ───────────────────────────────────────────────────────────────
export interface InsertOpportunityRow {
  userId?: number | null;
  storyId: number;
  concept: string;
  objective: string;
  audience: string | null;
  angle: string | null;
  format: string;
  channel: string;
  status: OpportunityStatus;
  score: string | null;
  scoreBreakdown: JsonRecord;
  proposer: string;
  /** Durable idempotency for chat-to-post (NULL for non-chat opportunities). */
  chatKey?: string | null;
}

// ── GenerationJob ─────────────────────────────────────────────────────────────
export interface InsertGenerationJobRow {
  userId?: number | null;
  opportunityId: number;
  format: string;
  channel: string;
  policySnapshot: JsonRecord;
  /** The exact immutable policy revision this attempt was built from. */
  policyId?: number | null;
  idempotencyKey: string;
  correlationId: string;
  priorArtifactId: number | null;
  rejectionReason: string | null;
}

export interface ClaimGenerationJobResult {
  job: GenerationJob;
  created: boolean;
}

// ── Artifact ──────────────────────────────────────────────────────────────────
export interface InsertArtifactRow {
  userId?: number | null;
  generationJobId: number | null;
  opportunityId: number;
  format: string;
  channel: string;
  payload: JsonRecord;
  readiness: ArtifactReadiness;
  supersedesId: number | null;
  provenance: string;
  attribution: unknown[];
  attributionReason: string | null;
}

// ── Schedule / Occurrence ─────────────────────────────────────────────────────
export interface InsertScheduleRow {
  userId?: number | null;
  artifactId: number;
  channel: string;
  recurrence: string | null;
  timezone: string;
  count: number;
  startAt: Date;
}

// ── Publication ───────────────────────────────────────────────────────────────
export interface InsertPublicationRow {
  userId?: number | null;
  scheduleId: number;
  occurrenceId: number;
  artifactId: number;
  channel: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface ClaimPublicationResult {
  publication: Publication;
  created: boolean;
}

// ── Result ────────────────────────────────────────────────────────────────────
export interface InsertResultRow {
  userId?: number | null;
  publicationId: number;
  outcome: string;
  externalId: string | null;
  externalUrl: string | null;
  publishedAt: Date | null;
  metrics: JsonRecord;
  source: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  correlationId: string | null;
}

// ── creation intelligence: voices / templates / policies ─────────────────────
export interface InsertVoiceRow {
  userId?: number | null;
  voiceKey?: string | null;
  version?: number;
  name: string;
  description?: string | null;
  tone?: string | null;
  vocabulary?: string[];
  sentenceStyle?: string | null;
  formatting?: JsonRecord;
  doRules?: string[];
  dontRules?: string[];
  examples?: unknown[];
}

export interface InsertTemplateRow {
  userId?: number | null;
  templateKey?: string | null;
  version?: number;
  name: string;
  description?: string | null;
  supportedFormats?: string[];
  supportedChannels?: string[];
  structure?: unknown[];
  variables?: unknown[];
  constraints?: JsonRecord;
  instructions?: string | null;
}

export interface InsertPolicyRow {
  userId?: number | null;
  policyKey: string;
  version: number;
  name: string | null;
  format: string;
  channel: string;
  voiceId: number | null;
  templateId: number | null;
  objective: string | null;
  audience: string | null;
  constraints: JsonRecord;
  modelPreferences: JsonRecord;
  specHash: string;
}

// ── visual generations / assets / refs ───────────────────────────────────────
export interface InsertVisualGenerationRow {
  userId?: number | null;
  intent: JsonRecord;
  kind: string;
  providerId?: string | null;
  capability?: string | null;
  providerVersion?: string | null;
  requestSnapshot?: JsonRecord;
  idempotencyKey: string;
  generationJobId?: number | null;
  opportunityId?: number | null;
  correlationId: string;
}

export interface ClaimVisualGenerationResult {
  generation: VisualGeneration;
  created: boolean;
}

export interface InsertVisualAssetRow {
  userId?: number | null;
  visualGenerationId?: number | null;
  kind: string;
  storageKey: string;
  mime: string;
  width?: number | null;
  height?: number | null;
  byteSize?: number | null;
  contentHash?: string | null;
  altText?: string | null;
  caption?: string | null;
  role?: string | null;
  metadata?: JsonRecord;
  supersedesId?: number | null;
  provenance?: string;
}

export interface InsertVisualAssetRefRow {
  userId?: number | null;
  artifactId: number;
  visualAssetId: number;
  role?: string | null;
  position?: number;
}

export interface ContentStoragePort {
  // ── visual generations / assets / refs ──────────────────────────────────────
  claimVisualGeneration(row: InsertVisualGenerationRow): Promise<ClaimVisualGenerationResult>;
  getVisualGeneration(id: number): Promise<VisualGeneration | undefined>;
  getVisualGenerationByIdempotencyKey(key: string): Promise<VisualGeneration | undefined>;
  listVisualGenerationsByOpportunity(opportunityId: number): Promise<VisualGeneration[]>;
  markVisualGenerationRunning(id: number): Promise<void>;
  markVisualGenerationReady(
    id: number,
    meta: { model: string | null; cost: string | null; attempt: number },
  ): Promise<void>;
  markVisualGenerationFailed(
    id: number,
    failureClass: string,
    message: string,
    attempt: number,
  ): Promise<void>;

  insertVisualAsset(row: InsertVisualAssetRow): Promise<VisualAsset>;
  getVisualAsset(id: number): Promise<VisualAsset | undefined>;
  getLatestVisualAssetForGeneration(visualGenerationId: number): Promise<VisualAsset | undefined>;
  listVisualAssets(userId: number, limit: number): Promise<VisualAsset[]>;

  insertVisualAssetRef(row: InsertVisualAssetRefRow): Promise<VisualAssetRef>;
  listVisualAssetRefs(artifactId: number): Promise<VisualAssetRef[]>;

  // ── creation intelligence (voices / templates / policies) ──────────────────
  insertVoice(row: InsertVoiceRow): Promise<Voice>;
  getVoice(id: number): Promise<Voice | undefined>;
  listVoices(): Promise<Voice[]>;
  listVoicesByKey(voiceKey: string): Promise<Voice[]>;
  nextVoiceVersion(voiceKey: string): Promise<number>;
  setVoiceStatus(id: number, status: string): Promise<Voice | undefined>;

  insertContentTemplate(row: InsertTemplateRow): Promise<ContentTemplate>;
  getContentTemplate(id: number): Promise<ContentTemplate | undefined>;
  listContentTemplates(): Promise<ContentTemplate[]>;
  listContentTemplatesByKey(templateKey: string): Promise<ContentTemplate[]>;
  nextTemplateVersion(templateKey: string): Promise<number>;
  setContentTemplateStatus(id: number, status: string): Promise<ContentTemplate | undefined>;

  findOrCreateGenerationPolicy(row: InsertPolicyRow): Promise<{ policy: GenerationPolicy; created: boolean }>;
  getGenerationPolicy(id: number): Promise<GenerationPolicy | undefined>;
  /** Indexed lookup by the content-addressed spec identity (no table scan). */
  getGenerationPolicyBySpecHash(specHash: string): Promise<GenerationPolicy | undefined>;
  listGenerationPolicies(): Promise<GenerationPolicy[]>;
  nextPolicyVersion(policyKey: string): Promise<number>;

  insertOpportunity(row: InsertOpportunityRow): Promise<Opportunity>;
  getOpportunity(id: number): Promise<Opportunity | undefined>;
  /** Durable chat idempotency lookup. */
  getOpportunityByChatKey(chatKey: string): Promise<Opportunity | undefined>;
  listOpportunitiesByStory(storyId: number): Promise<Opportunity[]>;
  updateOpportunityStatus(
    id: number,
    status: OpportunityStatus,
    killReason: string | null,
  ): Promise<Opportunity | undefined>;

  claimGenerationJob(row: InsertGenerationJobRow): Promise<ClaimGenerationJobResult>;
  getGenerationJob(id: number): Promise<GenerationJob | undefined>;
  /** Most recent attempt for an Opportunity (chat idempotency reporting). */
  getLatestGenerationJobForOpportunity(opportunityId: number): Promise<GenerationJob | undefined>;
  markGenerationRunning(id: number): Promise<void>;
  markGenerationSucceeded(
    id: number,
    meta: { model: string | null; provider: string | null; cost: string | null; attempt: number },
  ): Promise<void>;
  markGenerationFailed(
    id: number,
    failureClass: string,
    message: string,
    attempt: number,
  ): Promise<void>;

  insertArtifact(row: InsertArtifactRow): Promise<Artifact>;
  getArtifact(id: number): Promise<Artifact | undefined>;
  getArtifactByGenerationJob(generationJobId: number): Promise<Artifact | undefined>;
  listArtifactsByOpportunity(opportunityId: number): Promise<Artifact[]>;
  setArtifactReadiness(
    id: number,
    readiness: ArtifactReadiness,
    approvedAt: Date | null,
  ): Promise<Artifact | undefined>;
  listArtifactsByOpportunityAndReadiness(
    opportunityId: number,
    readiness: ArtifactReadiness,
  ): Promise<Artifact[]>;

  insertSchedule(row: InsertScheduleRow): Promise<Schedule>;
  getSchedule(id: number): Promise<Schedule | undefined>;
  listSchedulesByArtifact(artifactId: number): Promise<Schedule[]>;
  listActiveSchedules(now: Date, limit: number): Promise<Schedule[]>;
  setScheduleStatus(id: number, status: string): Promise<void>;

  materializeOccurrence(scheduleId: number, at: Date): Promise<ScheduleOccurrence | undefined>;
  getOccurrence(id: number): Promise<ScheduleOccurrence | undefined>;
  getOccurrenceByScheduleTime(scheduleId: number, at: Date): Promise<ScheduleOccurrence | undefined>;
  listDueOccurrences(now: Date, limit: number): Promise<ScheduleOccurrence[]>;
  /** Durable recurrence cursor: how many occurrences a series has already materialized. */
  countOccurrences(scheduleId: number): Promise<number>;
  markOccurrenceStatus(id: number, status: string): Promise<void>;
  /** Conditional transition (compare-and-set) so only one tick may claim a due occurrence. */
  markOccurrenceStatusIf(id: number, from: string, to: string): Promise<boolean>;

  claimPublication(row: InsertPublicationRow): Promise<ClaimPublicationResult>;
  getPublication(id: number): Promise<Publication | undefined>;
  acquirePublicationLease(
    id: number,
    owner: string,
    leaseMs: number,
  ): Promise<Publication | undefined>;
  updatePublication(
    id: number,
    patch: {
      state?: PublicationState;
      attempt?: number;
      providerCalled?: boolean;
      externalId?: string | null;
      lastError?: string | null;
      releaseLease?: boolean;
    },
  ): Promise<void>;
  listStalePublishing(now: Date, limit: number): Promise<Publication[]>;

  insertResult(row: InsertResultRow): Promise<Result | undefined>;
  getResultByPublication(publicationId: number): Promise<Result | undefined>;
}

export class DatabaseContentStorage implements ContentStoragePort {
  constructor(private readonly database: ContentDatabase = defaultDb) {}

  // ── Visual generations ──────────────────────────────────────────────────────
  async claimVisualGeneration(
    row: InsertVisualGenerationRow,
  ): Promise<ClaimVisualGenerationResult> {
    const inserted = await this.database
      .insert(visualGenerations)
      .values({
        userId: row.userId ?? null,
        intent: row.intent,
        kind: row.kind,
        providerId: row.providerId ?? null,
        capability: row.capability ?? null,
        providerVersion: row.providerVersion ?? null,
        requestSnapshot: row.requestSnapshot ?? {},
        idempotencyKey: row.idempotencyKey,
        generationJobId: row.generationJobId ?? null,
        opportunityId: row.opportunityId ?? null,
        correlationId: row.correlationId,
        status: "requested",
      })
      .onConflictDoNothing({ target: visualGenerations.idempotencyKey })
      .returning();

    if (inserted.length > 0) return { generation: inserted[0], created: true };

    const [existing] = await this.database
      .select()
      .from(visualGenerations)
      .where(eq(visualGenerations.idempotencyKey, row.idempotencyKey))
      .limit(1);
    return { generation: existing, created: false };
  }

  async getVisualGeneration(id: number): Promise<VisualGeneration | undefined> {
    const [row] = await this.database
      .select()
      .from(visualGenerations)
      .where(eq(visualGenerations.id, id))
      .limit(1);
    return row;
  }

  async getVisualGenerationByIdempotencyKey(key: string): Promise<VisualGeneration | undefined> {
    const [row] = await this.database
      .select()
      .from(visualGenerations)
      .where(eq(visualGenerations.idempotencyKey, key))
      .limit(1);
    return row;
  }

  async listVisualGenerationsByOpportunity(opportunityId: number): Promise<VisualGeneration[]> {
    return this.database
      .select()
      .from(visualGenerations)
      .where(eq(visualGenerations.opportunityId, opportunityId))
      .orderBy(asc(visualGenerations.id));
  }

  async markVisualGenerationRunning(id: number): Promise<void> {
    await this.database
      .update(visualGenerations)
      .set({ status: "generating", startedAt: new Date() })
      .where(
        and(
          eq(visualGenerations.id, id),
          inArray(visualGenerations.status, ["requested", "failed"]),
        ),
      );
  }

  async markVisualGenerationReady(
    id: number,
    meta: { model: string | null; cost: string | null; attempt: number },
  ): Promise<void> {
    await this.database
      .update(visualGenerations)
      .set({
        status: "ready",
        finishedAt: new Date(),
        model: meta.model,
        cost: meta.cost,
        attempt: meta.attempt,
        errorClass: null,
        errorMessage: null,
      })
      .where(eq(visualGenerations.id, id));
  }

  async markVisualGenerationFailed(
    id: number,
    failureClass: string,
    message: string,
    attempt: number,
  ): Promise<void> {
    await this.database
      .update(visualGenerations)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorClass: failureClass,
        errorMessage: message,
        attempt,
      })
      .where(eq(visualGenerations.id, id));
  }

  // ── Visual assets ───────────────────────────────────────────────────────────
  async insertVisualAsset(row: InsertVisualAssetRow): Promise<VisualAsset> {
    const [inserted] = await this.database
      .insert(visualAssets)
      .values({
        userId: row.userId ?? null,
        visualGenerationId: row.visualGenerationId ?? null,
        kind: row.kind,
        storageKey: row.storageKey,
        mime: row.mime,
        width: row.width ?? null,
        height: row.height ?? null,
        byteSize: row.byteSize ?? null,
        contentHash: row.contentHash ?? null,
        altText: row.altText ?? null,
        caption: row.caption ?? null,
        role: row.role ?? null,
        metadata: row.metadata ?? {},
        supersedesId: row.supersedesId ?? null,
        provenance: row.provenance ?? "generated",
        status: "ready",
      })
      .returning();
    return inserted;
  }

  async getVisualAsset(id: number): Promise<VisualAsset | undefined> {
    const [row] = await this.database
      .select()
      .from(visualAssets)
      .where(eq(visualAssets.id, id))
      .limit(1);
    return row;
  }

  async getLatestVisualAssetForGeneration(
    visualGenerationId: number,
  ): Promise<VisualAsset | undefined> {
    const [row] = await this.database
      .select()
      .from(visualAssets)
      .where(eq(visualAssets.visualGenerationId, visualGenerationId))
      .orderBy(desc(visualAssets.id))
      .limit(1);
    return row;
  }

  async listVisualAssets(userId: number, limit: number): Promise<VisualAsset[]> {
    return this.database
      .select()
      .from(visualAssets)
      .where(eq(visualAssets.userId, userId))
      .orderBy(desc(visualAssets.id))
      .limit(Math.min(Math.max(limit, 1), 200));
  }

  // ── Visual asset refs ───────────────────────────────────────────────────────
  async insertVisualAssetRef(row: InsertVisualAssetRefRow): Promise<VisualAssetRef> {
    const inserted = await this.database
      .insert(visualAssetRefs)
      .values({
        userId: row.userId ?? null,
        artifactId: row.artifactId,
        visualAssetId: row.visualAssetId,
        role: row.role ?? null,
        position: row.position ?? 0,
      })
      .onConflictDoNothing({
        target: [visualAssetRefs.artifactId, visualAssetRefs.visualAssetId],
      })
      .returning();
    if (inserted.length > 0) return inserted[0];
    const [existing] = await this.database
      .select()
      .from(visualAssetRefs)
      .where(
        and(
          eq(visualAssetRefs.artifactId, row.artifactId),
          eq(visualAssetRefs.visualAssetId, row.visualAssetId),
        ),
      )
      .limit(1);
    return existing;
  }

  async listVisualAssetRefs(artifactId: number): Promise<VisualAssetRef[]> {
    return this.database
      .select()
      .from(visualAssetRefs)
      .where(eq(visualAssetRefs.artifactId, artifactId))
      .orderBy(asc(visualAssetRefs.position));
  }

  // ── Voices ──────────────────────────────────────────────────────────────────
  async insertVoice(row: InsertVoiceRow): Promise<Voice> {
    const [inserted] = await this.database
      .insert(voices)
      .values({
        userId: row.userId ?? null,
        voiceKey: row.voiceKey ?? null,
        version: row.version ?? 1,
        name: row.name,
        description: row.description ?? null,
        tone: row.tone ?? null,
        vocabulary: row.vocabulary ?? [],
        sentenceStyle: row.sentenceStyle ?? null,
        formatting: row.formatting ?? {},
        doRules: row.doRules ?? [],
        dontRules: row.dontRules ?? [],
        examples: row.examples ?? [],
      })
      .returning();
    return inserted;
  }

  async getVoice(id: number): Promise<Voice | undefined> {
    const [row] = await this.database.select().from(voices).where(eq(voices.id, id)).limit(1);
    return row;
  }

  async listVoices(): Promise<Voice[]> {
    return this.database.select().from(voices).orderBy(asc(voices.id));
  }

  async listVoicesByKey(voiceKey: string): Promise<Voice[]> {
    return this.database
      .select()
      .from(voices)
      .where(eq(voices.voiceKey, voiceKey))
      .orderBy(asc(voices.version));
  }

  async nextVoiceVersion(voiceKey: string): Promise<number> {
    const rows = await this.database
      .select({ version: voices.version })
      .from(voices)
      .where(eq(voices.voiceKey, voiceKey));
    return rows.reduce((acc, r) => (r.version > acc ? r.version : acc), 0) + 1;
  }

  async setVoiceStatus(id: number, status: string): Promise<Voice | undefined> {
    const [row] = await this.database
      .update(voices)
      .set({ status, updatedAt: new Date() })
      .where(eq(voices.id, id))
      .returning();
    return row;
  }

  // ── Content templates ───────────────────────────────────────────────────────
  async insertContentTemplate(row: InsertTemplateRow): Promise<ContentTemplate> {
    const [inserted] = await this.database
      .insert(contentTemplates)
      .values({
        userId: row.userId ?? null,
        templateKey: row.templateKey ?? null,
        version: row.version ?? 1,
        name: row.name,
        description: row.description ?? null,
        supportedFormats: row.supportedFormats ?? [],
        supportedChannels: row.supportedChannels ?? [],
        structure: row.structure ?? [],
        variables: row.variables ?? [],
        constraints: row.constraints ?? {},
        instructions: row.instructions ?? null,
      })
      .returning();
    return inserted;
  }

  async getContentTemplate(id: number): Promise<ContentTemplate | undefined> {
    const [row] = await this.database
      .select()
      .from(contentTemplates)
      .where(eq(contentTemplates.id, id))
      .limit(1);
    return row;
  }

  async listContentTemplates(): Promise<ContentTemplate[]> {
    return this.database.select().from(contentTemplates).orderBy(asc(contentTemplates.id));
  }

  async listContentTemplatesByKey(templateKey: string): Promise<ContentTemplate[]> {
    return this.database
      .select()
      .from(contentTemplates)
      .where(eq(contentTemplates.templateKey, templateKey))
      .orderBy(asc(contentTemplates.version));
  }

  async nextTemplateVersion(templateKey: string): Promise<number> {
    const rows = await this.database
      .select({ version: contentTemplates.version })
      .from(contentTemplates)
      .where(eq(contentTemplates.templateKey, templateKey));
    return rows.reduce((acc, r) => (r.version > acc ? r.version : acc), 0) + 1;
  }

  async setContentTemplateStatus(
    id: number,
    status: string,
  ): Promise<ContentTemplate | undefined> {
    const [row] = await this.database
      .update(contentTemplates)
      .set({ status, updatedAt: new Date() })
      .where(eq(contentTemplates.id, id))
      .returning();
    return row;
  }

  // ── Generation policies (immutable, content-addressed) ──────────────────────
  async findOrCreateGenerationPolicy(
    row: InsertPolicyRow,
  ): Promise<{ policy: GenerationPolicy; created: boolean }> {
    const inserted = await this.database
      .insert(generationPolicies)
      .values({
        userId: row.userId ?? null,
        policyKey: row.policyKey,
        version: row.version,
        name: row.name,
        format: row.format,
        channel: row.channel,
        voiceId: row.voiceId,
        templateId: row.templateId,
        objective: row.objective,
        audience: row.audience,
        constraints: row.constraints,
        modelPreferences: row.modelPreferences,
        specHash: row.specHash,
      })
      .onConflictDoNothing({ target: generationPolicies.specHash })
      .returning();

    if (inserted.length > 0) return { policy: inserted[0], created: true };

    // The unique spec_hash index is the arbiter, so a racing insert is reused.
    const [existing] = await this.database
      .select()
      .from(generationPolicies)
      .where(eq(generationPolicies.specHash, row.specHash))
      .limit(1);
    return { policy: existing, created: false };
  }

  async getGenerationPolicy(id: number): Promise<GenerationPolicy | undefined> {
    const [row] = await this.database
      .select()
      .from(generationPolicies)
      .where(eq(generationPolicies.id, id))
      .limit(1);
    return row;
  }

  async listGenerationPolicies(): Promise<GenerationPolicy[]> {
    return this.database.select().from(generationPolicies).orderBy(asc(generationPolicies.id));
  }

  async getGenerationPolicyBySpecHash(specHash: string): Promise<GenerationPolicy | undefined> {
    const [row] = await this.database
      .select()
      .from(generationPolicies)
      .where(eq(generationPolicies.specHash, specHash))
      .limit(1);
    return row;
  }

  async nextPolicyVersion(policyKey: string): Promise<number> {
    const rows = await this.database
      .select({ version: generationPolicies.version })
      .from(generationPolicies)
      .where(eq(generationPolicies.policyKey, policyKey));
    const max = rows.reduce((acc, r) => (r.version > acc ? r.version : acc), 0);
    return max + 1;
  }

  // ── Opportunity ─────────────────────────────────────────────────────────────
  async insertOpportunity(row: InsertOpportunityRow): Promise<Opportunity> {
    const [inserted] = await this.database.insert(opportunities).values(row).returning();
    return inserted;
  }

  async getOpportunity(id: number): Promise<Opportunity | undefined> {
    const [row] = await this.database
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, id))
      .limit(1);
    return row;
  }

  async getOpportunityByChatKey(chatKey: string): Promise<Opportunity | undefined> {
    const [row] = await this.database
      .select()
      .from(opportunities)
      .where(eq(opportunities.chatKey, chatKey))
      .limit(1);
    return row;
  }

  async listOpportunitiesByStory(storyId: number): Promise<Opportunity[]> {
    return this.database
      .select()
      .from(opportunities)
      .where(eq(opportunities.storyId, storyId))
      .orderBy(asc(opportunities.id));
  }

  async updateOpportunityStatus(
    id: number,
    status: OpportunityStatus,
    killReason: string | null,
  ): Promise<Opportunity | undefined> {
    const [row] = await this.database
      .update(opportunities)
      .set({ status, killReason, updatedAt: new Date() })
      .where(eq(opportunities.id, id))
      .returning();
    return row;
  }

  // ── GenerationJob ───────────────────────────────────────────────────────────
  async claimGenerationJob(row: InsertGenerationJobRow): Promise<ClaimGenerationJobResult> {
    const inserted = await this.database
      .insert(generationJobs)
      .values({ ...row, policyId: row.policyId ?? null, status: "queued" })
      .onConflictDoNothing({ target: generationJobs.idempotencyKey })
      .returning();

    if (inserted.length > 0) return { job: inserted[0], created: true };

    const [existing] = await this.database
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.idempotencyKey, row.idempotencyKey))
      .limit(1);
    return { job: existing, created: false };
  }

  async getGenerationJob(id: number): Promise<GenerationJob | undefined> {
    const [row] = await this.database
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, id))
      .limit(1);
    return row;
  }

  async getLatestGenerationJobForOpportunity(
    opportunityId: number,
  ): Promise<GenerationJob | undefined> {
    const [row] = await this.database
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.opportunityId, opportunityId))
      .orderBy(desc(generationJobs.id))
      .limit(1);
    return row;
  }

  async markGenerationRunning(id: number): Promise<void> {
    await this.database
      .update(generationJobs)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(generationJobs.id, id), eq(generationJobs.status, "queued")));
  }

  async markGenerationSucceeded(
    id: number,
    meta: { model: string | null; provider: string | null; cost: string | null; attempt: number },
  ): Promise<void> {
    await this.database
      .update(generationJobs)
      .set({
        status: "succeeded",
        finishedAt: new Date(),
        model: meta.model,
        provider: meta.provider,
        cost: meta.cost,
        attempt: meta.attempt,
        errorClass: null,
        errorMessage: null,
      })
      .where(eq(generationJobs.id, id));
  }

  async markGenerationFailed(
    id: number,
    failureClass: string,
    message: string,
    attempt: number,
  ): Promise<void> {
    await this.database
      .update(generationJobs)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorClass: failureClass,
        errorMessage: message,
        attempt,
      })
      .where(eq(generationJobs.id, id));
  }

  // ── Artifact ────────────────────────────────────────────────────────────────
  async insertArtifact(row: InsertArtifactRow): Promise<Artifact> {
    const [inserted] = await this.database.insert(artifacts).values(row).returning();
    return inserted;
  }

  async getArtifact(id: number): Promise<Artifact | undefined> {
    const [row] = await this.database.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
    return row;
  }

  async getArtifactByGenerationJob(generationJobId: number): Promise<Artifact | undefined> {
    const [row] = await this.database
      .select()
      .from(artifacts)
      .where(eq(artifacts.generationJobId, generationJobId))
      .limit(1);
    return row;
  }

  async listArtifactsByOpportunity(opportunityId: number): Promise<Artifact[]> {
    return this.database
      .select()
      .from(artifacts)
      .where(eq(artifacts.opportunityId, opportunityId))
      .orderBy(asc(artifacts.id));
  }

  async listArtifactsByOpportunityAndReadiness(
    opportunityId: number,
    readiness: ArtifactReadiness,
  ): Promise<Artifact[]> {
    return this.database
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.opportunityId, opportunityId), eq(artifacts.readiness, readiness)))
      .orderBy(asc(artifacts.id));
  }

  async setArtifactReadiness(
    id: number,
    readiness: ArtifactReadiness,
    approvedAt: Date | null,
  ): Promise<Artifact | undefined> {
    const [row] = await this.database
      .update(artifacts)
      .set({ readiness, approvedAt })
      .where(eq(artifacts.id, id))
      .returning();
    return row;
  }

  // ── Schedule / Occurrence ───────────────────────────────────────────────────
  async insertSchedule(row: InsertScheduleRow): Promise<Schedule> {
    const [inserted] = await this.database.insert(schedules).values(row).returning();
    return inserted;
  }

  async getSchedule(id: number): Promise<Schedule | undefined> {
    const [row] = await this.database.select().from(schedules).where(eq(schedules.id, id)).limit(1);
    return row;
  }

  async listSchedulesByArtifact(artifactId: number): Promise<Schedule[]> {
    return this.database
      .select()
      .from(schedules)
      .where(eq(schedules.artifactId, artifactId))
      .orderBy(asc(schedules.id));
  }

  async listActiveSchedules(now: Date, limit: number): Promise<Schedule[]> {
    return this.database
      .select()
      .from(schedules)
      .where(and(eq(schedules.status, "active"), lte(schedules.startAt, now)))
      .orderBy(asc(schedules.startAt))
      .limit(limit);
  }

  async setScheduleStatus(id: number, status: string): Promise<void> {
    await this.database
      .update(schedules)
      .set({ status, updatedAt: new Date() })
      .where(eq(schedules.id, id));
  }

  async materializeOccurrence(
    scheduleId: number,
    at: Date,
  ): Promise<ScheduleOccurrence | undefined> {
    const inserted = await this.database
      .insert(scheduleOccurrences)
      .values({ scheduleId, occurrenceTime: at })
      .onConflictDoNothing({
        target: [scheduleOccurrences.scheduleId, scheduleOccurrences.occurrenceTime],
      })
      .returning();
    if (inserted.length > 0) return inserted[0];
    const [existing] = await this.database
      .select()
      .from(scheduleOccurrences)
      .where(
        and(
          eq(scheduleOccurrences.scheduleId, scheduleId),
          eq(scheduleOccurrences.occurrenceTime, at),
        ),
      )
      .limit(1);
    return existing;
  }

  async getOccurrence(id: number): Promise<ScheduleOccurrence | undefined> {
    const [row] = await this.database
      .select()
      .from(scheduleOccurrences)
      .where(eq(scheduleOccurrences.id, id))
      .limit(1);
    return row;
  }

  async getOccurrenceByScheduleTime(
    scheduleId: number,
    at: Date,
  ): Promise<ScheduleOccurrence | undefined> {
    const [row] = await this.database
      .select()
      .from(scheduleOccurrences)
      .where(
        and(
          eq(scheduleOccurrences.scheduleId, scheduleId),
          eq(scheduleOccurrences.occurrenceTime, at),
        ),
      )
      .limit(1);
    return row;
  }

  async listDueOccurrences(now: Date, limit: number): Promise<ScheduleOccurrence[]> {
    // `enqueued` is included so a crash between claiming an occurrence and
    // enqueueing its Publication self-heals on the next tick (the publication
    // claim is idempotent, so a re-tick cannot double-enqueue).
    return this.database
      .select()
      .from(scheduleOccurrences)
      .where(
        and(
          inArray(scheduleOccurrences.status, ["pending", "enqueued"]),
          lte(scheduleOccurrences.occurrenceTime, now),
        ),
      )
      .orderBy(asc(scheduleOccurrences.occurrenceTime))
      .limit(limit);
  }

  /**
   * Recurrence cursor: the count of rows already materialized for this
   * schedule is the durable "next index" — no separate mutable cursor column
   * needed. The unique `(schedule_id, occurrence_time)` index makes concurrent
   * ticks land on the same count safe (see `materializeOccurrence`).
   */
  async countOccurrences(scheduleId: number): Promise<number> {
    const [row] = await this.database
      .select({ count: sql<number>`count(*)::int` })
      .from(scheduleOccurrences)
      .where(eq(scheduleOccurrences.scheduleId, scheduleId));
    return row?.count ?? 0;
  }

  async markOccurrenceStatus(id: number, status: string): Promise<void> {
    await this.database
      .update(scheduleOccurrences)
      .set({ status })
      .where(eq(scheduleOccurrences.id, id));
  }

  /** Compare-and-set: true only for the caller that performed the transition. */
  async markOccurrenceStatusIf(id: number, from: string, to: string): Promise<boolean> {
    const rows = await this.database
      .update(scheduleOccurrences)
      .set({ status: to })
      .where(and(eq(scheduleOccurrences.id, id), eq(scheduleOccurrences.status, from)))
      .returning({ id: scheduleOccurrences.id });
    return rows.length > 0;
  }

  // ── Publication ─────────────────────────────────────────────────────────────
  async claimPublication(row: InsertPublicationRow): Promise<ClaimPublicationResult> {
    const inserted = await this.database
      .insert(publications)
      .values({ ...row, state: "queued" })
      .onConflictDoNothing({ target: publications.idempotencyKey })
      .returning();
    if (inserted.length > 0) return { publication: inserted[0], created: true };

    const [existing] = await this.database
      .select()
      .from(publications)
      .where(eq(publications.idempotencyKey, row.idempotencyKey))
      .limit(1);
    return { publication: existing, created: false };
  }

  async getPublication(id: number): Promise<Publication | undefined> {
    const [row] = await this.database
      .select()
      .from(publications)
      .where(eq(publications.id, id))
      .limit(1);
    return row;
  }

  /**
   * Single-flight lease: only one worker may hold a publication in `publishing`.
   * Acquisition is a conditional UPDATE, so it is atomic under concurrency.
   */
  async acquirePublicationLease(
    id: number,
    owner: string,
    leaseMs: number,
  ): Promise<Publication | undefined> {
    const now = new Date();
    const expires = new Date(now.getTime() + leaseMs);
    const rows = await this.database
      .update(publications)
      .set({
        state: "publishing",
        leaseOwner: owner,
        leaseExpiresAt: expires,
        attempt: sql`${publications.attempt} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(publications.id, id),
          inArray(publications.state, ["scheduled", "queued", "publishing", "failed"]),
          or(
            isNull(publications.leaseExpiresAt),
            lt(publications.leaseExpiresAt, now),
            eq(publications.leaseOwner, owner),
          ),
        ),
      )
      .returning();
    return rows[0];
  }

  async updatePublication(
    id: number,
    patch: {
      state?: PublicationState;
      attempt?: number;
      providerCalled?: boolean;
      externalId?: string | null;
      lastError?: string | null;
      releaseLease?: boolean;
    },
  ): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.state !== undefined) set.state = patch.state;
    if (patch.attempt !== undefined) set.attempt = patch.attempt;
    if (patch.providerCalled !== undefined) set.providerCalled = patch.providerCalled;
    if (patch.externalId !== undefined) set.externalId = patch.externalId;
    if (patch.lastError !== undefined) set.lastError = patch.lastError;
    if (patch.releaseLease) {
      set.leaseOwner = null;
      set.leaseExpiresAt = null;
    }
    await this.database.update(publications).set(set).where(eq(publications.id, id));
  }

  async listStalePublishing(now: Date, limit: number): Promise<Publication[]> {
    return this.database
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.state, "publishing"),
          lt(publications.leaseExpiresAt, now),
        ),
      )
      .orderBy(asc(publications.id))
      .limit(limit);
  }

  // ── Result ──────────────────────────────────────────────────────────────────
  async insertResult(row: InsertResultRow): Promise<Result | undefined> {
    const inserted = await this.database
      .insert(results)
      .values(row)
      .onConflictDoNothing({ target: results.publicationId })
      .returning();
    if (inserted.length > 0) return inserted[0];
    return this.getResultByPublication(row.publicationId);
  }

  async getResultByPublication(publicationId: number): Promise<Result | undefined> {
    const [row] = await this.database
      .select()
      .from(results)
      .where(eq(results.publicationId, publicationId))
      .limit(1);
    return row;
  }
}
