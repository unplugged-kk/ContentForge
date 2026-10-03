/**
 * Framing — a thin adapter over the `format_select` decision.
 *
 * The decision itself (which of a policy's allowed format × channel pairs to
 * generate) lives in `decision/decisions/format.ts`, so it carries a policy
 * version and lands in the ledger like every other decision. This file only maps
 * the automation layer's input onto the decision's state and back:
 *
 *   policy targets ──▶ state.targets ──▶ decide("format_select") ──▶ kept subset
 *
 * Narrow-only by construction (the state carries the allowed pairs and the
 * decision can only filter them) and fail-open (an outage returns the policy's
 * targets untouched). An absent flag ⇒ this port is not wired at all.
 */

import { decide } from "../decision/engine";
import { framingChannels } from "../decision/decisions/format";
import { decisionTypeEnabled } from "../decision/policies";
import type { FormatSelectDecision } from "../decision/schemas";

export type FramingTarget = { format: string; channel: string };

export interface FramingInput {
  storyTitle: string;
  insightBody: string;
  targets: FramingTarget[];
  /** Attributed to the automation run that asked, when there is one. */
  runId?: number;
  /** The owner the decision belongs to, so the ledger can be owner-scoped. */
  userId?: number | null;
}

export interface FramingPort {
  /** The subset of `targets` to generate, or null to keep every target. */
  selectTargets(input: FramingInput): Promise<FramingTarget[] | null>;
}

/** Present only when the decision layer and JEV_FRAMING are both on. */
export function framingEnabled(): boolean {
  return decisionTypeEnabled("format_select");
}

export interface FramingDeps {
  /** Injected for tests; defaults to the real engine entry point. */
  decide?: typeof decide;
}

function dedupe(targets: readonly FramingTarget[]): FramingTarget[] {
  const seen = new Set<string>();
  const out: FramingTarget[] = [];
  for (const target of targets) {
    const key = `${target.channel}::${target.format}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ channel: target.channel, format: target.format });
  }
  return out;
}

export function createJevFraming(deps: FramingDeps = {}): FramingPort {
  const run = deps.decide ?? decide;

  return {
    async selectTargets(input: FramingInput): Promise<FramingTarget[] | null> {
      const targets = dedupe(input.targets);
      // No channel offers a genuine choice: don't spend a call (or a ledger row)
      // deciding something that is already decided.
      if (framingChannels(targets).length === 0) return null;

      const result = await run<FormatSelectDecision>({
        type: "format_select",
        state: {
          // The story context Jev judges against (bounded by normalizeState).
          topic: { title: input.storyTitle, query: input.insightBody },
          targets,
        },
        userId: input.userId ?? null,
        ...(input.runId ? { refs: { automationRunId: input.runId } } : {}),
      });

      const decision = result.decision as FormatSelectDecision;
      const keptKeys = new Set(decision.kept.map((t) => `${t.channel}::${t.format}`));
      const kept = targets.filter((t) => keptKeys.has(`${t.channel}::${t.format}`));
      return kept.length > 0 ? kept : null;
    },
  };
}
