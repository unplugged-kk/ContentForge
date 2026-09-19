/**
 * Phase 28.2E: Sources & Research Domain State Helpers
 *
 * Provides pure domain logic for:
 * 1. Truthful research status & degraded provider states
 * 2. Plain-language credibility classification
 * 3. Humanized quality & novelty metrics
 * 4. Honest provider capability & limitation translation (no raw env vars)
 * 5. Time window & depth labeling
 * 6. Downstream handoff URL builders (Create & Story)
 * 7. Untrusted text sanitization & safe rendering
 */

export type CredibilityLevel =
  | "high_confidence"
  | "established"
  | "needs_verification"
  | "conflicting"
  | "unknown";

export interface CredibilityDisplay {
  level: CredibilityLevel;
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  description: string;
}

/**
 * Maps source classifications and corroboration counts into plain user language.
 * Never produces false precision like "87.42 credibility".
 */
export function resolveCredibility(
  sourceClass?: string | null,
  corroborationCount = 1,
  hasConflicts = false,
): CredibilityDisplay {
  if (hasConflicts) {
    return {
      level: "conflicting",
      label: "Conflicting evidence",
      variant: "destructive",
      description: "Sources report conflicting claims — review evidence before using",
    };
  }

  const s = (sourceClass ?? "").toLowerCase();

  if (s.includes("primary") || corroborationCount >= 3) {
    return {
      level: "high_confidence",
      label: "High confidence source",
      variant: "default",
      description: "Primary source or corroborated by 3+ independent sources",
    };
  }

  if (s.includes("established") || s.includes("journalism") || s.includes("academic") || corroborationCount === 2) {
    return {
      level: "established",
      label: "Established source",
      variant: "secondary",
      description: "Recognized publisher or corroborated by multiple reports",
    };
  }

  if (s.includes("social") || s.includes("unverified") || s.includes("community")) {
    return {
      level: "needs_verification",
      label: "Needs verification",
      variant: "outline",
      description: "Community or social source — verify specific claims before publishing",
    };
  }

  return {
    level: "unknown",
    label: "Needs verification",
    variant: "outline",
    description: "Source credibility is unconfirmed",
  };
}

/**
 * Restrained presentation of quality metrics without exposing raw internal scores.
 */
export function humanizeQuality(rawQuality?: string | null): { label: string; level: "high" | "standard" | "preliminary" } {
  const q = (rawQuality ?? "").toLowerCase();
  if (q.includes("high") || q.includes("rich") || q.includes("strong")) {
    return { label: "High Quality", level: "high" };
  }
  if (q.includes("low") || q.includes("sparse") || q.includes("thin")) {
    return { label: "Preliminary", level: "preliminary" };
  }
  return { label: "Standard Quality", level: "standard" };
}

/**
 * Restrained presentation of novelty without exposing raw decimal scores.
 */
export function humanizeNovelty(rawNovelty?: string | null | number): { label: string; isNew: boolean } {
  if (typeof rawNovelty === "number") {
    if (rawNovelty >= 0.7) return { label: "New Angle", isNew: true };
    if (rawNovelty >= 0.4) return { label: "Emerging", isNew: true };
    return { label: "Known Topic", isNew: false };
  }
  const n = (rawNovelty ?? "").toLowerCase();
  if (n.includes("new") || n.includes("novel") || n.includes("high")) {
    return { label: "New Angle", isNew: true };
  }
  if (n.includes("emerging") || n.includes("moderate")) {
    return { label: "Emerging", isNew: true };
  }
  return { label: "Known Topic", isNew: false };
}

export type ResearchRunStatus =
  | "idle"
  | "queued"
  | "running"
  | "complete"
  | "completed_with_warnings"
  | "failed";

export interface ResearchStatusResolution {
  status: ResearchRunStatus;
  label: string;
  isDegraded: boolean;
  degradedReasons: string[];
}

/**
 * Resolves truthful research job status.
 * If some providers failed or were unavailable, flags as "completed_with_warnings" (degraded).
 */
export function resolveResearchStatus(input: {
  jobStatus?: string | null;
  diagnostics?: Array<{ status?: string; error?: string; providerId?: string; reason?: string }> | null;
  warnings?: string[] | null;
  errorMessage?: string | null;
}): ResearchStatusResolution {
  const raw = (input.jobStatus ?? "").toLowerCase();

  if (raw === "failed" || raw === "error" || input.errorMessage) {
    return {
      status: "failed",
      label: "Research failed",
      isDegraded: false,
      degradedReasons: input.errorMessage ? [input.errorMessage] : [],
    };
  }

  if (raw === "running" || raw === "in_progress") {
    return {
      status: "running",
      label: "Researching sources…",
      isDegraded: false,
      degradedReasons: [],
    };
  }

  if (raw === "queued" || raw === "pending") {
    return {
      status: "queued",
      label: "Queued…",
      isDegraded: false,
      degradedReasons: [],
    };
  }

  // Check for degraded provider diagnostics or warnings
  const degradedReasons: string[] = [];
  if (input.warnings && input.warnings.length > 0) {
    degradedReasons.push(...input.warnings);
  }

  if (input.diagnostics && input.diagnostics.length > 0) {
    for (const d of input.diagnostics) {
      const s = (d.status ?? "").toLowerCase();
      if (s === "failed" || s === "degraded" || s === "unavailable" || d.error) {
        const name = d.providerId ? capitalizeProvider(d.providerId) : "Provider";
        degradedReasons.push(`${name} unavailable`);
      }
    }
  }

  const isDegraded = degradedReasons.length > 0;

  if (raw === "complete" || raw === "completed") {
    return {
      status: isDegraded ? "completed_with_warnings" : "complete",
      label: isDegraded ? "Completed with limited sources" : "Research complete",
      isDegraded,
      degradedReasons,
    };
  }

  return {
    status: isDegraded ? "completed_with_warnings" : "complete",
    label: isDegraded ? "Completed with limited sources" : "Complete",
    isDegraded,
    degradedReasons,
  };
}

/**
 * Translates time window preset to human string.
 */
export function formatTimeWindow(preset?: string | null): string {
  switch (preset) {
    case "last_24h":
    case "24h":
    case "today":
      return "Last 24 hours";
    case "last_7d":
    case "7d":
      return "Last 7 days";
    case "last_30d":
    case "30d":
      return "Last 30 days";
    case "custom":
      return "Custom window";
    default:
      return "Recent";
  }
}

/**
 * Translates research depth to human string.
 */
export function formatResearchDepth(depth?: string | null): string {
  switch (depth) {
    case "quick":
      return "Quick";
    case "deep":
      return "Deep";
    default:
      return "Standard";
  }
}

/**
 * Formats relative timestamp or publication date cleanly.
 */
export function formatRelativeTime(dateInput?: string | Date | null): string {
  if (!dateInput) return "Unknown date";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return "Unknown date";

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return "Just now";

  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export interface ProviderLimitation {
  providerId: string;
  name: string;
  available: boolean;
  userMessage: string;
}

/**
 * Translates provider capability payload into friendly, honest limitations without raw env vars.
 */
export function translateProviderLimitations(capabilities?: {
  providers?: Array<{ providerId: string; configured: boolean; available: boolean; reason?: string | null }>;
  last30days?: { configured: boolean; available: boolean; reason?: string | null };
  openseo?: { configured: boolean; available: boolean; reason?: string | null };
}): ProviderLimitation[] {
  if (!capabilities) return [];

  const results: ProviderLimitation[] = [];

  // Check last30days
  if (capabilities.last30days && !capabilities.last30days.available) {
    results.push({
      providerId: "last30days",
      name: "Last 30 days",
      available: false,
      userMessage: "Last 30 days: not enabled",
    });
  }

  // Check OpenSEO
  if (capabilities.openseo && !capabilities.openseo.available) {
    results.push({
      providerId: "openseo",
      name: "SEO Research",
      available: false,
      userMessage: "SEO research: not configured",
    });
  }

  // Check standard providers
  for (const p of capabilities.providers ?? []) {
    if (!p.available || !p.configured) {
      let msg = `${capitalizeProvider(p.providerId)}: unavailable`;
      if (p.providerId === "reddit") {
        msg = "Reddit: credentials not configured";
      } else if (p.providerId === "youtube") {
        msg = "YouTube: metadata search only";
      }
      results.push({
        providerId: p.providerId,
        name: capitalizeProvider(p.providerId),
        available: false,
        userMessage: msg,
      });
    }
  }

  return results;
}

function capitalizeProvider(id: string): string {
  switch (id.toLowerCase()) {
    case "hn":
      return "Hacker News";
    case "rss":
      return "RSS Feeds";
    case "web":
      return "Web Search";
    case "youtube":
      return "YouTube";
    case "reddit":
      return "Reddit";
    case "openseo":
      return "SEO Intelligence";
    default:
      return id.charAt(0).toUpperCase() + id.slice(1);
  }
}

/**
 * Canonical handoff URLs
 */
export function getCreateFromStoryUrl(storyId: number): string {
  return `/create?storyId=${storyId}`;
}

export function getCreateFromIdeaUrl(ideaId: number): string {
  return `/create?ideaId=${ideaId}`;
}

export function getCreateFromSourceUrl(params: { title?: string; url?: string }): string {
  const p = new URLSearchParams();
  if (params.title) p.set("topic", params.title);
  if (params.url) p.set("sourceUrl", params.url);
  return `/create?${p.toString()}`;
}

/**
 * Sanitizes untrusted text from external sources to avoid script injection or invalid HTML.
 */
export function sanitizeUntrustedText(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]*>?/gm, "") // strip HTML tags
    .replace(/\s+/g, " ") // normalize spacing
    .trim();
}
