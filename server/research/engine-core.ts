/**
 * Pure research-engine logic: dedupe, clustering keys, evidence derivation, and
 * validity. No I/O, no provider specifics — so it can be reasoned about and
 * tested directly.
 *
 * See plans/contentforge-product/RESEARCH-PROVIDERS.md §8, §10, §11.
 */

import { createHash } from "node:crypto";
import type { NormalizedSource, ProviderCallDiagnostics } from "./contracts";
import { normalizeText } from "./normalize";

/** Evidence is a pin, not a copy: excerpts are bounded. */
export const MAX_EVIDENCE_EXCERPT_LENGTH = 400;

export interface DroppedSource {
  ref: NormalizedSource["ref"];
  reason: "duplicate_ref" | "duplicate_url" | "duplicate_content";
  keptRef: NormalizedSource["ref"];
}

export interface DedupeResult {
  kept: NormalizedSource[];
  dropped: DroppedSource[];
}

/** Prefer the richer record when two sources collide. */
function isRicher(candidate: NormalizedSource, incumbent: NormalizedSource): boolean {
  const candidateFull = candidate.content !== undefined;
  const incumbentFull = incumbent.content !== undefined;
  if (candidateFull !== incumbentFull) return candidateFull;
  return (candidate.excerpt?.length ?? 0) > (incumbent.excerpt?.length ?? 0);
}

/**
 * Generic identity ladder (cheapest first): ref → canonical URL → content hash.
 * There is deliberately no per-source duplicate logic.
 */
export function dedupeSources(sources: readonly NormalizedSource[]): DedupeResult {
  const kept: NormalizedSource[] = [];
  const dropped: DroppedSource[] = [];

  const byRef = new Map<string, number>();
  const byUrl = new Map<string, number>();
  const byHash = new Map<string, number>();

  for (const source of sources) {
    const refKey = `${source.ref.provider}::${source.ref.kind}::${source.ref.nativeId}`;
    const urlKey = source.canonicalUrl;
    // Only treat a content hash as an identity when it is not merely the URL
    // fallback (Stage-1 candidates with no body).
    const hasBody = (source.content?.text ?? source.excerpt ?? "").trim().length > 0;
    const hashKey = hasBody ? source.contentHash : null;

    const collision =
      byRef.get(refKey) ?? byUrl.get(urlKey) ?? (hashKey ? byHash.get(hashKey) : undefined);

    if (collision !== undefined) {
      const incumbent = kept[collision];
      dropped.push({
        ref: source.ref,
        reason:
          byRef.get(refKey) === collision
            ? "duplicate_ref"
            : byUrl.get(urlKey) === collision
              ? "duplicate_url"
              : "duplicate_content",
        keptRef: incumbent.ref,
      });
      if (isRicher(source, incumbent)) {
        // Replace in place; identity maps below must follow the winner.
        kept[collision] = source;
        byRef.set(refKey, collision);
        byUrl.set(urlKey, collision);
        if (hashKey) byHash.set(hashKey, collision);
      }
      continue;
    }

    const index = kept.length;
    kept.push(source);
    byRef.set(refKey, index);
    byUrl.set(urlKey, index);
    if (hashKey) byHash.set(hashKey, index);
  }

  return { kept, dropped };
}

export type EvidenceKind = "excerpt" | "author_statement";
export type EvidenceOrigin = "sourced" | "generated";

export interface DerivedEvidence {
  sourceIndex: number | null;
  kind: EvidenceKind;
  origin: EvidenceOrigin;
  excerpt: string;
  excerptHash: string;
  retrievedAt: Date;
}

export function hashExcerpt(excerpt: string): string {
  return createHash("sha256").update(normalizeText(excerpt), "utf8").digest("hex");
}

function clipExcerpt(text: string): string {
  const normalized = normalizeText(text);
  if (normalized.length <= MAX_EVIDENCE_EXCERPT_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_EVIDENCE_EXCERPT_LENGTH)}…`;
}

/**
 * Derive evidence from normalized sources. Providers never create evidence —
 * this is where a source becomes a pinned, hashed quotation.
 */
export function deriveEvidence(sources: readonly NormalizedSource[]): DerivedEvidence[] {
  const evidence: DerivedEvidence[] = [];
  const seen = new Set<string>();

  sources.forEach((source, index) => {
    const basis = source.content?.text ?? source.excerpt ?? source.title ?? "";
    const excerpt = clipExcerpt(basis);
    if (excerpt.length === 0) return;

    const excerptHash = hashExcerpt(excerpt);
    // Content-addressed within the job: re-quoting the same passage dedupes.
    if (seen.has(excerptHash)) return;
    seen.add(excerptHash);

    evidence.push({
      sourceIndex: index,
      kind: "excerpt",
      origin: "sourced",
      excerpt,
      excerptHash,
      retrievedAt: new Date(source.retrievedAt),
    });
  });

  return evidence;
}

/**
 * Human input enters as a first-class evidence item rather than a carve-out,
 * so the "is this research valid?" rule has no branch (Ticket 04 §6).
 */
export function authorStatementEvidence(statement: string, at = new Date()): DerivedEvidence {
  const excerpt = clipExcerpt(statement);
  return {
    sourceIndex: null,
    kind: "author_statement",
    origin: "sourced",
    excerpt,
    excerptHash: hashExcerpt(excerpt),
    retrievedAt: at,
  };
}

export interface ResearchValidity {
  valid: boolean;
  reasons: string[];
}

/**
 * Validity: the job must contain at least one `sourced` evidence item
 * (Ticket 04 §6). Source count is deliberately not part of the rule —
 * `human_input` jobs are valid on an `author_statement` evidence item alone,
 * which is what removes the need for a carve-out.
 */
export function validateResearch(input: {
  sources: readonly NormalizedSource[];
  evidence: readonly DerivedEvidence[];
}): ResearchValidity {
  const reasons: string[] = [];
  const sourced = input.evidence.filter((e) => e.origin === "sourced");

  if (sourced.length === 0) reasons.push("no_sourced_evidence");

  return { valid: reasons.length === 0, reasons };
}

// ── Provider-failure semantics (locked) ──────────────────────────────────────
// Locked Ticket 04 §2 (restated in RESEARCH-PROVIDERS.md §13): provider failures
// degrade to partial results and never fail the job *unless zero sources
// survive*. When zero survive, the job's failure class must reflect WHY:
//
//   Case A — every attempted provider failed            → the job failed too;
//            class = rate_limited | transient | permanent so the queue can
//            retry / reschedule instead of burying a recoverable run in the DLQ.
//   Case B — some providers succeeded (partial research) → job completes and the
//            failed calls are retained as degraded diagnostics.
//   Case C — providers ran but yielded nothing usable    → permanent: the run
//            succeeded and there genuinely is no usable evidence.
export interface CollectionSummary {
  /** Providers actually called (excludes capability `skipped`). */
  attempted: number;
  failed: number;
  ok: number;
  empty: number;
  skipped: number;
  failureClasses: string[];
}

export function summarizeCollection(
  diagnostics: readonly ProviderCallDiagnostics[],
): CollectionSummary {
  const summary: CollectionSummary = {
    attempted: 0,
    failed: 0,
    ok: 0,
    empty: 0,
    skipped: 0,
    failureClasses: [],
  };

  for (const call of diagnostics) {
    if (call.outcome === "skipped") {
      summary.skipped += 1;
      continue;
    }
    summary.attempted += 1;
    if (call.outcome === "failed") {
      summary.failed += 1;
      summary.failureClasses.push(call.failureClass ?? "transient");
    } else if (call.outcome === "empty") {
      summary.empty += 1;
    } else {
      summary.ok += 1;
    }
  }

  return summary;
}

/**
 * Classify a zero-source run. Returns `null` when the caller should fall through
 * to normal validity handling (i.e. not every attempted provider failed → Case C).
 */
export function classifyEmptyCollection(
  summary: CollectionSummary,
): { failureClass: string; message: string } | null {
  if (summary.attempted === 0 || summary.failed < summary.attempted) return null;

  const classes = summary.failureClasses;
  if (classes.length === 0) return null;

  const allRateLimited = classes.every((c) => c === "rate_limited");
  if (allRateLimited) {
    return {
      failureClass: "rate_limited",
      message: `All ${summary.attempted} provider(s) were rate limited; no sources collected`,
    };
  }

  const allTransientish = classes.every((c) => c === "transient" || c === "rate_limited");
  if (allTransientish) {
    return {
      failureClass: "transient",
      message: `All ${summary.attempted} provider(s) failed transiently; no sources collected`,
    };
  }

  return {
    failureClass: "permanent",
    message: `All ${summary.attempted} provider(s) failed; no sources collected`,
  };
}
