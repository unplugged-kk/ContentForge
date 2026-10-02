/**
 * Decision definitions — research family.
 *
 * `research_triage`: which discovered sources survive to become evidence. The
 * model supplies signals; the verdict and the composite score stay in code
 * (`triageScore` / `decideTriage`), and the keep-set policy is a declared,
 * env-tunable one rather than an accident of the batch.
 *
 * `research_depth`: how far a run should go. One bounded `choice` question —
 * note Jev's verified contract: `instructions` is a STRING and `criteria` is an
 * OBJECT whose KEYS are the options.
 */

import {
  buildTriageQuestions as buildSignalQuestions,
  decideTriage,
  TRIAGE_SIGNAL_KEYS,
  triageScore,
  type JevQuestion,
  type JevResponse,
  type TriageSignals,
} from "../jev";
import { triageKeepPolicy } from "../policies";
import type { DecisionBuildInput, DecisionDefinition, DecisionOutcome } from "../registry";
import { DEPTHS, type ResearchDepthDecision, type TriageDecision, type TriageVerdict } from "../schemas";

function candidateSignals(response: JevResponse, index: number): TriageSignals {
  const signals = {} as TriageSignals;
  for (const key of TRIAGE_SIGNAL_KEYS) {
    const answer = response.answers[`c${index}__${key}`];
    // A non-finite or missing signal is treated as zero: a malformed answer must
    // never poison the composite score (NaN would silently propagate).
    const value = answer && answer.type === "noul" ? answer.noul : 0;
    signals[key] = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  }
  return signals;
}

/** Whether Jev returned at least one usable signal for this candidate. */
function hasUsableSignals(response: JevResponse, index: number): boolean {
  return TRIAGE_SIGNAL_KEYS.some((key) => {
    const answer = response.answers[`c${index}__${key}`];
    return Boolean(answer && answer.type === "noul" && Number.isFinite(answer.noul));
  });
}

export const researchTriageDefinition: DecisionDefinition<TriageDecision> = {
  type: "research_triage",

  buildQuestions(input: DecisionBuildInput) {
    const candidates = input.state.candidates ?? [];
    if (candidates.length === 0) return {};

    const base = buildSignalQuestions();
    const questions: Record<string, JevQuestion> = {};
    candidates.forEach((candidate, index) => {
      for (const key of TRIAGE_SIGNAL_KEYS) {
        // Each question carries ITS candidate — otherwise Jev judges the whole
        // state and every candidate gets the same answer.
        questions[`c${index}__${key}`] = {
          ...base[key],
          instructions: { candidate, question: base[key].instructions as string },
        };
      }
    });
    return questions;
  },

  parse(input: DecisionBuildInput, response: JevResponse): DecisionOutcome<TriageDecision> {
    const candidates = input.state.candidates ?? [];
    const keepPolicy = triageKeepPolicy();
    const perCandidate: TriageDecision["perCandidate"] = [];
    const keep: number[] = [];
    const drop: number[] = [];
    let scoreSum = 0;
    let answered = 0;

    candidates.forEach((_candidate, index) => {
      // A candidate Jev did not answer for is KEPT unjudged: this policy is
      // fail-open, so a missing answer must never drop a source.
      if (!hasUsableSignals(response, index)) {
        keep.push(index);
        return;
      }
      answered += 1;
      const signals = candidateSignals(response, index);
      const score = triageScore(signals);
      const verdict: TriageVerdict = decideTriage(signals);
      scoreSum += score;
      perCandidate.push({ index, score: Number(score.toFixed(4)), decision: verdict });
      const survives =
        verdict === "pursue" || (keepPolicy === "pursue+watch" && verdict === "watch");
      if (survives) keep.push(index);
      else drop.push(index);
    });

    // An answer nobody can read is not "drop everything": this policy is
    // fail-open, so an unusable response must reach the fallback (keep all)
    // rather than silently emptying the batch.
    if (candidates.length > 0 && answered === 0) throw new Error("JEV_NO_TRIAGE_SIGNALS");

    return {
      decision: { action: keep.length > 0 ? "proceed" : "skip", keep, drop, perCandidate },
      confidence: answered > 0 ? Number((scoreSum / answered).toFixed(4)) : 0,
      reasons: [`kept ${keep.length} of ${candidates.length} candidate(s) under "${keepPolicy}"`],
    };
  },

  /** Fail-open: an outage keeps every candidate (never over-block research). */
  fallback(input: DecisionBuildInput) {
    const all = (input.state.candidates ?? []).map((_candidate, index) => index);
    return {
      action: all.length > 0 ? ("proceed" as const) : ("skip" as const),
      keep: all,
      drop: [],
      perCandidate: [],
    };
  },
};

const DEPTH_CRITERIA: Record<string, string> = {
  quick: "a fast, low-cost pass — a handful of sources, one query",
  standard: "the usual depth — several sources and a couple of query variants",
  deep: "expensive deep research — many sources, several query variants, more evidence",
};

function isDepth(value: string): value is ResearchDepthDecision["depth"] {
  return (DEPTHS as readonly string[]).includes(value);
}

export const researchDepthDefinition: DecisionDefinition<ResearchDepthDecision> = {
  type: "research_depth",

  buildQuestions(input: DecisionBuildInput) {
    const requested = input.state.requestedDepth;
    return {
      depth: {
        type: "choice",
        instructions:
          `How deep should this research run go?` +
          (requested ? ` The caller requested "${requested}" — confirm or override it.` : ""),
        criteria: DEPTH_CRITERIA,
      },
    };
  },

  parse(_input: DecisionBuildInput, response: JevResponse): DecisionOutcome<ResearchDepthDecision> {
    const answer = response.answers.depth;
    const choice = answer && answer.type === "choice" ? answer.choice.trim().toLowerCase() : "";
    if (!isDepth(choice)) throw new Error(`JEV_UNUSABLE_DEPTH:${choice || "empty"}`);
    return {
      decision: { depth: choice },
      confidence: answer && answer.type === "choice" ? answer.confidence : undefined,
      reasons: [`depth "${choice}"`],
    };
  },

  /** Deterministic: honour the caller's request, else the standard budget. */
  fallback(input: DecisionBuildInput) {
    return { depth: input.state.requestedDepth ?? "standard" };
  },
};
