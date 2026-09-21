/**
 * Unit tests for real-post style intelligence primitives (Phase 11).
 *
 * No I/O: the analyzer registry is deterministic, validation is pure, and
 * the domain services never touch a database directly. DB-backed behavior
 * lives in `style.dbtest.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getStyleAnalyzer,
  hasStyleAnalyzer,
  normalizeAuthoredText,
  registerStyleAnalyzer,
  resetStyleAnalyzers,
  validateStyleObservation,
  InvalidAuthoredContentError,
  InvalidStyleObservationError,
  StyleAnalyzerNotRegisteredError,
} from "./style";
import { JobFailure } from "../jobs/failures";
import {
  renderStylePromptSnippet,
  requestStyleAnalysis,
  runStyleAnalysis,
  styleAnalysisIdempotencyKey,
  ReferenceNotFoundError,
  type StyleServiceDeps,
  type StyleStoragePort,
} from "./styleService";

function validObservation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    confidence: "strong",
    confidenceReason: "consistent hooks and cadence across the sample",
    dimensions: {
      tone: "direct, practitioner-grade",
      sentenceRhythm: "short declarative sentences",
      verbosity: "terse",
      formattingTendencies: "line breaks between ideas",
      punctuationTendencies: "minimal, occasional em dash",
      vocabularyRegister: "technical, no jargon padding",
      hookPatterns: ["opens with a specific number"],
      paragraphStructure: "one idea per line",
      questionUsage: "rare, rhetorical only",
      listUsage: "occasional numbered list",
      emojiTendencies: "none",
      ctaPatterns: ["ends with a direct question"],
      rhetoricalPatterns: ["contrarian framing"],
      recurringTraits: ["specific metrics", "real scenarios"],
    },
    ...overrides,
  };
}

describe("authored content normalization (Ticket 11 §13 — insufficient evidence bar)", () => {
  it("trims and normalizes line endings", () => {
    assert.equal(
      normalizeAuthoredText("  hello there\r\nfriendly world  \r\n"),
      "hello there\nfriendly world",
    );
  });

  it("rejects text too short to say anything meaningful", () => {
    assert.throws(() => normalizeAuthoredText("too short"), InvalidAuthoredContentError);
  });

  it("rejects text over the bound", () => {
    assert.throws(() => normalizeAuthoredText("x".repeat(10_001)), InvalidAuthoredContentError);
  });

  it("accepts text within bounds", () => {
    const text = "This is a perfectly reasonable authored post about platform engineering.";
    assert.equal(normalizeAuthoredText(text), text);
  });
});

describe("structured, bounded observation validation (Ticket 11 §5)", () => {
  it("accepts a well-formed observation", () => {
    const observation = validateStyleObservation(validObservation());
    assert.equal(observation.confidence, "strong");
    assert.equal(observation.dimensions.hookPatterns.length, 1);
  });

  it("rejects an unbounded raw blob instead of structured dimensions", () => {
    assert.throws(
      () => validateStyleObservation({ confidence: "strong", confidenceReason: "x", dimensions: "just a giant paragraph" }),
      InvalidStyleObservationError,
    );
  });

  it("rejects a confidence value outside the documented enum", () => {
    assert.throws(() => validateStyleObservation(validObservation({ confidence: "very-confident" })), InvalidStyleObservationError);
  });

  it("rejects missing dimensions entirely (no partial observation accepted)", () => {
    assert.throws(() => validateStyleObservation({ confidence: "strong", confidenceReason: "x" }), InvalidStyleObservationError);
  });

  it("rejects a dimension list exceeding the bound (never unbounded)", () => {
    const bad = validObservation();
    (bad.dimensions as any).recurringTraits = Array.from({ length: 20 }, (_, i) => `trait ${i}`);
    assert.throws(() => validateStyleObservation(bad), InvalidStyleObservationError);
  });
});

describe("confidence semantics (Ticket 11 §13) — documented, not a magic number", () => {
  it("insufficient is a valid, honest outcome, not an error", () => {
    const observation = validateStyleObservation(
      validObservation({ confidence: "insufficient", confidenceReason: "sample too short to say anything" }),
    );
    assert.equal(observation.confidence, "insufficient");
  });
});

describe("analyzer registry — deterministic selection, never inferred", () => {
  it("is exact-id, unknown refused", () => {
    resetStyleAnalyzers();
    assert.equal(hasStyleAnalyzer("gateway-style"), false);
    registerStyleAnalyzer({
      providerId: "gateway-style",
      providerVersion: "v1",
      analyze: async () => ({ observation: validObservation() as any, model: "m", provider: "gateway-style", usage: {} }),
    });
    assert.equal(hasStyleAnalyzer("gateway-style"), true);
    assert.throws(() => getStyleAnalyzer("nope"), StyleAnalyzerNotRegisteredError);
    resetStyleAnalyzers();
  });
});

describe("style prompt snippet rendering — bounded, deterministic", () => {
  it("renders a compact snippet from the structured observation", () => {
    const observation = validateStyleObservation(validObservation());
    const snippet = renderStylePromptSnippet(observation);
    assert.match(snippet, /Tone: direct/);
    assert.match(snippet, /Hooks: opens with a specific number/);
    assert.ok(snippet.length < 1000);
  });

  it("omits empty list dimensions rather than rendering empty labels", () => {
    const observation = validateStyleObservation(
      validObservation({ dimensions: { ...validObservation().dimensions, hookPatterns: [], ctaPatterns: [], recurringTraits: [] } }),
    );
    const snippet = renderStylePromptSnippet(observation as any);
    assert.ok(!snippet.includes("Hooks:"));
    assert.ok(!snippet.includes("CTAs:"));
  });
});

describe("idempotency key — duplicate delivery vs explicit re-analysis (Ticket 11 §18)", () => {
  it("is stable for the same reference/analyzer/content", () => {
    const input = { referenceId: 7, analyzerVersion: "v1", sourceContentHash: "a".repeat(64) };
    assert.equal(styleAnalysisIdempotencyKey(input), styleAnalysisIdempotencyKey({ ...input }));
  });

  it("distinguishes explicit regeneration from duplicate delivery", () => {
    const input = { referenceId: 7, analyzerVersion: "v1", sourceContentHash: "a".repeat(64) };
    assert.notEqual(
      styleAnalysisIdempotencyKey(input),
      styleAnalysisIdempotencyKey({ ...input, regenerationNonce: "regen-1" }),
    );
  });

  it("changes when the source content changes (a different post is a different analysis)", () => {
    const a = styleAnalysisIdempotencyKey({ referenceId: 7, analyzerVersion: "v1", sourceContentHash: "a".repeat(64) });
    const b = styleAnalysisIdempotencyKey({ referenceId: 7, analyzerVersion: "v1", sourceContentHash: "b".repeat(64) });
    assert.notEqual(a, b);
  });

  it("changes when the analyzer version changes (re-analysis under a new version is distinct history)", () => {
    const a = styleAnalysisIdempotencyKey({ referenceId: 7, analyzerVersion: "v1", sourceContentHash: "a".repeat(64) });
    const b = styleAnalysisIdempotencyKey({ referenceId: 7, analyzerVersion: "v2", sourceContentHash: "a".repeat(64) });
    assert.notEqual(a, b);
  });
});

// ── service-level behavior against an in-memory StyleStoragePort ────────────
function memoryStyleStorage(overrides: Partial<StyleStoragePort> = {}): StyleStoragePort & { profiles: any[]; analyses: any[] } {
  let nextId = 1;
  const references: any[] = [];
  const analyses: any[] = [];
  const profiles: any[] = [];
  const store: StyleStoragePort & { profiles: any[]; analyses: any[] } = {
    profiles,
    analyses,
    async insertReference(row) {
      const ref = { id: nextId++, ...row, createdAt: new Date() };
      references.push(ref);
      return ref;
    },
    async getOwnedReference(id, ownerId) {
      return references.find((r) => r.id === id && r.userId === ownerId);
    },
    async getOwnedReferences(ids, ownerId) {
      return references.filter((r) => ids.includes(r.id) && r.userId === ownerId);
    },
    async listOwnedReferences(ownerId) {
      return references.filter((r) => r.userId === ownerId);
    },
    async claimStyleAnalysis(row) {
      const existing = analyses.find((a) => a.idempotencyKey === row.idempotencyKey);
      if (existing) return { analysis: existing, created: false };
      const analysis = { id: nextId++, attempt: 1, status: "requested", ...row };
      analyses.push(analysis);
      return { analysis, created: true };
    },
    async getStyleAnalysis(id) {
      return analyses.find((a) => a.id === id);
    },
    async markStyleAnalysisRunning(id) {
      const a = analyses.find((x) => x.id === id);
      if (a) a.status = "analyzing";
    },
    async markStyleAnalysisReady(id, attempt) {
      const a = analyses.find((x) => x.id === id);
      if (a) {
        a.status = "ready";
        a.attempt = attempt;
      }
    },
    async markStyleAnalysisFailed(id, failureClass, errorMessage, attempt) {
      const a = analyses.find((x) => x.id === id);
      if (a) {
        a.status = "failed";
        a.errorClass = failureClass;
        a.errorMessage = errorMessage;
        a.attempt = attempt;
      }
    },
    async getLatestStyleProfile(referenceId) {
      const rows = profiles.filter((p) => p.sourceReferenceId === referenceId);
      return rows[rows.length - 1];
    },
    async insertStyleProfile(row) {
      const profile = { id: nextId++, ...row, createdAt: new Date() };
      profiles.push(profile);
      return profile;
    },
    async getStyleProfile(id) {
      return profiles.find((p) => p.id === id);
    },
    async getStyleProfileByAnalysisId(analysisId) {
      return profiles.find((p) => p.analysisId === analysisId);
    },
    async getLatestCorpusProfile(ownerId, sourceContentHash) {
      const rows = profiles.filter((p) => p.userId === ownerId && p.kind === "corpus" && p.sourceContentHash === sourceContentHash);
      return rows[rows.length - 1];
    },
    async listStyleProfiles(ownerId) {
      return profiles.filter((p) => p.userId === ownerId);
    },
    async activateStyleProfile(id, ownerId) {
      const current = profiles.find((p) => p.id === id && p.userId === ownerId);
      if (!current) return undefined;
      for (const p of profiles) {
        if (p.userId === ownerId && p.kind === current.kind) p.isActive = false;
      }
      current.isActive = true;
      return current;
    },
    async insertStyleObservations(rows) {
      return rows.map((row) => ({ id: nextId++, ...row, createdAt: new Date() }));
    },
    async listStyleObservations() {
      return [];
    },
    ...overrides,
  };
  return store;
}

describe("requestStyleAnalysis — owner isolation and validation before any durable row", () => {
  it("rejects a reference that does not belong to the caller", async () => {
    const storage = memoryStyleStorage();
    await storage.insertReference({ userId: 2, rawContent: "a".repeat(50), sourceType: "manual", title: null });
    await assert.rejects(
      () => requestStyleAnalysis(1, { referenceId: 1 }, { storage }),
      ReferenceNotFoundError,
    );
  });

  it("rejects source content too short before any StyleAnalysis row is claimed", async () => {
    const storage = memoryStyleStorage();
    await storage.insertReference({ userId: 1, rawContent: "too short", sourceType: "manual", title: null });
    await assert.rejects(() => requestStyleAnalysis(1, { referenceId: 1 }, { storage }));
    assert.equal(storage.analyses.length, 0, "no analysis row for invalid input");
  });

  it("duplicate delivery of the same request collapses to ONE analysis row", async () => {
    const storage = memoryStyleStorage();
    await storage.insertReference({ userId: 1, rawContent: "a".repeat(50), sourceType: "manual", title: null });
    const first = await requestStyleAnalysis(1, { referenceId: 1 }, { storage });
    const second = await requestStyleAnalysis(1, { referenceId: 1 }, { storage });
    assert.equal(first.analysis.id, second.analysis.id);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(storage.analyses.length, 1);
  });

  it("explicit regenerate produces a DIFFERENT analysis row for the same content", async () => {
    const storage = memoryStyleStorage();
    await storage.insertReference({ userId: 1, rawContent: "a".repeat(50), sourceType: "manual", title: null });
    const first = await requestStyleAnalysis(1, { referenceId: 1 }, { storage });
    const regen = await requestStyleAnalysis(1, { referenceId: 1, regenerate: true }, { storage });
    assert.notEqual(first.analysis.id, regen.analysis.id);
    assert.equal(storage.analyses.length, 2);
  });
});

describe("runStyleAnalysis — invalid output, transient failure, versioning", () => {
  function deps(analyzeImpl: (content: any) => Promise<any>): StyleServiceDeps & { storage: ReturnType<typeof memoryStyleStorage> } {
    resetStyleAnalyzers();
    registerStyleAnalyzer({ providerId: "gateway-style", providerVersion: "v1", analyze: analyzeImpl });
    return { storage: memoryStyleStorage() };
  }

  it("invalid analyzer output fails permanently; no style_profiles row is committed", async () => {
    const d = deps(async () => ({ observation: { confidence: "strong" }, model: "m", provider: "gateway-style", usage: {} }));
    await d.storage.insertReference({ userId: 1, rawContent: "a".repeat(50), sourceType: "manual", title: null });
    const { analysis } = await requestStyleAnalysis(1, { referenceId: 1 }, d);
    const run = await runStyleAnalysis(analysis.id, d);
    assert.equal(run.status, "failed");
    assert.equal(run.failureClass, "permanent");
    assert.equal(d.storage.profiles.length, 0);
    resetStyleAnalyzers();
  });

  it("a transient analyzer failure is classified transient, never silently permanent", async () => {
    const d = deps(async () => {
      throw JobFailure.transient("upstream 503");
    });
    await d.storage.insertReference({ userId: 1, rawContent: "a".repeat(50), sourceType: "manual", title: null });
    const { analysis } = await requestStyleAnalysis(1, { referenceId: 1 }, d);
    const run = await runStyleAnalysis(analysis.id, d);
    assert.equal(run.failureClass, "transient");
    resetStyleAnalyzers();
  });

  it("re-running an already-ready analysis is idempotent — no duplicate observation", async () => {
    const observation = {
      confidence: "strong",
      confidenceReason: "clear",
      dimensions: {
        tone: "t", sentenceRhythm: "r", verbosity: "v", formattingTendencies: "f",
        punctuationTendencies: "p", vocabularyRegister: "vr", hookPatterns: [],
        paragraphStructure: "ps", questionUsage: "q", listUsage: "l",
        emojiTendencies: "e", ctaPatterns: [], rhetoricalPatterns: [], recurringTraits: [],
      },
    };
    const d = deps(async () => ({ observation, model: "m", provider: "gateway-style", usage: {} }));
    await d.storage.insertReference({ userId: 1, rawContent: "a".repeat(50), sourceType: "manual", title: null });
    const { analysis } = await requestStyleAnalysis(1, { referenceId: 1 }, d);
    await runStyleAnalysis(analysis.id, d);
    const again = await runStyleAnalysis(analysis.id, d);
    assert.equal(again.reused, true);
    assert.equal(d.storage.profiles.length, 1, "no duplicate observation from a second run");
    resetStyleAnalyzers();
  });

  it("explicit regenerate creates a NEW observation chained via supersedesId, never mutating the old one", async () => {
    const observationA = {
      confidence: "strong", confidenceReason: "A",
      dimensions: { tone: "A", sentenceRhythm: "r", verbosity: "v", formattingTendencies: "f", punctuationTendencies: "p", vocabularyRegister: "vr", hookPatterns: [], paragraphStructure: "ps", questionUsage: "q", listUsage: "l", emojiTendencies: "e", ctaPatterns: [], rhetoricalPatterns: [], recurringTraits: [] },
    };
    const observationB = { ...observationA, confidenceReason: "B", dimensions: { ...observationA.dimensions, tone: "B" } };
    let call = 0;
    const d = deps(async () => ({ observation: call++ === 0 ? observationA : observationB, model: "m", provider: "gateway-style", usage: {} }));
    await d.storage.insertReference({ userId: 1, rawContent: "a".repeat(50), sourceType: "manual", title: null });

    const first = await requestStyleAnalysis(1, { referenceId: 1 }, d);
    const runA = await runStyleAnalysis(first.analysis.id, d);

    const regen = await requestStyleAnalysis(1, { referenceId: 1, regenerate: true }, d);
    const runB = await runStyleAnalysis(regen.analysis.id, d);

    assert.equal(d.storage.profiles.length, 2);
    const profileB = d.storage.profiles.find((p: any) => p.id === runB.styleProfileId);
    assert.equal(profileB.supersedesId, runA.styleProfileId, "the new revision chains to the old one");
    const profileA = d.storage.profiles.find((p: any) => p.id === runA.styleProfileId);
    assert.equal(profileA.structuredObservation.dimensions.tone, "A", "the original observation is never mutated");
    resetStyleAnalyzers();
  });
});

describe("deterministic style statistics (Phase 24)", () => {
  it("computes sentence and question rates from text, not from a model", async () => {
    const { computeTextStatistics, capConfidence, deriveNegativeSignals } = await import("./styleStats");
    const short = computeTextStatistics("Short hook?\n\nPunchy take. Another take.");
    const long = computeTextStatistics(
      "Therefore the platform team should furthermore consider executive stakeholders when designing the scheduling policy for multi-tenant clusters across regions.",
    );
    assert.ok(short.averageSentenceLength < long.averageSentenceLength);
    assert.ok(short.questionMarkFrequency > 0);
    assert.equal(capConfidence("strong", 2), "weak");
    assert.equal(capConfidence("strong", 5), "weak");
    assert.equal(capConfidence("strong", 1), "strong");
    assert.equal(deriveNegativeSignals(short, 2).length, 0, "tiny samples must not produce negative conclusions");
  });

  it("corpus analysis of the same frozen set is idempotent", async () => {
    const observation = validObservation();
    resetStyleAnalyzers();
    registerStyleAnalyzer({
      providerId: "gateway-style",
      providerVersion: "v1",
      analyze: async () => ({ observation, model: "m", provider: "gateway-style", usage: {} }),
    });
    const storage = memoryStyleStorage();
    const a = await storage.insertReference({ userId: 1, rawContent: "Casual hook? Gonna ship this. 🔥 ".repeat(4), sourceType: "x_post", title: "a" });
    const b = await storage.insertReference({ userId: 1, rawContent: "Another short take. Wow this ships. ".repeat(4), sourceType: "x_post", title: "b" });
    const first = await requestStyleAnalysis(1, { referenceIds: [a.id, b.id] }, { storage });
    const second = await requestStyleAnalysis(1, { referenceIds: [b.id, a.id] }, { storage });
    assert.equal(first.analysis.id, second.analysis.id);
    assert.equal(second.created, false);
    resetStyleAnalyzers();
  });

  it("explicit regenerate is a new analysis identity, not a duplicate delivery", async () => {
    const storage = memoryStyleStorage();
    const a = await storage.insertReference({ userId: 1, rawContent: "a".repeat(50), sourceType: "manual", title: null });
    const b = await storage.insertReference({ userId: 1, rawContent: "b".repeat(50), sourceType: "manual", title: null });
    const first = await requestStyleAnalysis(1, { referenceIds: [a.id, b.id] }, { storage });
    const regen = await requestStyleAnalysis(1, { referenceIds: [a.id, b.id], regenerate: true }, { storage });
    assert.notEqual(first.analysis.id, regen.analysis.id);
  });
});

