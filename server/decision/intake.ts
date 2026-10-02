import {
  triageCandidates,
  type ResearchCandidate,
  type TriageContext,
  type TriagedCandidate,
} from "./jev";

/**
 * Intake → triage seam.
 *
 * Accepts raw discovery items (last30days JSON, NormalizedSource-shaped objects,
 * or hand-written candidates), normalizes them to `ResearchCandidate`, and runs
 * them through Jev triage so only `pursue` candidates continue to deep research.
 * This is deliberately transport-agnostic and side-effect free: callers decide
 * what to do with the decisions.
 */

export type IntakeItem = Record<string, unknown>;

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function nested(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** Map heterogeneous discovery items to triage candidates. Skips items with no title. */
export function toCandidates(items: IntakeItem[]): ResearchCandidate[] {
  const out: ResearchCandidate[] = [];
  items.forEach((raw, index) => {
    const text = typeof raw.text === "string" ? raw.text : undefined;
    const title =
      firstString(raw.title, raw.name, raw.headline, raw.question) ??
      (text ? text.slice(0, 160) : undefined) ??
      firstString(raw.excerpt, raw.snippet, raw.summary, raw.body, raw.description)?.slice(0, 160);
    if (!title) return;
    out.push({
      id: String(
        raw.id ?? raw.item_id ?? raw.url ?? raw.canonicalUrl ?? `item-${index}`,
      ),
      title,
      summary: firstString(raw.summary, raw.snippet, raw.excerpt, raw.body, raw.description, text),
      url: firstString(raw.url, raw.canonicalUrl, raw.link),
      source: firstString(raw.source, raw.provider, nested(raw.ref, "kind")),
    });
  });
  return out;
}

export type IntakeSummary = {
  considered: number;
  pursued: number;
  watched: number;
  dropped: number;
  pursue: string[];
  watch: string[];
  drop: string[];
};

/** Group triaged candidates by decision — the funnel's receipt. */
export function intakeSummary(candidates: TriagedCandidate[]): IntakeSummary {
  const pursue: string[] = [];
  const watch: string[] = [];
  const drop: string[] = [];
  for (const c of candidates) {
    if (c.decision === "pursue") pursue.push(c.id);
    else if (c.decision === "watch") watch.push(c.id);
    else drop.push(c.id);
  }
  return {
    considered: candidates.length,
    pursued: pursue.length,
    watched: watch.length,
    dropped: drop.length,
    pursue,
    watch,
    drop,
  };
}

/** Normalize items, then triage them with Jev in one request. */
export async function triageIntake(
  items: IntakeItem[],
  ctx: TriageContext = {},
): Promise<{ candidates: TriagedCandidate[]; summary: IntakeSummary }> {
  const candidates = toCandidates(items);
  const triaged = await triageCandidates(candidates, ctx);
  return { candidates: triaged, summary: intakeSummary(triaged) };
}

/** Only the candidates worth continuing (drop + watch are filtered out). */
export function pursued(candidates: TriagedCandidate[]): TriagedCandidate[] {
  return candidates.filter((c) => c.decision === "pursue");
}
