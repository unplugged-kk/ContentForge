/**
 * Phase 14 — P-8 learning / analytics primitives.
 *
 * Canonical path:
 *   Artifact / lifecycle event / Result → Signal → LearningSignalStore
 *
 * This is NOT a second ContextAssembly. Context remains the generation seam;
 * learning signals are durable observations that may later be read through it.
 */

export const EDIT_SCHEMA_VERSION = "edit.v1";
export const APPROVAL_SCHEMA_VERSION = "approval.v1";
export const PUBLICATION_SCHEMA_VERSION = "publication.v1";
export const PERFORMANCE_SCHEMA_VERSION = "performance.v1";
export const LEARNING_SCHEMA_VERSION = "learning.v1";

export const MAX_SIGNAL_PAYLOAD_BYTES = 4096;

export const CANONICAL_METRICS = [
  "impressions",
  "likes",
  "comments",
  "shares",
  "clicks",
  "saves",
  "replies",
  "followers_gained",
  "engagement_rate",
] as const;

export type CanonicalMetric = (typeof CANONICAL_METRICS)[number];

export const SIGNAL_TYPES = ["edit", "approval", "publication", "performance", "derived"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SOURCE_TYPES = [
  "artifact_revision",
  "publication",
  "result",
  "performance_signal",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
