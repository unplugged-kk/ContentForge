export * from "./contracts";
export {
  canonicalizeUrl,
  computeContentHash,
  computeSourceHash,
  buildExcerpt,
  normalizeText,
  toIsoOrNull,
} from "./normalize";
export {
  ProviderHealthStore,
  type BackendCapabilityHealth,
  type HealthStoreOptions,
} from "./health";
export {
  AccessClassNotPermittedError,
  CapabilityUnsupportedError,
  DEFAULT_ALLOWED_ACCESS_CLASSES,
  ProviderExecutor,
  ProviderNotRegisteredError,
  ProviderUnavailableError,
  getProvider,
  hasProvider,
  listProviders,
  registerProvider,
  resetProviderRegistry,
  type ProviderExecutorOptions,
} from "./registry";
export {
  MAX_EVIDENCE_EXCERPT_LENGTH,
  authorStatementEvidence,
  classifyEmptyCollection,
  dedupeSources,
  deriveEvidence,
  hashExcerpt,
  summarizeCollection,
  validateResearch,
  type CollectionSummary,
  type DerivedEvidence,
  type DroppedSource,
  type EvidenceKind,
  type EvidenceOrigin,
  type ResearchValidity,
} from "./engine-core";
export {
  ResearchEngine,
  type InitiationKind,
  type ResearchEngineDeps,
  type ResearchRunInput,
  type ResearchRunResult,
} from "./engine";
export {
  DatabaseResearchStorage,
  ResearchJobImmutableError,
  type ClaimJobInput,
  type ResearchStoragePort,
  type StoredSource,
} from "./storage";
export { RSS_PROVIDER_ID, createRssProvider, rssProvider, rssProviderConfigSchema } from "./providers/rss";
export {
  createRssConfigLoader,
  loadRssProviderConfig,
  type RssConfigContext,
  type RssConfigDatabase,
  type RssConfigLoader,
} from "./providers/rssConfig";
export { resolveProviderConfigs, type ProviderConfigMap } from "./config";
export { registerBuiltinProviders } from "./bootstrap";
export {
  RESEARCH_RUN_JOB_TYPE,
  createResearchRunHandler,
  registerResearchRunJob,
  researchInputForJob,
  researchRunPayloadSchema,
  type ResearchRunDeps,
  type ResearchRunPayload,
} from "./job";
export {
  createDefaultResearchRouter,
  createResearchJobBodySchema,
  createResearchRouter,
  type CreateResearchJobBody,
  type ResearchApiDeps,
  type ResearchApiStorage,
} from "./routes";
