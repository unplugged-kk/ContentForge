import { chunkTranscript, dedupeChunks } from "./transcript";
import { fetchYouTubeTranscript, ytDlpAvailable, youTubeIdFromUrl } from "./transcript/fetch";
import { getVideoSourceByHash, listVideoChunks, saveTranscriptAsSource } from "./videoStorage";

/**
 * Video intake (transcript-first, Tier 0).
 *
 * URL → captions → normalize/hash → chunk/dedupe → persisted source. NO model is
 * called here: extraction is a later, separately-gated step. Re-ingesting the
 * same video is a cache hit and never re-runs the pipeline.
 */

export type VideoIntakeResult =
  | {
      status: "ingested";
      sourceId: number;
      videoId: string;
      transcriptHash: string;
      charCount: number;
      chunkCount: number;
      /** Caption language, when the track declares one. */
      lang: string | null;
      /** Cues parsed from the captions, before chunking — the DB column's value. */
      cueCount: number;
      /** Which caption track was used (`subs` = manual, `auto` = ASR). */
      transcriptSource: string;
      reused: boolean;
    }
  | { status: "no_transcript"; videoId: string | null }
  | { status: "unavailable"; message: string };

export async function intakeVideo(
  url: string,
  options: { targetChars?: number } = {},
): Promise<VideoIntakeResult> {
  if (!(await ytDlpAvailable())) {
    return {
      status: "unavailable",
      message: "yt-dlp is not available on this host — install it (or run intake agent-side).",
    };
  }

  const transcript = await fetchYouTubeTranscript(url);
  if (!transcript) {
    return { status: "no_transcript", videoId: youTubeIdFromUrl(url) };
  }

  const existing = await getVideoSourceByHash(transcript.hash);
  if (existing) {
    const chunks = await listVideoChunks(existing.id);
    return {
      status: "ingested",
      sourceId: existing.id,
      videoId: existing.videoId,
      transcriptHash: existing.transcriptHash,
      charCount: existing.charCount,
      chunkCount: chunks.length,
      // F15: these live in the row but were missing from the response, so a
      // caller could not tell which track or how many cues it had ingested.
      lang: existing.lang ?? null,
      cueCount: existing.cueCount,
      transcriptSource: existing.transcriptSource,
      reused: true,
    };
  }

  const chunks = dedupeChunks(chunkTranscript(transcript.cues, options.targetChars ?? 1200));
  const { row, reused } = await saveTranscriptAsSource({ url, transcript, chunks });
  return {
    status: "ingested",
    sourceId: row.id,
    videoId: row.videoId,
    transcriptHash: row.transcriptHash,
    charCount: row.charCount,
    chunkCount: chunks.length,
    lang: row.lang ?? null,
    cueCount: row.cueCount,
    transcriptSource: row.transcriptSource,
    reused,
  };
}
