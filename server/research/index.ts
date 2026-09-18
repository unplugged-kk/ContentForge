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
  RESEARCH_ANALYSIS_VERSION,
  RESEARCH_LIMITS,
  analyzeResearch,
  clusterSources,
  detectConflicts,
  depthBudget,
  expandQueries,
  resolveTimeWindow,
} from "./intelligence";
export {
  createSeoProvider,
  createUnconfiguredSeoProvider,
  normalizeSeoContext,
  seoConfigured,
} from "./seo";
export {
  DatabaseResearchStorage,
  ResearchJobImmutableError,
  type ClaimJobInput,
  type ResearchStoragePort,
  type StoredSource,
} from "./storage";
export { RSS_PROVIDER_ID, createRssProvider, rssProvider, rssProviderConfigSchema } from "./providers/rss";
export {
  REDDIT_PROVIDER_ID,
  createRedditProvider,
  loadRedditProviderConfig,
  normalizeRedditPost,
  redditProvider,
  redditProviderConfigSchema,
} from "./providers/reddit";
export {
  YOUTUBE_PROVIDER_ID,
  createYoutubeProvider,
  loadYoutubeProviderConfig,
  normalizeYoutubeItem,
  youtubeProvider,
  youtubeProviderConfigSchema,
  youtubeVideoId,
} from "./providers/youtube";
export {
  HN_PROVIDER_ID,
  createHnProvider,
  loadHnProviderConfig,
  hnProvider,
  hnProviderConfigSchema,
  normalizeHnHit,
} from "./providers/hn";
export {
  WEB_PROVIDER_ID,
  createWebProvider,
  loadWebProviderConfig,
  webProvider,
  webProviderConfigSchema,
} from "./providers/web";
export {
  LAST30DAYS_HOSTED_SOURCES,
  LAST30DAYS_PROVIDER_ID,
  createLast30DaysProvider,
  last30daysConfigured,
  last30daysProvider,
  last30daysProviderConfigSchema,
  normalizeLast30DaysItems,
  parseDoctorReport,
} from "./providers/last30days";
export {
  DEFAULT_ALLOWED_CONTENT_TYPES,
  DEFAULT_URL_MAX_LENGTH,
  DisallowedContentTypeError,
  UrlTooLongError,
  assertAllowedContentType,
  assertUrlLength,
  createSafeFetchDeps,
  normalizeContentType,
  type ProviderHttpDeps,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
} from "./providers/http";
export { envList, providerUrls, type ProviderUrls } from "./providers/providerUrls";
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
