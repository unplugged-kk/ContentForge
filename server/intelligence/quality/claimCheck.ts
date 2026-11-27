/**
 * Deterministic Claim-to-Evidence & Paraphrase Auditor (INC-07).
 *
 * Pure, offline, zero-network, zero-model analyzer. Inspects generated
 * Artifact payloads against supplied research evidence and optional creator
 * first-hand notes to produce `claim_evidence_v1` attribution records.
 */

import { getFormatProfile } from "../../content/formatProfiles";
import { extractBody } from "../../content/learning/edit";
import type { JsonRecord } from "../../content/storage";
import { xUnitBudgetAt } from "../../social/xTextLimits";
import { computeQualitySignals } from "./signals";

export type ClaimStatus = "supported" | "unsupported" | "opinion";

export interface ModelClaimInput {
  unitIndex: number;
  claimText: string;
  evidenceIds: number[];
  status?: string;
}

export interface AuditedClaim {
  unitIndex: number;
  claimText: string;
  evidenceIds: number[];
  status: ClaimStatus;
  reason?: string;
}

export interface ClaimEvidenceAttribution {
  kind: "claim_evidence_v1";
  researchJobId: number | null;
  evidenceIds: number[];
  claims: AuditedClaim[];
  unsupportedCount: number;
  paraphraseOverlap: number;
  qualityFlags: string[];
}

export interface AuditArtifactClaimsInput {
  format: string;
  channel: string;
  payload: JsonRecord;
  researchJobId?: number | null;
  evidence: Array<{ id: number; text: string }>;
  creatorNotes?: string | null;
  modelClaims?: ModelClaimInput[];
}

const PARAPHRASE_HEAVY_THRESHOLD = 0.35;

const CONCRETE_NUMBER_PATTERN =
  /(?:[$€£]\s?\d+(?:[.,]\d+)?(?:\s?[kmbKMB]\b)?|\b\d+(?:[.,]\d+)?%|\b\d+(?:[.,]\d+)?x\b|\b\d+(?:[.,]\d+)?\s?(?:ms|sec|secs|seconds|min|mins|minutes|hr|hrs|hours|kb|mb|gb|tb|pb|rps|qps|tps|ops|k|m|b)\b|\b(?:19|20)\d{2}\b)/gi;

const PERCENT_WORDS_PATTERN = /\b(\d+(?:[.,]\d+)?)\s+percent\b/gi;

const FIRST_PERSON_WAR_STORY_PATTERNS: RegExp[] = [
  /\b(?:in our|during our|after our|at our)\s+(?:production|prod|last|recent|company|org|cluster)\b/i,
  /\b(?:in our|during our|after our)\s+(?:outage|incident|migration|deploy|deployment|postmortem)\b/i,
  /\b(?:we|i|my team|our team)\s+(?:migrated|measured|cut|reduced|dropped|saved|built|ran|hit|suffered|saw|benchmarked|deployed|switched|debugged)\b/i,
  /\b(?:my team|our team|our production|our prod|our outage|in my experience)\b/i,
];

function wordTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function fourGrams(text: string): Set<string> {
  const words = wordTokens(text);
  const grams = new Set<string>();
  for (let i = 0; i + 3 < words.length; i += 1) {
    grams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]} ${words[i + 3]}`);
  }
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((gram) => {
    if (b.has(gram)) inter += 1;
  });
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function normalizeNumericToken(raw: string): string {
  return raw.toLowerCase().replace(/[\s,]+/g, "");
}

function extractNumericTokens(text: string): string[] {
  const found: string[] = [];
  const matches = text.match(CONCRETE_NUMBER_PATTERN) ?? [];
  for (const m of matches) {
    found.push(normalizeNumericToken(m));
  }
  let pctMatch: RegExpExecArray | null;
  PERCENT_WORDS_PATTERN.lastIndex = 0;
  while ((pctMatch = PERCENT_WORDS_PATTERN.exec(text)) !== null) {
    found.push(`${normalizeNumericToken(pctMatch[1])}%`);
  }
  return Array.from(new Set(found));
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9%$€£]+/g, " ").trim();
}

function claimMatchesSentence(claimText: string, sentence: string): boolean {
  const a = normalizeForMatch(claimText);
  const b = normalizeForMatch(sentence);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function hasFirstPersonWarStory(sentence: string): boolean {
  return FIRST_PERSON_WAR_STORY_PATTERNS.some((pattern) => pattern.test(sentence));
}

/**
 * Compute max 4-gram Jaccard overlap between generated text and any single
 * source evidence excerpt.
 */
export function computeParaphraseOverlap(
  generatedText: string,
  evidence: ReadonlyArray<{ id: number; text: string }>,
): number {
  const genGrams = fourGrams(generatedText);
  if (genGrams.size === 0 || evidence.length === 0) return 0;
  let max = 0;
  for (const item of evidence) {
    const score = jaccard(genGrams, fourGrams(item.text));
    if (score > max) max = score;
  }
  return Number(max.toFixed(4));
}

/**
 * Audit generated Artifact content against supplied research evidence and
 * optional creator notes. Pure, deterministic, offline.
 */
export function auditArtifactClaims(
  input: AuditArtifactClaimsInput,
): ClaimEvidenceAttribution {
  const body = extractBody(input.payload);
  const profile = getFormatProfile(input.format, input.channel);
  const isSequential = Boolean(profile?.constraints?.sequential || input.format === "x_thread");

  const signals = computeQualitySignals(
    {
      text: body.text,
      units: body.units,
      hook: body.hook,
      cta: body.cta,
    },
    isSequential
      ? { ...profile?.constraints, maxCharacters: undefined }
      : profile?.constraints,
  );

  const flagSet = new Set<string>(signals.flags);

  // Per-unit ceiling check for sequential formats (e.g. x_thread).
  if (isSequential && body.units.length > 0) {
    const unitCap = profile?.constraints?.maxCharacters;
    for (let i = 0; i < body.units.length; i += 1) {
      const budget =
        input.channel === "x"
          ? xUnitBudgetAt(i, body.units.length)
          : (unitCap ?? Infinity);
      if (body.units[i].trim().length > budget) {
        flagSet.add("over_limit");
        break;
      }
    }
  }

  const paraphraseOverlap = computeParaphraseOverlap(body.text, input.evidence);
  if (paraphraseOverlap >= PARAPHRASE_HEAVY_THRESHOLD) {
    flagSet.add("paraphrase_heavy");
  }

  const validEvidenceIds = new Set(input.evidence.map((e) => e.id));
  const numbersByEvidenceId = new Map<number, Set<string>>();
  const allEvidenceNumbers = new Set<string>();
  for (const item of input.evidence) {
    const nums = new Set(extractNumericTokens(item.text));
    numbersByEvidenceId.set(item.id, nums);
    nums.forEach((n) => allEvidenceNumbers.add(n));
  }

  const hasCreatorNotes = Boolean(input.creatorNotes && input.creatorNotes.trim().length > 0);
  const creatorNotesNumbers = new Set(
    hasCreatorNotes ? extractNumericTokens(input.creatorNotes!) : [],
  );

  const claims: AuditedClaim[] = [];

  // 1. Validate model-reported claims against real supplied evidence IDs and numbers.
  for (const mc of input.modelClaims ?? []) {
    const claimText = String(mc.claimText ?? "").trim();
    if (!claimText) continue;
    const rawIds = Array.isArray(mc.evidenceIds) ? mc.evidenceIds : [];
    const validIds = Array.from(new Set(rawIds.filter((id) => validEvidenceIds.has(id))));
    const hadFabricated = rawIds.some((id) => !validEvidenceIds.has(id));
    const unitIndex = Number.isInteger(mc.unitIndex) && mc.unitIndex >= 0 ? mc.unitIndex : 0;

    if (mc.status === "opinion" && !hadFabricated) {
      claims.push({
        unitIndex,
        claimText,
        evidenceIds: validIds,
        status: "opinion",
      });
      continue;
    }

    if (validIds.length === 0) {
      claims.push({
        unitIndex,
        claimText,
        evidenceIds: [],
        status: "unsupported",
        reason: hadFabricated
          ? "fabricated evidence reference"
          : "missing supporting evidence",
      });
      continue;
    }

    const claimNumbers = extractNumericTokens(claimText);
    const missingNumbers = claimNumbers.filter((n) => {
      if (creatorNotesNumbers.has(n)) return false;
      return !validIds.some((id) => numbersByEvidenceId.get(id)?.has(n));
    });

    if (missingNumbers.length > 0) {
      claims.push({
        unitIndex,
        claimText,
        evidenceIds: validIds,
        status: "unsupported",
        reason: `uncited metric/number: ${missingNumbers.join(", ")}`,
      });
      continue;
    }

    claims.push({
      unitIndex,
      claimText,
      evidenceIds: validIds,
      status: "supported",
    });
  }

  // 2. Scan generated units for concrete numeric claims and ungrounded first-person war stories.
  for (let unitIndex = 0; unitIndex < body.units.length; unitIndex += 1) {
    const sentences = splitSentences(body.units[unitIndex]);
    for (const sentence of sentences) {
      const nums = extractNumericTokens(sentence);
      if (nums.length > 0) {
        const missing = nums.filter(
          (n) => !allEvidenceNumbers.has(n) && !creatorNotesNumbers.has(n),
        );
        const existing = claims.find(
          (c) => c.unitIndex === unitIndex && claimMatchesSentence(c.claimText, sentence),
        );

        if (missing.length > 0) {
          const reason = `uncited metric/number: ${missing.join(", ")}`;
          if (existing) {
            existing.status = "unsupported";
            existing.reason = reason;
          } else {
            claims.push({
              unitIndex,
              claimText: sentence,
              evidenceIds: [],
              status: "unsupported",
              reason,
            });
          }
        } else if (!existing) {
          const matchedEvidenceIds: number[] = [];
          numbersByEvidenceId.forEach((set, id) => {
            if (nums.some((n) => set.has(n))) matchedEvidenceIds.push(id);
          });
          const groundedInCreator = nums.some((n) => creatorNotesNumbers.has(n));
          claims.push({
            unitIndex,
            claimText: sentence,
            evidenceIds: matchedEvidenceIds,
            status: "supported",
            ...(matchedEvidenceIds.length === 0 && groundedInCreator
              ? { reason: "grounded in creator notes" }
              : {}),
          });
        }
      }

      if (!hasCreatorNotes && hasFirstPersonWarStory(sentence)) {
        flagSet.add("ungrounded_first_person");
        const existing = claims.find(
          (c) => c.unitIndex === unitIndex && claimMatchesSentence(c.claimText, sentence),
        );
        if (!existing) {
          claims.push({
            unitIndex,
            claimText: sentence,
            evidenceIds: [],
            status: "unsupported",
            reason: "ungrounded first-person claim without creator notes",
          });
        } else if (existing.status === "supported") {
          existing.status = "unsupported";
          existing.reason = "ungrounded first-person claim without creator notes";
        }
      }
    }
  }

  const unsupportedCount = claims.filter((c) => c.status === "unsupported").length;

  return {
    kind: "claim_evidence_v1",
    researchJobId: input.researchJobId ?? null,
    evidenceIds: input.evidence.map((e) => e.id),
    claims,
    unsupportedCount,
    paraphraseOverlap,
    qualityFlags: Array.from(flagSet),
  };
}
