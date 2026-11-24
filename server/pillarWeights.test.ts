/**
 * Run 45 — the pillar multiplier must not be a silent constant.
 *
 * `computeEngagementScore` multiplies an idea's viral score by
 * `PILLAR_WEIGHTS[pillarName] ?? 1.0`. Two things are true on the live system:
 *
 *   1. Every one of the 452 `discovered_ideas` rows has `pillar_id = NULL`, so
 *      `pillar?.name` is always undefined and the name that reaches the table is
 *      `idea.category` — a slug like "platform_engineering", never a pillar name.
 *   2. `PILLAR_WEIGHTS` is keyed by human pillar names ("Kubernetes Deep Dives"),
 *      and D27 seeded three different names ("Kubernetes & platform engineering").
 *
 * So the lookup misses 452 times out of 452 and the multiplier is 1.0 for the
 * entire pool. A weight that is always 1.0 cannot reorder anything: the pillar
 * decision D27 made has no effect on ranking, while the score still *reports* a
 * `pillar_weight` breakdown field, which is what makes it invisible.
 *
 * These tests pin the resolution rule so a silent 1.0 is a test failure, not a
 * value nobody looks at.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PILLAR_WEIGHTS,
  PILLAR_WEIGHT_NAMESPACE,
  resolvePillarWeight,
} from "./pillarWeights";

const idea = (over: Record<string, unknown> = {}) =>
  ({
    id: 1,
    title: "Running Argo CD at 400 services",
    description: "What broke and what we changed",
    category: "gitops",
    viralScore: "8.5",
    contentTypeSuggestion: "thread",
    timeliness: "evergreen",
    ...over,
  }) as any;

describe("resolvePillarWeight", () => {
  it("resolves a seeded pillar name (the D27 set) to an explicit weight", () => {
    const names = [
      "Kubernetes & platform engineering",
      "AI agents for DevOps",
      "GitOps & automation",
    ];
    for (const name of names) {
      const r = resolvePillarWeight({ pillarName: name, category: null });
      assert.equal(r.weighted, true, `pillar "${name}" must carry an explicit weight`);
      assert.notEqual(r.weight, 1.0, `${name} must not resolve to the neutral 1.0`);
      assert.equal(r.source, "pillar");
    }
  });

  it("resolves a category slug when the idea has no pillar", () => {
    // The live shape: pillar_id NULL, so category is what the code has.
    const r = resolvePillarWeight({ pillarName: undefined, category: "gitops" });
    assert.equal(r.weighted, true, "a mapped category must carry an explicit weight");
    assert.notEqual(r.weight, 1.0);
    assert.equal(r.source, "category");
  });

  it("every category present in the live idea pool resolves to a weight", () => {
    // Measured on the live DB, run 45: these are the 13 categories and counts.
    const live = [
      "platform_engineering", "ai", "ai_research", "sre", "mlops", "security",
      "finops", "devops", "system_design", "iac", "leadership", "tech", "kubernetes",
    ];
    const unresolved = live.filter(
      (c) => !resolvePillarWeight({ pillarName: null, category: c }).weighted,
    );
    assert.deepEqual(unresolved, [], `categories fell back to 1.0: ${unresolved.join(", ")}`);
  });

  it("still falls back to 1.0 for an unknown category, and says so", () => {
    const r = resolvePillarWeight({ pillarName: null, category: "astrology" });
    assert.equal(r.weight, 1.0);
    assert.equal(r.weighted, false, "an unknown name must report itself as unweighted");
    assert.equal(r.source, "fallback");
  });

  it("reports a miss rather than silently returning 1.0", () => {
    // The whole defect is that 1.0 is indistinguishable from "no opinion".
    const miss = resolvePillarWeight({ pillarName: null, category: "astrology" });
    const neutral = resolvePillarWeight({ pillarName: null, category: "tech" });
    assert.equal(miss.weight, neutral.weight === 1.0 ? neutral.weight : 1.0);
    assert.notEqual(miss.weighted, neutral.weighted, "miss and real weight must differ in `weighted`");
  });

  it("keeps exactly the three approved pillars in the namespace", () => {
    // D27: exactly three, and "Career & leadership" was NOT chosen.
    const approved = Object.keys(PILLAR_WEIGHT_NAMESPACE.pillars);
    assert.equal(approved.length, 3);
    assert.equal(
      approved.some((n) => /career/i.test(n)),
      false,
      "D27 rejected Career & Leadership; it must not be an approved pillar",
    );
  });

  it("does not carry the unreferenced legacy pillar table as approved pillars", () => {
    // PILLAR_WEIGHTS kept the pre-D27 16-name table around. Two of its entries
    // ("Technical Leadership & Eng Management", "Career & Leadership") are
    // categories D27 explicitly did not choose. They may remain readable for
    // historical artifacts, but they are not part of the namespace that decides
    // today's ranking.
    const approved = Object.keys(PILLAR_WEIGHT_NAMESPACE.pillars);
    for (const legacy of ["Career & Leadership", "Technical Leadership & Eng Management"]) {
      assert.equal(approved.includes(legacy), false, `${legacy} is not an approved pillar`);
    }
  });

  it("orders the three approved pillars so AI agents rank above GitOps", () => {
    // If two pillars ever tie, the multiplier is decorative again for that pair.
    const ai = resolvePillarWeight({ pillarName: "AI agents for DevOps", category: null }).weight;
    const k8s = resolvePillarWeight({ pillarName: "Kubernetes & platform engineering", category: null }).weight;
    const gitops = resolvePillarWeight({ pillarName: "GitOps & automation", category: null }).weight;
    assert.ok(ai > gitops, `AI (${ai}) must outrank GitOps (${gitops}) or the weights are flat`);
    assert.ok(k8s !== gitops, "Kubernetes and GitOps must not share a weight");
  });

  it("can actually reorder two ideas that differ only in category", () => {
    // The load-bearing property. Before the fix this comparison always tied.
    const strong = idea({ category: "ai", viralScore: "8.0" });
    const weak = idea({ category: "gitops", viralScore: "8.0" });
    const ws = resolvePillarWeight({ pillarName: null, category: strong.category }).weight;
    const ww = resolvePillarWeight({ pillarName: null, category: weak.category }).weight;
    assert.notEqual(ws, ww, "equal viral scores in different categories must not tie on weight");
    assert.ok(8.0 * ws !== 8.0 * ww);
  });

  it("keeps the exported legacy table intact for any existing caller", () => {
    // Replacing PILLAR_WEIGHTS would be a widening change; it stays readable.
    assert.equal(typeof PILLAR_WEIGHTS, "object");
    assert.ok(Object.keys(PILLAR_WEIGHTS).length >= 3);
  });
});
