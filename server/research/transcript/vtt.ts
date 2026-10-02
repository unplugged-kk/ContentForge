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
    if (previous && previous.text === text) {
      // Exact repeat: extend the previous cue's window.
      previous.endMs = Math.max(previous.endMs, endMs);
      continue;
    }
    if (previous && text.startsWith(previous.text)) {
      // Rolling caption: the new cue extends the previous one.
      previous.text = text;
      previous.endMs = Math.max(previous.endMs, endMs);
      continue;
    }
    if (previous && previous.text.endsWith(text)) {
      previous.endMs = Math.max(previous.endMs, endMs);
      continue;
    }
    cues.push({ startMs, endMs, text });
  }
  return cues;
}

/** Join cues into one normalized text body (single-spaced). */
export function cuesToText(cues: TranscriptCue[]): string {
  return cues.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
}
