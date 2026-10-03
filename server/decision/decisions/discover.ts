/**
 * Decision definition — `discover_rank` (JC-02), shadow only.
 *
 * The legacy discover refresh makes ONE large model call that transforms ~30 raw
 * trending items into 20 ranked ideas. That is a synthesis step plus a selection
 * step fused together, which is why this shadow does not pretend to reproduce it:
 * it records, per raw item, how much the decision layer would rate the item's
 * relevance and novelty, and which items it would promote.
 *
 * The comparison is therefore post-hoc (Jev's promoted indices sit in the ledger;
 * the model's chosen ideas are durable in `discovered_ideas`), which is exactly
 * what the plan means by "shadow-run, then compare with a golden set".
 *
 * Nothing acts on this. It is a record.
 */

import type { JevQuestion, JevResponse } from "../jev";
import type { DecisionBuildInput, DecisionDefinition, DecisionOutcome } from "../registry";
import type { DiscoverRankDecision } from "../schemas";

/** A bounded request: 2 questions per item, so the batch stays reasonable. */
export const MAX_RANK_ITEMS = 20;

/** Relevance and novelty weigh equally; promotion needs a clear majority. */
export const PROMOTE_THRESHOLD = 0.5;

const QUESTIONS = {
  relevance: "Is this item relevant to a senior infrastructure/AI engineering audience?",
  novelty: "Is this item new rather than a rehash of something well known?",
} as const;

export const discoverRankDefinition: DecisionDefinition<DiscoverRankDecision> = {
  type: "discover_rank",

  buildQuestions(input: DecisionBuildInput) {
    const items = (input.state.candidates ?? []).slice(0, MAX_RANK_ITEMS);
    const questions: Record<string, JevQuestion> = {};
    items.forEach((item, index) => {
      for (const [signal, instructions] of Object.entries(QUESTIONS)) {
        questions[`i${index}_${signal}`] = {
          type: "noul",
          instructions: { item, question: instructions },
        };
      }
    });
    return questions;
  },

  parse(input: DecisionBuildInput, response: JevResponse): DecisionOutcome<DiscoverRankDecision> {
    const items = (input.state.candidates ?? []).slice(0, MAX_RANK_ITEMS);
    const promoted: number[] = [];
    const perItem: DiscoverRankDecision["perItem"] = [];

    items.forEach((_item, index) => {
      const relevance = response.answers[`i${index}_relevance`];
      const novelty = response.answers[`i${index}_novelty`];
      const values: number[] = [];
      for (const answer of [relevance, novelty]) {
        if (answer && answer.type === "noul" && Number.isFinite(answer.noul)) {
          values.push(Math.min(1, Math.max(0, answer.noul)));
        }
      }
      if (values.length === 0) return;
      const score = Number((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(4));
      perItem.push({ index, score });
      if (score >= PROMOTE_THRESHOLD) promoted.push(index);
    });

    // An unreadable answer is not "promote nothing": reach the fallback.
    if (perItem.length === 0) throw new Error("JEV_NO_RANK_SIGNALS");

    const signals: Record<string, unknown> = { considered: perItem.length };
    // The legacy call's own count travels in the state flags so one ledger row
    // holds both sides of the comparison.
    const legacy = (input.state.quality?.flags ?? []).find((flag) => flag.startsWith("legacy:"));
    if (legacy) signals.legacy = legacy;

    return {
      decision: { promoted, perItem },
      confidence: Number((promoted.length / perItem.length).toFixed(4)),
      reasons: [`would promote ${promoted.length} of ${perItem.length} item(s)`],
      signals,
    };
  },

  /** No signals, no promotion — never a fabricated ranking. */
  fallback(_input: DecisionBuildInput) {
    return { promoted: [], perItem: [] };
  },
};
