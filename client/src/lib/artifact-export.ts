/**
 * Pure helpers for editing artifact payloads without corrupting format-specific
 * schemas (such as `x_thread`) and for copy/export workflows.
 */

export const X_POST_CHAR_BUDGET = 280;

export interface ExportableArtifact {
  id?: number;
  format: string;
  channel: string;
  readiness?: string | null;
  provenance?: string | null;
  payload: Record<string, unknown> | null | undefined;
}

export interface ArtifactExportEvidence {
  id?: number | string;
  text?: string | null;
  claim?: string | null;
  excerpt?: string | null;
  canonicalUrl?: string | null;
  title?: string | null;
}

export interface ArtifactExportContext {
  version?: number;
  storyTitle?: string | null;
  opportunityConcept?: string | null;
  evidence?: readonly ArtifactExportEvidence[];
}

/**
 * Extracts ordered thread units from a payload, handling both string arrays and
 * `{ text }` objects.
 */
export function extractThreadUnits(
  payload: Record<string, unknown> | null | undefined,
): string[] {
  if (!payload) return [];

  if (Array.isArray(payload.units)) {
    return payload.units
      .map((unit) => {
        if (typeof unit === "string") return unit;
        if (unit && typeof unit === "object" && typeof (unit as { text?: unknown }).text === "string") {
          return (unit as { text: string }).text;
        }
        return "";
      })
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
  }

  if (typeof payload.text === "string" && payload.text.trim()) {
    return payload.text
      .split(/\n{2,}/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
  }

  return [];
}

/**
 * Builds a schema-valid payload for POST /api/artifacts/:id/revise.
 *
 * - For `x_thread`: emits strictly `{ units: string[] }` with non-empty trimmed
 *   units so a stray `text` field never corrupts the thread schema.
 * - For single-text formats (`x_post`, `threads_post`, `linkedin_post`, etc.):
 *   updates `text` cleanly while dropping any stray `units`.
 */
export function buildEditedArtifactPayload(
  format: string,
  existingPayload: Record<string, unknown> | null | undefined,
  draftText: string,
  draftUnits?: readonly string[],
): Record<string, unknown> {
  if (format === "x_thread") {
    const rawUnits = draftUnits !== undefined
      ? [...draftUnits]
      : draftText.split(/\n{2,}/);
    const units = rawUnits
      .map((unit) => unit.trim())
      .filter((unit) => unit.length > 0);
    return { units };
  }

  const base: Record<string, unknown> = existingPayload ? { ...existingPayload } : {};
  delete base.units;

  if (
    (format === "image" || format === "thumbnail") &&
    typeof base.caption === "string" &&
    typeof base.text !== "string"
  ) {
    return { ...base, caption: draftText.trim() };
  }

  return { ...base, text: draftText.trim() };
}

/**
 * Formats an artifact into plain copyable text: joins `units` with blank lines
 * for threads or returns the body text/caption for single-unit formats.
 */
export function formatArtifactPlainText(artifact: ExportableArtifact): string {
  const payload = artifact.payload;
  if (!payload) return "";

  if (artifact.format === "x_thread" || Array.isArray(payload.units)) {
    return extractThreadUnits(payload).join("\n\n");
  }

  if (typeof payload.text === "string") return payload.text.trim();
  if (typeof payload.caption === "string") return payload.caption.trim();
  if (typeof payload.body === "string") return payload.body.trim();
  return "";
}

const LEADING_THREAD_NUMBER_RE = /^\d+\s*\/\s*\d+\b/;

/**
 * Formats an artifact as a numbered thread (`1/N ...`), preserving any existing
 * `k/N` prefix on individual units.
 */
export function formatArtifactNumberedThread(artifact: ExportableArtifact): string {
  const payload = artifact.payload;
  if (!payload) return "";

  const units =
    artifact.format === "x_thread" || Array.isArray(payload.units)
      ? extractThreadUnits(payload)
      : (() => {
          const single = formatArtifactPlainText(artifact);
          return single ? [single] : [];
        })();

  if (units.length === 0) return "";
  const total = units.length;

  return units
    .map((unit, index) => {
      if (LEADING_THREAD_NUMBER_RE.test(unit)) {
        return unit;
      }
      return `${index + 1}/${total} ${unit}`;
    })
    .join("\n\n");
}

function formatHumanFormat(format: string): string {
  return format.replace(/_/g, " ");
}

/**
 * Formats an artifact and its provenance/evidence context as standalone Markdown
 * suitable for export-first publishing workflows.
 */
export function formatArtifactMarkdownExport(
  artifact: ExportableArtifact,
  context: ArtifactExportContext = {},
): string {
  const title =
    context.storyTitle?.trim() ||
    context.opportunityConcept?.trim() ||
    `ContentForge ${formatHumanFormat(artifact.format)}`;

  const metaLines: string[] = [
    `- **Channel:** ${artifact.channel}`,
    `- **Format:** ${artifact.format}`,
  ];
  if (context.version != null) {
    metaLines.push(`- **Revision:** v${context.version}`);
  }
  if (artifact.id != null) {
    metaLines.push(`- **Artifact ID:** #${artifact.id}`);
  }
  if (artifact.readiness) {
    metaLines.push(`- **Status:** ${artifact.readiness}`);
  }
  if (context.storyTitle?.trim()) {
    metaLines.push(`- **Story:** ${context.storyTitle.trim()}`);
  }
  if (context.opportunityConcept?.trim()) {
    metaLines.push(`- **Concept:** ${context.opportunityConcept.trim()}`);
  }

  const contentBody =
    artifact.format === "x_thread"
      ? formatArtifactNumberedThread(artifact)
      : formatArtifactPlainText(artifact);

  const evidenceItems = (context.evidence ?? []).filter(
    (item) => Boolean(item.claim || item.text || item.excerpt || item.canonicalUrl || item.title),
  );

  const citationLines =
    evidenceItems.length > 0
      ? evidenceItems.map((item, idx) => {
          const summary = (item.claim || item.text || item.excerpt || item.title || "").trim();
          const label = item.title?.trim() || item.canonicalUrl?.trim() || `Source ${idx + 1}`;
          const link = item.canonicalUrl?.trim()
            ? `[${label}](${item.canonicalUrl.trim()})`
            : label;
          if (summary && summary !== label) {
            return `- ${summary} — ${link}`;
          }
          return `- ${link}`;
        })
      : ["- No cited sources attached."];

  return [
    `# ${title}`,
    "",
    "## Metadata",
    ...metaLines,
    "",
    "## Content",
    "",
    contentBody || "_(Empty content)_",
    "",
    "## Sources & Citations",
    ...citationLines,
    "",
  ].join("\n");
}

/**
 * Generates a clean `.md` filename for downloading an exported artifact.
 */
export function buildArtifactExportFilename(
  artifact: ExportableArtifact,
  context: ArtifactExportContext = {},
): string {
  const rawSlug = (context.storyTitle || context.opportunityConcept || artifact.format || "artifact")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const base = rawSlug || "contentforge-artifact";
  const formatPart = artifact.format.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const versionPart = context.version != null ? `-v${context.version}` : "";
  return `${base}-${formatPart}${versionPart}.md`;
}
