import { jevConfigured, type ResearchCandidate, type TriagedCandidate } from "../decision/jev";
import { triageCandidates } from "../decision/jev";
import type { NormalizedSource } from "./contracts";
import type { ResearchTriagePort } from "./engine";

/**
 * Jev-backed triage gate for the research engine.
 *
 * After providers are collected/deduped/windowed and BEFORE evidence derivation,
 * the gate asks Jev which sources are worth pursuing and drops the rest, so deep
 * analysis only runs on what matters. Wired only when `JEV_RESEARCH_GATE=1` and
 * Jev is configured; otherwise research proceeds exactly as before.
 */

/** 1:1 source → candidate mapping (index ids, so results map back by position). */
export function candidatesFromSources(sources: NormalizedSource[]): ResearchCandidate[] {
  return sources.map((source, index) => ({
    id: `s${index}`,
    title: (source.title ?? source.excerpt ?? source.canonicalUrl ?? `source-${index}`).slice(0, 200),
    summary: source.excerpt ?? undefined,
    url: source.canonicalUrl,
    source: source.ref?.kind ?? source.provider,
  }));
}

/**
 * The gate's policy, pure and testable: keep `pursue`; if none, keep `watch`;
 * if neither, keep nothing.
 */
export function selectForResearch(triaged: TriagedCandidate[]): TriagedCandidate[] {
  const pursue = triaged.filter((c) => c.decision === "pursue");
  if (pursue.length > 0) return pursue;
  return triaged.filter((c) => c.decision === "watch");
}

export type TriageFn = (candidates: ResearchCandidate[]) => Promise<TriagedCandidate[]>;

export function createJevTriageGate(options: { triage?: TriageFn } = {}): ResearchTriagePort {
  const triage: TriageFn = options.triage ?? ((candidates) => triageCandidates(candidates));

  return {
    async gate(sources, _ctx) {
      if (!jevConfigured()) return null;
      if (sources.length === 0) return null;

      const candidates = candidatesFromSources(sources);
      const triaged = await triage(candidates);
      const keepIds = new Set(selectForResearch(triaged).map((c) => c.id));

      const kept: NormalizedSource[] = [];
      const dropped: NormalizedSource[] = [];
      sources.forEach((source, index) => {
        (keepIds.has(`s${index}`) ? kept : dropped).push(source);
      });
      return { kept, dropped };
    },
  };
}
