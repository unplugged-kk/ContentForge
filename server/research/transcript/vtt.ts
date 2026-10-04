/**
 * WebVTT parsing for YouTube captions.
 *
 * Deterministic, dependency-free. YouTube auto-captions use a rolling window
 * where each cue often repeats the previous line; we collapse that here so
 * downstream chunking sees each sentence once.
 */

export type TranscriptCue = { startMs: number; endMs: number; text: string };

const TIMESTAMP = /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}/;

function parseTime(value: string): number {
  const parts = value.trim().replace(",", ".").split(":").map((p) => Number(p));
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + (Number.isFinite(part) ? part : 0);
  return Math.round(seconds * 1000);
}

function cleanText(line: string): string {
  return line
    .replace(/<[^>]*>/g, "") // inline tags <c>, <00:00:01.000>, timestamps
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Minimum shared words before two cues are treated as one rolling caption.
 *
 * One shared word is not evidence of a rolling window — consecutive sentences
 * routinely share one ("The end" / "end of story") — so merging on a single word
 * would corrupt ordinary prose. YouTube's window slides by a line, so a real
 * overlap is several words.
 */
const MIN_ROLLING_OVERLAP_WORDS = 2;

/**
 * Longest run of words that ends `previous` and begins `text`, word-aligned.
 *
 * This is what the previous three branches (exact, `startsWith`, `endsWith`)
 * could not express: a rolling window that repeats an INTERIOR span matched none
 * of them, so the repeated phrase survived into the transcript (finding F7 —
 * `"…coming over and over again. again."`).
 */
export function rollingOverlapWords(previous: string, text: string): number {
  const a = previous.split(/\s+/).filter(Boolean);
  const b = text.split(/\s+/).filter(Boolean);
  const ceiling = Math.min(a.length, b.length);
  for (let n = ceiling; n > 0; n--) {
    let matches = true;
    for (let k = 0; k < n; k++) {
      if (a[a.length - n + k] !== b[k]) {
        matches = false;
        break;
      }
    }
    if (matches) return n;
  }
  return 0;
}

/** Parse a `.vtt` document into cues, collapsing rolling duplicate lines. */
export function parseVtt(vtt: string): TranscriptCue[] {
  const lines = vtt.split(/\r?\n/);
  const cues: TranscriptCue[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!TIMESTAMP.test(line)) {
      i++;
      continue;
    }
    const [rawStart, rawEnd] = line.split("-->");
    const startMs = parseTime(rawStart.split(/\s+/)[0]);
    const endMs = parseTime((rawEnd ?? "").trim().split(/\s+/)[0] || rawStart.split(/\s+/)[0]);

    i++;
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      const cleaned = cleanText(lines[i]);
      if (cleaned) buf.push(cleaned);
      i++;
    }
    const text = cleanText(buf.join(" "));
    if (!text) continue;

    const previous = cues[cues.length - 1];
    if (previous) {
      const overlap = rollingOverlapWords(previous.text, text);
      if (overlap >= MIN_ROLLING_OVERLAP_WORDS) {
        // Merge only the genuinely new words, so the repeated span appears once.
        const incoming = text.split(/\s+/).filter(Boolean);
        if (overlap < incoming.length) {
          previous.text = `${previous.text} ${incoming.slice(overlap).join(" ")}`;
        }
        previous.endMs = Math.max(previous.endMs, endMs);
        continue;
      }
    }
    cues.push({ startMs, endMs, text });
  }
  return cues;
}

/** Join cues into one normalized text body (single-spaced). */
export function cuesToText(cues: TranscriptCue[]): string {
  return cues.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
}
