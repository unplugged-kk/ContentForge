/**
 * Intel-brief → idea seeds. Pure: no fs, no db, no model call.
 *
 * WHY THIS MODULE EXISTS (run 56)
 *
 * `script/oci-intel-to-ideas.ts` worked exactly once, for the day it was written
 * for. Three things bound it to that one day:
 *
 *   1. the intel file was a module-level constant;
 *   2. the batch id was a module-level constant;
 *   3. the provenance assertion required `https://lspace.beehiiv.com/...`.
 *
 * Measured on the laptop's next brief (2026-11-24): 17 usable sections and real
 * `- source:` lines, but ZERO lspace URLs, so `assert(urls.length > 0, "no
 * episode URL found")` threw before anything was read. The brief was fine; the
 * guard was tied to one podcast's host and called that "provenance".
 *
 * A guard that can only pass for the item it was written against is the same
 * defect class as a control that only counts to zero: it reports on the sample it
 * was built from, not on the input it is handed.
 *
 * WHAT PROVENANCE ACTUALLY MEANS HERE
 *
 * Every intel item carries a `- source: <url>` line written by the loop that
 * fetched it. That line — not a hostname — is the traceability fact. Seeds are
 * attributed to the source line of the item section they sit in, so an idea's
 * source_url is read off the brief rather than guessed by the model.
 */

export interface IntelSeed {
  /** The "## N. Title" heading, verbatim. */
  heading: string;
  body: string;
  /** The nearest preceding `- source:` url in the same item, or null. */
  sourceUrl: string | null;
  /** The "# Item N — ..." title this seed sits under, or null. */
  itemTitle: string | null;
}

export interface IntelBrief {
  seeds: IntelSeed[];
  /** Every distinct `- source:` url, in file order. */
  sources: string[];
  /** "# Item N" titles found, in file order. */
  items: string[];
}

/** A seed must have enough body to be worth a model call. */
const MIN_BODY = 200;

const HEADING = /^## (\d+)\.\s+(.+)$/;
const ITEM = /^# Item\s+\d+\s*[—:-]\s*(.+)$/;
const SOURCE = /^\s*-\s*source:\s*(\S+)\s*$/;

/**
 * Parse a brief into seeds, attributing each seed to the source of the item it
 * belongs to. Reads the whole document so a source line above a heading applies
 * to the seeds below it.
 */
export function parseIntelBrief(text: string): IntelBrief {
  const lines = text.split("\n");

  // Pass 1: item titles and source urls, with the line index they appear at.
  const itemMarks: { at: number; title: string }[] = [];
  const sourceMarks: { at: number; url: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const item = lines[i].match(ITEM);
    if (item) itemMarks.push({ at: i, title: item[1].trim() });
    const src = lines[i].match(SOURCE);
    // `- source:` also appears under the run header; accept them all, then
    // resolve per-seed by position.
    if (src) sourceMarks.push({ at: i, url: src[1] });
  }

  const seeds: IntelSeed[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!HEADING.test(lines[i])) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length && !/^## /.test(lines[j]); j++) {
      body.push(lines[j]);
    }
    const joined = body.join("\n").trim();
    if (joined.length < MIN_BODY) continue; // nav/heading-only sections

    // Nearest source written BEFORE this heading; nearest item before it too.
    let sourceUrl: string | null = null;
    for (const s of sourceMarks) {
      if (s.at < i) sourceUrl = s.url;
      else break;
    }
    let itemTitle: string | null = null;
    for (const m of itemMarks) {
      if (m.at < i) itemTitle = m.title;
      else break;
    }

    seeds.push({
      heading: lines[i].slice(3).trim(),
      body: joined.slice(0, 1800),
      sourceUrl,
      itemTitle,
    });
  }

  const sources = [...new Set(sourceMarks.map((s) => s.url))];
  return { seeds, sources, items: itemMarks.map((m) => m.title) };
}

/**
 * Provenance, asserted on the fact that must hold rather than on a hostname:
 * the brief must name at least one source url. The previous check required
 * `lspace.beehiiv.com` specifically, which is a property of one podcast, not of
 * a traceable brief.
 */
export function assertTraceableBrief(brief: IntelBrief, intelPath: string): void {
  if (brief.seeds.length === 0) {
    throw new Error(`no usable intel sections (>=${MIN_BODY} chars) in ${intelPath}`);
  }
  if (brief.sources.length === 0) {
    throw new Error(`no "- source:" line in ${intelPath} — nothing is traceable`);
  }
  const unattributed = brief.seeds.filter((s) => !s.sourceUrl).length;
  if (unattributed === brief.seeds.length) {
    throw new Error(
      `every seed in ${intelPath} sits above the first "- source:" line — ` +
        `source attribution would be fabricated`,
    );
  }
}

/** Batch id per intel day. Stable, so a re-run is idempotent. */
export function batchIdFor(intelDate: string): string {
  return `intel_${intelDate}`;
}
