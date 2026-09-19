/**
 * Insights and Learning UX domain helpers (Phase 28.2G).
 *
 * Pure logic — zero React dependencies.
 * Governed by the critical rule:
 * "Insights should answer: What happened, and what should I understand from it?
 * It should NOT pretend to answer: What will definitely work next?
 * Avoid certainty language unless supported by actual evidence.
 * not_available metrics must never be coerced into 0."
 */

export interface MetricTotal {
  metric: string;
  total: number;
  observedCount: number;
  notAvailableCount: number;
}

/**
 * Formats a metric count honestly.
 * If availability is 'not_available', returns "—" and never falsely reports 0.
 */
export function formatMetricValue(
  value: number | null | undefined,
  availability?: "observed" | "not_available" | string,
): string {
  if (availability === "not_available") {
    return "—";
  }
  if (value === null || value === undefined || isNaN(value)) {
    return "—";
  }
  return value.toLocaleString();
}

/**
 * Formats a fractional rate (e.g. 0.857) as a percentage (85.7%).
 * Returns "—" if not computable.
 */
export function formatMetricRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || isNaN(rate)) {
    return "—";
  }
  return `${(rate * 100).toFixed(1)}%`;
}

export type ConfidenceTier = {
  label: "Strong signal" | "Emerging pattern" | "Limited evidence" | "Insufficient data";
  variant: "success" | "warning" | "outline" | "secondary";
};

/**
 * Humanizes confidence without arbitrary percentage precision.
 * Distinguishes strong signals, emerging patterns, limited evidence, and insufficient data.
 */
export function humanizeConfidence(
  confidence: string | number | null | undefined,
): ConfidenceTier {
  if (typeof confidence === "number") {
    if (confidence >= 0.75) return { label: "Strong signal", variant: "success" };
    if (confidence >= 0.4) return { label: "Emerging pattern", variant: "warning" };
    if (confidence > 0) return { label: "Limited evidence", variant: "outline" };
    return { label: "Insufficient data", variant: "secondary" };
  }

  if (typeof confidence === "string") {
    const lower = confidence.toLowerCase();
    if (lower === "high" || lower === "strong") return { label: "Strong signal", variant: "success" };
    if (lower === "medium" || lower === "moderate") return { label: "Emerging pattern", variant: "warning" };
    if (lower === "low" || lower === "weak") return { label: "Limited evidence", variant: "outline" };
  }

  return { label: "Insufficient data", variant: "secondary" };
}

/**
 * Formats a date window label with context.
 */
export function formatDateWindow(window?: string | number | null | undefined): string {
  if (!window || String(window).toLowerCase() === "all") return "All time (lifetime of published content)";
  const str = String(window).toLowerCase();
  if (str === "7" || str === "7d") return "Last 7 days";
  if (str === "30" || str === "30d") return "Last 30 days";
  if (str === "90" || str === "90d") return "Last 90 days";
  if (str === "all") return "All time";
  return `Window: ${window}`;
}

/**
 * Builds evidence-based provenance text for style observations.
 * Strictly observational: "Observed in N analyzed references", never "ContentForge knows...".
 */
export function formatStyleProvenance(sampleCount?: number | null): string {
  if (typeof sampleCount === "number" && sampleCount > 0) {
    return `Observed in ${sampleCount} analyzed ${sampleCount === 1 ? "reference" : "references"}`;
  }
  return "Observed from style reference analysis";
}

/**
 * Formats a channel name for clean display.
 */
export function formatChannelName(channel: string): string {
  const map: Record<string, string> = {
    x: "X (Twitter)",
    linkedin: "LinkedIn",
    youtube: "YouTube",
    threads: "Threads",
    instagram: "Instagram",
  };
  return map[channel.toLowerCase()] || channel;
}

/**
 * Formats content format key for clean display.
 */
export function formatContentType(format: string): string {
  const map: Record<string, string> = {
    x_post: "X Post",
    x_thread: "X Thread",
    linkedin_post: "LinkedIn Post",
    youtube_video: "YouTube Video",
    article: "Article",
    carousel: "Carousel",
  };
  return map[format.toLowerCase()] || format.replace(/_/g, " ");
}

/**
 * Canonical handoff URL to Review an artifact in Studio.
 */
export function getCanonicalReviewUrl(artifactId: number): string {
  return `/create?artifact=${artifactId}`;
}

/**
 * Canonical handoff URL to explore a topic in Sources.
 */
export function getExploreTopicUrl(topic: string): string {
  return `/sources?query=${encodeURIComponent(topic)}`;
}

/**
 * Canonical handoff URL to ask Agent about an observed pattern.
 */
export function getAskAgentUrl(prompt?: string): string {
  if (!prompt) return "/agent";
  return `/agent?prompt=${encodeURIComponent(prompt)}`;
}

/**
 * Resolves the active Insights view from query search param.
 */
export function resolveInsightsTab(
  searchParam: string | null | undefined,
): "performance" | "learning" | "ai-usage" {
  if (!searchParam) return "performance";
  const lower = searchParam.toLowerCase();
  if (lower === "learning") return "learning";
  if (lower === "ai-usage" || lower === "usage" || lower === "cost") return "ai-usage";
  return "performance";
}
