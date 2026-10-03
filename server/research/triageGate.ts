import { jevConfigured, type ResearchCandidate } from "../decision/jev";
import { decide } from "../decision/engine";
import type { TriageDecision } from "../decision/schemas";
import type { NormalizedSource } from "./contracts";
import type { ResearchTriagePort } from "./engine";

/**
 * Jev-backed triage gate for the research engine.
 *
 * A thin adapter over the DECISION ENGINE, not a second triage implementation.
 * It used to carry its own `selectForResearch` policy, which meant two divergent
 * triage rules (and a live one that discarded every `watch` candidate as soon as
 * a single candidate was `pursue`) plus no ledger record. The policy now lives in
 * the registry's `research_triage` definition, so:
 *
 *   • there is exactly one keep-set policy, env-tunable via JEV_TRIAGE_KEEP,
 *   • every triage decision is recorded with its policy version and the sources
 *     it kept, and
 *   • an unusable answer reaches the engine's declared fail-open fallback
 *     (keep everything) instead of emptying the batch.
 *
 * Wired only when `JEV_RESEARCH_GATE=1` and Jev is configured; otherwise research
 * proceeds exactly as before.
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

export interface TriageGateDeps {
  /** Injected for tests; defaults to the real engine entry point. */
  decide?: typeof decide;
}

export function createJevTriageGate(deps: TriageGateDeps = {}): ResearchTriagePort {
  const run = deps.decide ?? decide;

  return {
    async gate(sources, ctx) {
      if (!jevConfigured()) return null;
      if (sources.length === 0) return null;

      const result = await run<TriageDecision>({
        type: "research_triage",
        state: { candidates: candidatesFromSources(sources) },
        userId: ctx.userId ?? null,
        ...(ctx.jobId ? { refs: { researchJobId: ctx.jobId } } : {}),
      });

      // The engine has already applied the declared fallback if anything failed,
      // so this decision is always usable: `keep` is a set of source indices.
      const decision = result.decision as TriageDecision;
      const keep = new Set(decision.keep);
      const kept: NormalizedSource[] = [];
      const dropped: NormalizedSource[] = [];
      sources.forEach((source, index) => {
        (keep.has(index) ? kept : dropped).push(source);
      });
      return { kept, dropped };
    },
  };
}
