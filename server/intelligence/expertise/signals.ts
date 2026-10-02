/**
 * Expertise alignment — how far a topic sits inside the creator's standing.
 *
 * A deterministic proxy, deliberately conservative: it reports overlap with the
 * profile's vocabulary and which domains matched, and it never upgrades a topic
 * to "core" on thin evidence. The decision layer turns this into a positioning
 * call; the evidence itself is code.
 */

import {
  profileTokens,
  type ExpertiseConfidence,
  type ExpertiseProfile,
} from "./profile";

export interface ExpertiseTopic {
  title?: string;
  query?: string;
  angles?: string[];
}

export interface ExpertiseAlignment {
  /** 0 = no overlap with anything the creator has standing in. */
  alignment: number;
  /** Profile domains that share vocabulary with the topic. */
  matched: string[];
  confidence: ExpertiseConfidence;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function expertiseAlignment(
  profile: ExpertiseProfile,
  topic: ExpertiseTopic,
): ExpertiseAlignment {
  const topicTokens = new Set([
    ...profileTokens(topic.title ?? ""),
    ...profileTokens(topic.query ?? ""),
    ...(topic.angles ?? []).flatMap((angle) => profileTokens(angle ?? "")),
  ]);

  if (profile.domains.length === 0 || topicTokens.size === 0) {
    return { alignment: 0, matched: [], confidence: profile.confidence };
  }

  const vocabulary = new Set<string>();
  const matched: string[] = [];
  for (const domain of profile.domains) {
    const tokens = profileTokens(domain);
    let shared = 0;
    for (const token of tokens) {
      vocabulary.add(token);
      if (topicTokens.has(token)) shared += 1;
    }
    if (shared > 0) matched.push(domain);
  }

  let overlap = 0;
  for (const token of Array.from(topicTokens)) if (vocabulary.has(token)) overlap += 1;
  const overlapShare = overlap / topicTokens.size;
  const domainBonus = Math.min(1, matched.length / 2);

  // Thin evidence must not read as confident: a topic described by a single word
  // that happens to be a domain term is not the same as one that engages it.
  const sufficiency = Math.min(1, topicTokens.size / 4);

  return {
    alignment: Number(clamp01((0.7 * overlapShare + 0.3 * domainBonus) * sufficiency).toFixed(4)),
    matched,
    confidence: profile.confidence,
  };
}

export type ExpertiseBand = "core" | "adjacent" | "outside";

/** Deterministic band thresholds — env-tunable through `expertiseBandThresholds`. */
export function expertiseBand(alignment: number, core = 0.5, adjacent = 0.2): ExpertiseBand {
  if (alignment >= core) return "core";
  if (alignment >= adjacent) return "adjacent";
  return "outside";
}
