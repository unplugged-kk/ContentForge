import { createHash } from "node:crypto";
import { cuesToText, type TranscriptCue } from "./vtt";

/**
 * Source-intelligence primitives for video transcripts.
 *
 * Everything here is deterministic: hashing, chunking and dedupe never call a
 * model. `transcriptHash` is the cache key that guarantees a video is processed
 * once.
 */

export type TranscriptSource = "subs" | "auto-subs";

export type Transcript = {
  videoId: string;
  lang: string | null;
  source: TranscriptSource;
  cues: TranscriptCue[];
  text: string;
  charCount: number;
  hash: string;
};

export type TranscriptChunk = {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  charCount: number;
  hash: string;
};

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Cache key: a stable hash over (video, language, normalized text). */
export function computeTranscriptHash(videoId: string, lang: string | null, text: string): string {
  return sha256(`${videoId}\u0000${lang ?? ""}\u0000${text.replace(/\s+/g, " ").trim()}`);
}

export function buildTranscript(input: {
  videoId: string;
  lang: string | null;
  source: TranscriptSource;
  cues: TranscriptCue[];
}): Transcript {
  const text = cuesToText(input.cues);
  return {
    videoId: input.videoId,
    lang: input.lang,
    source: input.source,
    cues: input.cues,
    text,
    charCount: text.length,
    hash: computeTranscriptHash(input.videoId, input.lang, text),
  };
}

/**
 * Group consecutive cues into bounded chunks (default ~1200 chars) so a cheap
 * classifier can see sections, and a deep model only sees what it must.
 */
export function chunkTranscript(cues: TranscriptCue[], targetChars = 1200): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let current: TranscriptCue[] = [];
  let size = 0;

  const flush = () => {
    if (current.length === 0) return;
    const text = cuesToText(current);
    chunks.push({
      index: chunks.length,
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
      text,
      charCount: text.length,
      hash: sha256(text),
    });
    current = [];
    size = 0;
  };

  for (const cue of cues) {
    if (size > 0 && size + cue.text.length > targetChars) flush();
    current.push(cue);
    size += cue.text.length + 1;
  }
  flush();
  return chunks;
}

/** Drop chunks whose (normalized) text was already seen — cross- and intra-source. */
export function dedupeChunks(chunks: TranscriptChunk[], seen: Set<string> = new Set()): TranscriptChunk[] {
  const out: TranscriptChunk[] = [];
  for (const chunk of chunks) {
    if (seen.has(chunk.hash)) continue;
    seen.add(chunk.hash);
    out.push(chunk);
  }
  return out;
}
