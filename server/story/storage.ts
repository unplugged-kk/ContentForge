/**
 * Persistence for the Story domain.
 *
 * Behind an interface so the Story service is testable without a database and so
 * persistence can evolve independently of domain logic. Stories reference their
 * ResearchJob and that job's evidence by ID only — this layer never reads or
 * writes research content.
 */

import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { stories, type Story } from "@shared/schema";
import { db as defaultDb } from "../db";

/** Database handle the storage layer writes to. Injected so tests can target a
 *  dedicated database without touching the application's connection. */
export type StoryDatabase = NodePgDatabase<typeof schema>;

/** researched | human | imported (Ticket 03 §1). */
export type StoryProvenance = "researched" | "human" | "imported";
/** draft | ready | used | archived (Ticket 03 §2). No kill state. */
export type StoryStatus = "draft" | "ready" | "used" | "archived";

export interface InsertStoryRow {
  userId?: number | null;
  /** Nullable per the locked model (human/imported provenance); researched requires a job. */
  researchJobId: number | null;
  provenance: StoryProvenance;
  title: string;
  insightBody: string;
  interpretationMarked: boolean;
  angles: string[];
  /** Research evidence IDs — references, never copies. */
  evidenceRefs: number[];
  status: StoryStatus;
  /**
   * Phase 13: set only when an AutomationRun derives this Story. UNIQUE in the
   * database, so the insert is the idempotency arbiter (see `insertStory`).
   */
  automationRunId?: number | null;
}

export interface StoryStoragePort {
  insertStory(row: InsertStoryRow): Promise<Story>;
  getStory(id: number): Promise<Story | undefined>;
  /** Multiple Stories per ResearchJob are legitimate (Ticket 03 §3), so this returns a list. */
  listStoriesByResearchJob(researchJobId: number): Promise<Story[]>;
  /** The one Story an AutomationRun derived, if it has derived it yet (§4/§19). */
  getStoryByAutomationRun(automationRunId: number): Promise<Story | undefined>;
  /** Lifecycle only: `draft → ready → used | archived` (Ticket 03 §2). */
  updateStoryStatus(id: number, status: StoryStatus): Promise<Story | undefined>;
}

export class DatabaseStoryStorage implements StoryStoragePort {
  constructor(private readonly database: StoryDatabase = defaultDb) {}

  /**
   * Insert a Story. When `automationRunId` is set the insert is made idempotent
   * by the `stories_automation_run_uq` unique index: a duplicate delivery, a
   * worker retry, or a re-advance after a crash collapses onto the ONE Story
   * already recorded for that run (the database is the arbiter — no check-then-
   * insert race). Human-authored Stories (no run id) are unaffected: NULLs
   * never conflict, so "many Stories per ResearchJob" still holds.
   */
  async insertStory(row: InsertStoryRow): Promise<Story> {
    const inserted = await this.database
      .insert(stories)
      .values({
        userId: row.userId ?? null,
        researchJobId: row.researchJobId,
        provenance: row.provenance,
        title: row.title,
        insightBody: row.insightBody,
        interpretationMarked: row.interpretationMarked,
        angles: row.angles,
        evidenceRefs: row.evidenceRefs,
        status: row.status,
        automationRunId: row.automationRunId ?? null,
      })
      .onConflictDoNothing({ target: stories.automationRunId })
      .returning();

    if (inserted.length > 0) return inserted[0];
    // Only reachable for an automation-derived Story whose run already has one.
    const existing = await this.getStoryByAutomationRun(row.automationRunId!);
    return existing!;
  }

  async getStory(id: number): Promise<Story | undefined> {
    const rows = await this.database.select().from(stories).where(eq(stories.id, id)).limit(1);
    return rows[0];
  }

  async listStoriesByResearchJob(researchJobId: number): Promise<Story[]> {
    return this.database
      .select()
      .from(stories)
      .where(eq(stories.researchJobId, researchJobId))
      .orderBy(stories.id);
  }

  async getStoryByAutomationRun(automationRunId: number): Promise<Story | undefined> {
    const [row] = await this.database
      .select()
      .from(stories)
      .where(and(eq(stories.automationRunId, automationRunId)))
      .limit(1);
    return row;
  }

  async updateStoryStatus(id: number, status: StoryStatus): Promise<Story | undefined> {
    const [row] = await this.database
      .update(stories)
      .set({ status, updatedAt: new Date() })
      .where(eq(stories.id, id))
      .returning();
    return row;
  }
}
