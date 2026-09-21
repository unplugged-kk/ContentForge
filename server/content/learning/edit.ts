import type { JsonRecord } from "../storage";

export interface ExtractedBody {
  text: string;
  units: string[];
  hook: string;
  cta: string;
  newlineCount: number;
  markdownMarkers: number;
}

function unitsFromPayload(payload: JsonRecord): string[] {
  const units = payload.units;
  if (Array.isArray(units)) {
    return units
      .map((u) => {
        if (typeof u === "string") return u;
        if (u && typeof u === "object" && typeof (u as { text?: unknown }).text === "string") {
          return (u as { text: string }).text;
        }
        return "";
      })
      .filter((t) => t.length > 0);
  }
  if (typeof payload.text === "string" && payload.text.length > 0) return [payload.text];
  if (typeof payload.commentary === "string" && payload.commentary.length > 0) return [payload.commentary];
  return [];
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function lastNonEmpty(units: string[]): string {
  for (let i = units.length - 1; i >= 0; i--) {
    const t = units[i]!.trim();
    if (t) return t;
  }
  return "";
}

function looksLikeCta(text: string): boolean {
  return /https?:\/\/|www\.|follow|subscribe|comment|retweet|share this|link in/i.test(text);
}

function markdownMarkerCount(text: string): number {
  return (text.match(/(\*\*|__|`|# |\n- |\n\* )/g) ?? []).length;
}

export function extractBody(payload: JsonRecord): ExtractedBody {
  const units = unitsFromPayload(payload);
  const text = units.join("\n");
  const hook = firstLine(units[0] ?? "");
  const tail = lastNonEmpty(units);
  return {
    text,
    units,
    hook,
    cta: looksLikeCta(tail) ? tail : "",
    newlineCount: (text.match(/\n/g) ?? []).length,
    markdownMarkers: markdownMarkerCount(text),
  };
}

export interface EditMetrics {
  lengthDelta: number;
  addedChars: number;
  removedChars: number;
  unitCountDelta: number;
  hookChanged: boolean;
  ctaChanged: boolean;
  formattingChanged: boolean;
  substantial: boolean;
}

function charDelta(before: string, after: string): { added: number; removed: number } {
  // Bounded structural delta — not a semantic diff. Prefix/suffix LCS is enough
  // to estimate added vs removed characters without storing both bodies.
  let i = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (i < maxPrefix && before[i] === after[i]) i++;
  let j = 0;
  const maxSuffix = Math.min(before.length - i, after.length - i);
  while (j < maxSuffix && before[before.length - 1 - j] === after[after.length - 1 - j]) j++;
  const removed = before.length - i - j;
  const added = after.length - i - j;
  return { added, removed };
}

export function deriveEditMetrics(prior: JsonRecord, next: JsonRecord): EditMetrics {
  const a = extractBody(prior);
  const b = extractBody(next);
  const { added, removed } = charDelta(a.text, b.text);
  const hookChanged = a.hook !== b.hook;
  const ctaChanged = a.cta !== b.cta;
  const formattingChanged =
    a.newlineCount !== b.newlineCount || a.markdownMarkers !== b.markdownMarkers;
  const substantial = added + removed >= 20 || hookChanged;
  return {
    lengthDelta: b.text.length - a.text.length,
    addedChars: added,
    removedChars: removed,
    unitCountDelta: b.units.length - a.units.length,
    hookChanged,
    ctaChanged,
    formattingChanged,
    substantial,
  };
}
