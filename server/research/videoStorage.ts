import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { videoSources, videoChunks, videoClaims } from "@shared/schema";
import type { Transcript, TranscriptChunk } from "./transcript";

/**
 * Persistence for video source intelligence.
 *
 * A transcript is stored once per `transcriptHash`; chunks and claims hang off
 * that source. Re-ingesting the same video returns the existing row and never
 * writes chunks twice.
 */

export async function getVideoSourceByHash(transcriptHash: string) {
  const [row] = await db
    .select()
    .from(videoSources)
    .where(eq(videoSources.transcriptHash, transcriptHash))
    .limit(1);
  return row ?? null;
}

export async function getVideoSourceById(id: number) {
  const [row] = await db.select().from(videoSources).where(eq(videoSources.id, id)).limit(1);
  return row ?? null;
}

export async function saveTranscriptAsSource(input: {
  url: string;
  transcript: Transcript;
  chunks: TranscriptChunk[];
}) {
  const existing = await getVideoSourceByHash(input.transcript.hash);
  if (existing) return { row: existing, reused: true };

  const lastCue = input.transcript.cues[input.transcript.cues.length - 1];
  const [inserted] = await db
    .insert(videoSources)
    .values({
      videoId: input.transcript.videoId,
      url: input.url,
      lang: input.transcript.lang,
      transcriptSource: input.transcript.source,
      transcriptHash: input.transcript.hash,
      charCount: input.transcript.charCount,
      cueCount: input.transcript.cues.length,
      durationMs: lastCue ? lastCue.endMs : null,
      metadata: { source: "yt-dlp", lang: input.transcript.lang },
    })
    .onConflictDoNothing({ target: videoSources.transcriptHash })
    .returning();

  // Lost the insert race: someone else wrote the same transcript hash.
  const row = inserted ?? (await getVideoSourceByHash(input.transcript.hash));
  if (!row) throw new Error("video source insert failed");

  if (inserted && input.chunks.length > 0) {
    await db
      .insert(videoChunks)
      .values(
        input.chunks.map((chunk) => ({
          sourceId: row.id,
          idx: chunk.index,
          startMs: chunk.startMs,
          endMs: chunk.endMs,
          text: chunk.text,
          charCount: chunk.charCount,
          hash: chunk.hash,
        })),
      )
      .onConflictDoNothing();
  }
  return { row, reused: !inserted };
}

export async function listVideoChunks(sourceId: number) {
  return db.select().from(videoChunks).where(eq(videoChunks.sourceId, sourceId)).orderBy(videoChunks.idx);
}

export async function insertVideoClaims(
  rows: Array<{
    sourceId: number;
    chunkId?: number | null;
    claim: string;
    confidence?: number | null;
    extractionModel?: string | null;
    sourceUrl?: string | null;
    timestampMs?: number | null;
    risk?: string | null;
  }>,
) {
  if (rows.length === 0) return [];
  return db
    .insert(videoClaims)
    .values(
      rows.map((row) => ({
        sourceId: row.sourceId,
        chunkId: row.chunkId ?? null,
        claim: row.claim,
        confidence: row.confidence != null ? String(row.confidence) : null,
        extractionModel: row.extractionModel ?? null,
        sourceUrl: row.sourceUrl ?? null,
        timestampMs: row.timestampMs ?? null,
        risk: row.risk ?? null,
      })),
    )
    .returning();
}

export async function listVideoClaims(sourceId: number) {
  return db
    .select()
    .from(videoClaims)
    .where(eq(videoClaims.sourceId, sourceId))
    .orderBy(desc(videoClaims.id));
}
