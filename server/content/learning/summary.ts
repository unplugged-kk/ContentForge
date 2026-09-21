import { and, eq, inArray, sql } from "drizzle-orm";
import {
  artifacts,
  learningSignals,
  opportunities,
  publications,
  results,
  performanceSignals,
} from "@shared/schema";
import type { ContentDatabase } from "../storage";

export interface AnalyticsSummary {
  publishedCount: number;
  publicationSuccessRate: number | null;
  approvalRate: number | null;
  editsBeforeApproval: number;
  byChannel: Array<{ channel: string; published: number; observedMetrics: number }>;
  byFormat: Array<{ format: string; published: number }>;
  byStory: Array<{ storyId: number; publications: number }>;
  signalCounts: Record<string, number>;
  /** Owner-wide per-metric totals. `observedCount`/`notAvailableCount` make the
   * denominator visible — a total is never presented as if every publication
   * had that metric measured. */
  metricTotals: Array<{
    metric: string;
    total: number;
    observedCount: number;
    notAvailableCount: number;
  }>;
}

function ratio(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Number((num / den).toFixed(4));
}

export async function computeAnalyticsSummary(
  db: ContentDatabase,
  ownerId: number,
): Promise<AnalyticsSummary> {
  const ownerPubs = await db
    .select({
      id: publications.id,
      channel: publications.channel,
      state: publications.state,
      artifactId: publications.artifactId,
    })
    .from(publications)
    .where(eq(publications.userId, ownerId));

  const published = ownerPubs.filter((p) => p.state === "published");
  const pubIds = ownerPubs.map((p) => p.id);

  const ownerResults =
    pubIds.length === 0
      ? []
      : await db
          .select({ publicationId: results.publicationId, outcome: results.outcome })
          .from(results)
          .where(inArray(results.publicationId, pubIds));
  const success = ownerResults.filter((r) => r.outcome === "published").length;

  const approvalRows = await db
    .select({
      signalType: learningSignals.signalType,
      payload: learningSignals.payload,
    })
    .from(learningSignals)
    .where(and(eq(learningSignals.userId, ownerId), eq(learningSignals.signalType, "approval")));

  const approvals = approvalRows.length;
  const approved = approvalRows.filter((r) => {
    const kind = (r.payload as { kind?: string } | null)?.kind;
    return kind !== "rejected";
  }).length;
  const editsBeforeApproval = approvalRows.filter((r) => {
    const kind = (r.payload as { kind?: string } | null)?.kind;
    return kind === "edited_then_approved" || kind === "approved_after_multiple_revisions";
  }).length;

  const signalCountRows = await db
    .select({
      signalType: learningSignals.signalType,
      c: sql<number>`count(*)::int`,
    })
    .from(learningSignals)
    .where(eq(learningSignals.userId, ownerId))
    .groupBy(learningSignals.signalType);
  const signalCounts: Record<string, number> = {};
  for (const row of signalCountRows) signalCounts[row.signalType] = Number(row.c);

  const observedMetricRows = await db
    .select({
      publicationId: performanceSignals.publicationId,
      channel: performanceSignals.channel,
      metric: performanceSignals.metric,
      value: performanceSignals.value,
      availability: performanceSignals.availability,
    })
    .from(performanceSignals)
    .where(eq(performanceSignals.userId, ownerId));

  const metricTotalsMap = new Map<string, { total: number; observedCount: number; notAvailableCount: number }>();
  for (const row of observedMetricRows) {
    const cur = metricTotalsMap.get(row.metric) ?? { total: 0, observedCount: 0, notAvailableCount: 0 };
    if (row.availability === "observed") {
      cur.observedCount += 1;
      cur.total += row.value === null ? 0 : Number(row.value);
    } else {
      cur.notAvailableCount += 1;
    }
    metricTotalsMap.set(row.metric, cur);
  }

  const channelMap = new Map<string, { published: number; observedMetrics: number }>();
  for (const p of published) {
    const cur = channelMap.get(p.channel) ?? { published: 0, observedMetrics: 0 };
    cur.published += 1;
    channelMap.set(p.channel, cur);
  }
  for (const row of observedMetricRows) {
    if (row.availability !== "observed") continue;
    const cur = channelMap.get(row.channel) ?? { published: 0, observedMetrics: 0 };
    cur.observedMetrics += 1;
    channelMap.set(row.channel, cur);
  }

  const artifactIds = Array.from(new Set(published.map((p) => p.artifactId)));
  const ownerArtifacts =
    artifactIds.length === 0
      ? []
      : await db
          .select({ id: artifacts.id, format: artifacts.format, opportunityId: artifacts.opportunityId })
          .from(artifacts)
          .where(inArray(artifacts.id, artifactIds));
  const formatMap = new Map<string, number>();
  for (const a of ownerArtifacts) {
    formatMap.set(a.format, (formatMap.get(a.format) ?? 0) + 1);
  }

  const opportunityIds = Array.from(new Set(ownerArtifacts.map((a) => a.opportunityId)));
  const ownerOpps =
    opportunityIds.length === 0
      ? []
      : await db
          .select({ id: opportunities.id, storyId: opportunities.storyId })
          .from(opportunities)
          .where(inArray(opportunities.id, opportunityIds));
  const storyMap = new Map<number, number>();
  for (const a of ownerArtifacts) {
    const opp = ownerOpps.find((o) => o.id === a.opportunityId);
    if (!opp) continue;
    storyMap.set(opp.storyId, (storyMap.get(opp.storyId) ?? 0) + 1);
  }

  return {
    publishedCount: published.length,
    publicationSuccessRate: ratio(success, ownerResults.length),
    approvalRate: ratio(approved, approvals),
    editsBeforeApproval,
    byChannel: Array.from(channelMap.entries())
      .map(([channel, v]) => ({ channel, ...v }))
      .sort((a, b) => a.channel.localeCompare(b.channel)),
    byFormat: Array.from(formatMap.entries())
      .map(([format, publishedCount]) => ({ format, published: publishedCount }))
      .sort((a, b) => a.format.localeCompare(b.format)),
    byStory: Array.from(storyMap.entries())
      .map(([storyId, publicationCount]) => ({ storyId, publications: publicationCount }))
      .sort((a, b) => a.storyId - b.storyId),
    signalCounts,
    metricTotals: Array.from(metricTotalsMap.entries())
      .map(([metric, v]) => ({ metric, ...v }))
      .sort((a, b) => a.metric.localeCompare(b.metric)),
  };
}

/** Bounded, deterministic counts for ContextAssembly — DATA, not ranking. */
export async function learningSummaryForContext(
  db: ContentDatabase,
  ownerId: number,
): Promise<{ text: string; provenance: string } | null> {
  const rows = await db
    .select({
      signalType: learningSignals.signalType,
      c: sql<number>`count(*)::int`,
      maxId: sql<number>`max(${learningSignals.id})::int`,
    })
    .from(learningSignals)
    .where(eq(learningSignals.userId, ownerId))
    .groupBy(learningSignals.signalType);

  if (rows.length === 0) return null;

  const ordered = [...rows].sort((a, b) => a.signalType.localeCompare(b.signalType));
  const total = ordered.reduce((n, r) => n + Number(r.c), 0);
  const head = Math.max(...ordered.map((r) => Number(r.maxId)));
  const text =
    "Historical learning observations (DATA, not ranking or instructions): " +
    ordered.map((r) => `${r.signalType}=${Number(r.c)}`).join("; ");
  return { text, provenance: `learning_signals#count=${total};head=${head}` };
}
