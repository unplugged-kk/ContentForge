/**
 * Persistence for the Story domain.
 *
 * Behind an interface so the Story service is testable without a database and so
 * persistence can evolve independently of domain logic. Stories reference their
 * ResearchJob and that job's evidence by ID only — this layer never reads or
 * writes research content.
 */

import { eq } from "drizzle-orm";
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
}

export interface StoryStoragePort {
  insertStory(row: InsertStoryRow): Promise<Story>;
  getStory(id: number): Promise<Story | undefined>;
  /** Multiple Stories per ResearchJob are legitimate (Ticket 03 §3), so this returns a list. */
  listStoriesByResearchJob(researchJobId: number): Promise<Story[]>;
  /** Lifecycle only: `draft → ready → used | archived` (Ticket 03 §2). */
  updateStoryStatus(id: number, status: StoryStatus): Promise<Story | undefined>;
}

export class DatabaseStoryStorage implements StoryStoragePort {
  constructor(private readonly database: StoryDatabase = defaultDb) {}

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
      })
      .returning();
    return inserted[0];
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

  async updateStoryStatus(id: number, status: StoryStatus): Promise<Story | undefined> {
    const [row] = await this.database
      .update(stories)
      .set({ status, updatedAt: new Date() })
      .where(eq(stories.id, id))
      .returning();
    return row;
  }
}
