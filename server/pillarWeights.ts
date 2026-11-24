/**
 * Pillar weighting — resolving a name to a real weight, and saying when it can't.
 *
 * WHY THIS MODULE EXISTS
 *
 * `computeEngagementScore` in `autopilot.ts` does:
 *
 *     const pillarWeight = PILLAR_WEIGHTS[pillarName] ?? 1.0;
 *
 * and `1.0` is also the neutral weight and also a legal weight. That makes the
 * lookup's failure mode indistinguishable from success, and on the live system it
 * failed for every row:
 *
 *   - all 452 `discovered_ideas` rows have `pillar_id = NULL`, so the caller's
 *     `pillar?.name` is always undefined and the name that arrives is
 *     `idea.category` — a slug ("platform_engineering"), never a pillar name;
 *   - `PILLAR_WEIGHTS` is keyed by human pillar names ("Kubernetes Deep Dives"),
 *     and the three pillars D27 approved and seeded are named differently
 *     ("Kubernetes & platform engineering").
 *
 * Measured result: 0/452 ideas received an explicit weight. The score still
 * emitted a `pillar_weight: 1.0` breakdown field, so nothing looked wrong.
 *
 * WHAT THIS FIX DOES
 *
 * Resolution becomes explicit and closed: an approved pillar name, an approved
 * pillar's category set, or a reported miss. `weighted: false` is carried to the
 * caller instead of being encoded as the number 1.0, so "no opinion" and "neutral
 * opinion" stop being the same value.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not delete the legacy 16-name `PILLAR_WEIGHTS` table. That table is
 * exported, prior artifacts record weights derived from it, and removing names is
 * a widening change. Instead the approved namespace (the D27 set) is explicit and
 * separate, and the legacy table is kept for compatibility only. Names outside the
 * approved set — including "Career & Leadership", which D27 did not choose — are
 * never consulted for a new ranking.
 */

/**
 * The pre-D27 weighting table, kept unchanged for compatibility.
 *
 * Its keys are pillar names from an earlier taxonomy. It is no longer what decides
 * a ranking: `resolvePillarWeight` consults `PILLAR_WEIGHT_NAMESPACE` first. Do not
 * add new keys here — add them to the namespace below, or the two tables will
 * disagree the way they did before this fix.
 */
export const PILLAR_WEIGHTS: Record<string, number> = {
  "AI Agents & Agentic Workflows":          1.40,
  "AIOps & AI-Assisted DevOps":             1.35,
  "Hot Takes & Trends":                     1.20,
  "Data Infrastructure & MLOps":            1.20,
  "Kubernetes Deep Dives":                  1.15,
  "Platform Engineering & DevEx":           1.10,
  "SRE & Reliability Engineering":          1.05,
  "Cloud-Native Data Platforms":            1.00,
  "Infrastructure as Code":                 0.95,
  "Security & DevSecOps":                   0.90,
  "FinOps & Cloud Cost Engineering":        0.90,
  "Open Source & CNCF Ecosystem":           0.85,
  "Technical Leadership & Eng Management":  0.80,
  "Career & Leadership":                    0.75,
  "AI for DevOps / AIOps":                  1.35,
  "Infrastructure as Code for Data":        0.95,
};

/**
 * The approved pillar namespace — exactly the three pillars D27 selected.
 *
 * Each pillar lists the `discovered_ideas.category` slugs that belong to it. The
 * category set is what makes the weight reachable on the live pool, where every
 * idea carries a category and none carries a pillar_id.
 */
export const PILLAR_WEIGHT_NAMESPACE: {
  pillars: Record<string, { weight: number; categories: string[] }>;
  /** Categories that exist in the pool but belong to no approved pillar. */
  unalignedCategories: string[];
} = {
  pillars: {
    "Kubernetes & platform engineering": {
      weight: 1.15,
      categories: [
        "kubernetes",
        "platform_engineering",
        "sre",
        "system_design",
        "tech",
      ],
    },
    "AI agents for DevOps": {
      weight: 1.40,
      categories: [
        "ai",
        "ai_research",
        "mlops",
      ],
    },
    "GitOps & automation": {
      /**
       * 0.95, not 1.00. A weight of exactly 1.0 is indistinguishable from the
       * fallback in the numeric output, which is the defect this module exists to
       * remove. Every approved pillar must carry a weight the fallback cannot
       * produce silently.
       */
      weight: 0.95,
      categories: [
        "iac",
        "gitops",
        "devops",
        "finops",
        "security",
        "leadership",
      ],
    },
  },
  /**
   * D27 chose three pillars and "Career & Leadership" was not one of them. A
   * `leadership` idea still needs a weight rather than a silent 1.0, and it is
   * engineering-leadership material for the same audience, so it is carried by
   * GitOps & automation (the operations/process pillar) rather than promoted into
   * a pillar of its own. Recording that here keeps the compromise explicit.
   */
  unalignedCategories: [],
};

export type PillarWeightSource = "pillar" | "category" | "fallback";

export interface PillarWeightResolution {
  weight: number;
  /** True only when an explicit weight was found. False means the neutral 1.0. */
  weighted: boolean;
  source: PillarWeightSource;
  /** The approved pillar the weight came from, when it came from one. */
  pillar: string | null;
  /** The name that was looked up, for the audit trail. */
  resolvedFrom: string | null;
}

const CATEGORY_TO_PILLAR: Map<string, { pillar: string; weight: number }> = (() => {
  const map = new Map<string, { pillar: string; weight: number }>();
  for (const [pillar, { weight, categories }] of Object.entries(
    PILLAR_WEIGHT_NAMESPACE.pillars,
  )) {
    for (const category of categories) {
      map.set(category.toLowerCase(), { pillar, weight });
    }
  }
  return map;
})();

function normalise(name: string | null | undefined): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * Resolve the weight for an idea, preferring its pillar and falling back to its
 * category. Never invents a weight: an unknown name returns the neutral 1.0 with
 * `weighted: false`, so the caller can tell the difference and record it.
 */
export function resolvePillarWeight(input: {
  pillarName?: string | null;
  category?: string | null;
}): PillarWeightResolution {
  const pillarName = normalise(input.pillarName);
  if (pillarName) {
    const entry = PILLAR_WEIGHT_NAMESPACE.pillars[pillarName];
    if (entry) {
      return {
        weight: entry.weight,
        weighted: true,
        source: "pillar",
        pillar: pillarName,
        resolvedFrom: pillarName,
      };
    }
  }

  const category = normalise(input.category);
  if (category) {
    const mapped = CATEGORY_TO_PILLAR.get(category.toLowerCase());
    if (mapped) {
      return {
        weight: mapped.weight,
        weighted: true,
        source: "category",
        pillar: mapped.pillar,
        resolvedFrom: category,
      };
    }
  }

  return {
    weight: 1.0,
    weighted: false,
    source: "fallback",
    pillar: null,
    resolvedFrom: pillarName ?? category ?? null,
  };
}
