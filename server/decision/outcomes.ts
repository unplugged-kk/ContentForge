/**
 * Outcome attachment — the "actual" half of prediction vs actual.
 *
 * A decision is only worth recording if we later learn whether it was right.
 * This closes the loop from the OTHER end: when performance metrics land for a
 * publication, every decision that fed into it (a publish gate, an opportunity
 * score, a strategy call) gets the observed outcome attached.
 *
 * Two rules keep it honest:
 *   • only metrics the provider actually OBSERVED are recorded — an
 *     `not_available` metric is reported as unavailable, never as a zero,
 *   • the attachment is best-effort. Failing to record an outcome must never
 *     disturb the metrics pipeline it hangs off.
 */

import type { DecisionLedgerPort } from "./ledger";

export interface ObservedMetric {
  metric: string;
  value: number | null;
  availability: string;
}

export interface OutcomeAttachmentDeps {
  ledger: DecisionLedgerPort | null | undefined;
  /** Reads the metrics recorded for one publication. */
  loadMetrics: (publicationId: number) => Promise<ObservedMetric[]>;
}

export interface ObservedOutcome {
  metrics: Record<string, number>;
  unavailableMetrics: string[];
  observedCount: number;
}

/**
 * Turn raw metric rows into a claim we are willing to record. An unobserved
 * metric is listed as unavailable and omitted from `metrics` — it is never
 * coerced to 0, which would make a publication look like it reached nobody.
 */
export function summarizeObservedOutcome(rows: readonly ObservedMetric[]): ObservedOutcome {
  const metrics: Record<string, number> = {};
  const unavailableMetrics: string[] = [];
  for (const row of rows) {
    if (row.availability === "observed" && typeof row.value === "number" && Number.isFinite(row.value)) {
      metrics[row.metric] = row.value;
    } else {
      unavailableMetrics.push(row.metric);
    }
  }
  return { metrics, unavailableMetrics, observedCount: Object.keys(metrics).length };
}

/**
 * Attach a publication's observed outcome to every decision that referenced it.
 * Returns how many ledger rows were updated (0 when there is nothing to attach,
 * or when the ledger is unavailable).
 */
export async function attachPublicationOutcome(
  publicationId: number,
  deps: OutcomeAttachmentDeps,
  at: Date = new Date(),
): Promise<number> {
  if (!deps.ledger) return 0;
  try {
    const rows = await deps.loadMetrics(publicationId);
    const outcome = summarizeObservedOutcome(rows);
    if (outcome.observedCount === 0 && outcome.unavailableMetrics.length === 0) return 0;
    return await deps.ledger.attachOutcomeByRef({ publicationId }, { ...outcome }, at);
  } catch {
    return 0;
  }
}
