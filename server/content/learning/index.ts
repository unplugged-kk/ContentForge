export {
  APPROVAL_SCHEMA_VERSION,
  CANONICAL_METRICS,
  EDIT_SCHEMA_VERSION,
  LEARNING_SCHEMA_VERSION,
  MAX_SIGNAL_PAYLOAD_BYTES,
  PERFORMANCE_SCHEMA_VERSION,
  PUBLICATION_SCHEMA_VERSION,
} from "./constants";
export { deriveEditMetrics, extractBody } from "./edit";
export { deriveApprovalDecision, derivedKindForApproval } from "./approval";
export {
  classifyMetricsHttpFailure,
  missingMetricsOutcome,
  normalizeProviderMetrics,
  notAvailableMetrics,
  validateNormalizedMetrics,
  type MetricFetchOutcome,
  type MetricFetchRequest,
  type NormalizedMetric,
} from "./metrics";
export { boundPayload, hourWindow, learningIdentityKey, performanceIdentityKey } from "./identity";
export { resolveLineage, lineageToExplain } from "./lineage";
export { DatabaseLearningStorage, ingestMetricRows, type LearningStoragePort } from "./store";
export { createLearningRecorder, type LearningRecorder } from "./record";
export {
  ingestExplicitMetrics,
  refreshPublicationMetrics,
  type AnalyticsRefreshDeps,
} from "./refresh";
export { computeAnalyticsSummary, learningSummaryForContext } from "./summary";
export {
  evaluateEvidenceQuality,
  extractObservationsAndProposals,
  observationIdentityKey,
  proposalIdentityKey,
  MINIMUM_SAMPLE_SIZE_FOR_PROPOSAL,
  type ExtractionResult,
} from "./proposals";
export { createLearningRouter, type LearningApiDeps } from "./routes";
