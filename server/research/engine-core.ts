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

/**
 * How many excerpts one source may contribute (finding F6).
 *
 * Emitting a single clipped excerpt meant a 38,513-character talk reached the
 * post as ~400 characters — about 1% of it — so every later fact was
 * structurally unable to appear. A bounded, spread sample fixes the coverage
 * without turning evidence into a copy of the source.
 */
export const MAX_EVIDENCE_EXCERPTS_PER_SOURCE = 4;

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
 * Bounded excerpt windows for one body (finding F6).
 *
 * A short body yields one window (the previous behaviour, unchanged). A long one
 * yields up to `MAX_EVIDENCE_EXCERPTS_PER_SOURCE` windows, preferring sentence
 * boundaries and spread across the WHOLE body rather than taken from the front —
 * that spread is the point: the opening of a talk is rarely its substance.
 *
 * Deterministic: the same input always yields the same windows in the same
 * order, so evidence hashes and ordering stay stable across runs.
 */
export function excerptWindows(text: string): string[] {
  const normalized = normalizeText(text);
  if (normalized.length === 0) return [];
  if (normalized.length <= MAX_EVIDENCE_EXCERPT_LENGTH) return [normalized];

  const windows: string[] = [];
  let current = "";
  for (const sentence of normalized.split(/(?<=[.!?])\s+/)) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= MAX_EVIDENCE_EXCERPT_LENGTH) {
      current = candidate;
      continue;
    }
    if (current) windows.push(current);
    if (sentence.length > MAX_EVIDENCE_EXCERPT_LENGTH) {
      // A single sentence longer than a window: hard-split it so it is still
      // representable rather than dropped.
      for (let at = 0; at < sentence.length; at += MAX_EVIDENCE_EXCERPT_LENGTH) {
        windows.push(sentence.slice(at, at + MAX_EVIDENCE_EXCERPT_LENGTH));
      }
      current = "";
    } else {
      current = sentence;
    }
  }
  if (current) windows.push(current);

  if (windows.length <= MAX_EVIDENCE_EXCERPTS_PER_SOURCE) return windows;

  const picked: string[] = [];
  const last = windows.length - 1;
  const stride = last / (MAX_EVIDENCE_EXCERPTS_PER_SOURCE - 1);
  for (let n = 0; n < MAX_EVIDENCE_EXCERPTS_PER_SOURCE; n++) {
    const window = windows[Math.round(n * stride)];
    if (window && !picked.includes(window)) picked.push(window);
  }
  return picked;
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
    // One entry per window (F6), not one per source: a long transcript must be
    // represented by more than its opening. Ordering is stable, and each window
    // is pinned by its own hash.
    for (const window of excerptWindows(basis)) {
      const excerpt = clipExcerpt(window);
      if (excerpt.length === 0) continue;

      const excerptHash = hashExcerpt(excerpt);
      // Content-addressed within the job: re-quoting the same passage dedupes.
      if (seen.has(excerptHash)) continue;
      seen.add(excerptHash);

      evidence.push({
        sourceIndex: index,
        kind: "excerpt",
        origin: "sourced",
        excerpt,
        excerptHash,
        retrievedAt: new Date(source.retrievedAt),
      });
    }
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
