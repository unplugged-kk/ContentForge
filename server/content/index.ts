export {
  DatabaseContentStorage,
  type ClaimGenerationJobResult,
  type ClaimPublicationResult,
  type ContentDatabase,
  type ContentStoragePort,
  type InsertArtifactRow,
  type InsertGenerationJobRow,
  type InsertOpportunityRow,
  type InsertPolicyRow,
  type InsertPublicationRow,
  type InsertResultRow,
  type InsertScheduleRow,
  type InsertTemplateRow,
  type InsertVoiceRow,
  type JsonRecord,
} from "./storage";

export {
  createOpportunityFromStory,
  killOpportunity,
  selectOpportunity,
  createOpportunitySchema,
  formatChannelError,
  InvalidOpportunityInputError,
  OpportunityNotFoundError,
  OpportunityStateError,
  StoryNotFoundError,
  StoryNotUsableError,
  type CreateOpportunityInput,
  type OpportunityDeps,
  type StoryPort,
} from "./opportunity";

export {
  createGenerationJob,
  generationIdempotencyKey,
  loadGenerationContext,
  runGenerationJob,
  GenerationInputError,
  OpportunityKilledError,
  OpportunityNotFoundError as GenerationOpportunityNotFoundError,
  StoryMissingForOpportunityError,
  type CreateGenerationJobInput,
  type EffectiveGenerationRequest,
  type GenerationContext,
  type GenerationDeps,
  type GenerationModelPort,
  type GenerationOutput,
  type GenerationRequest,
  type GenerationRunResult,
} from "./generation";

export {
  repurposeStory,
  RepurposeInputError,
  type RepurposeDeps,
  type RepurposeInput,
  type RepurposeResult,
  type RepurposeTargetInput,
  type RepurposeTargetOutcome,
  type RepurposeOutcomeStatus,
} from "./repurposing";

export {
  assembleEffectiveRequest,
  canonicalJson,
  policySpecHash,
  resolveGenerationPolicy,
  templateContentHash,
  voiceContentHash,
  PolicyInputError,
  TemplateFormatMismatchError,
  TemplateNotFoundError,
  VoiceNotFoundError,
  type PolicyDeps,
  type PolicySpec,
  type ResolvePolicyInput,
  type ResolvedPolicy,
} from "./policy";

export {
  assembleContext,
  createDatabaseContextReader,
  EMPTY_CONTEXT_ASSEMBLY,
  MAX_CHARS_PER_SOURCE,
  MAX_STYLE_SOURCES,
  MAX_TOTAL_CONTEXT_CHARS,
  MAX_VAULT_SOURCES,
  type ContextAssembly,
  type ContextSource,
  type ContextSourceRef,
  type ContextSourceType,
  type ContextStorageReader,
} from "./context";

export {
  getStyleAnalyzer,
  hasStyleAnalyzer,
  normalizeAuthoredText,
  registerStyleAnalyzer,
  resetStyleAnalyzers,
  styleConfidenceEnum,
  styleDimensionsSchema,
  styleObservationSchema,
  validateStyleObservation,
  InvalidAuthoredContentError,
  InvalidStyleObservationError,
  StyleAnalyzerNotRegisteredError,
  type AuthoredContent,
  type AuthoredSourceType,
  type StyleAnalyzerOutput,
  type StyleAnalyzerPort,
  type StyleConfidence,
  type StyleDimensions,
  type StyleObservation,
} from "./style";

export { createGatewayStyleAnalyzer, type GatewayStyleAnalyzerOptions } from "./styleAnalyzer";

export {
  createDatabaseStyleStorage,
  renderStylePromptSnippet,
  requestStyleAnalysis,
  runStyleAnalysis,
  styleAnalysisIdempotencyKey,
  ReferenceNotFoundError,
  StyleServiceInputError,
  type RequestStyleAnalysisInput,
  type StyleAnalysisRunResult,
  type StyleServiceDeps,
  type StyleStoragePort,
} from "./styleService";

export {
  getFormatProfile,
  hasFormatProfile,
  listFormatProfiles,
  type FormatProfile,
} from "./formatProfiles";

export {
  chatRequestSchema,
  handleChatRequest,
  ChatInputError,
  ChatStoryNotFoundError,
  type ChatDeps,
  type ChatIntent,
  type ChatIntentPort,
  type ChatRequest,
  type ChatResult,
  type ChatStoryPort,
} from "./chat";

export {
  approveArtifact,
  createArtifact,
  createArtifactRevision,
  rejectArtifact,
  schedulableReadiness,
  submitArtifactForReview,
  ArtifactMediaReferenceError,
  ArtifactNotFoundError,
  ArtifactStateError,
  InvalidArtifactPayloadError,
  type ArtifactDeps,
  type CreateArtifactInput,
} from "./artifact";

export {
  createSchedule,
  dispatchDueOccurrences,
  publicationIdempotencyKey,
  ArtifactNotSchedulableError,
  ScheduleInputError,
  ScheduleNotFoundError,
  type CreateScheduleInput,
  type DispatchDeps,
  type DispatchResult,
  type SchedulingDeps,
} from "./scheduling";

export {
  MAX_RECONCILE_ATTEMPTS,
  MediaResolutionError,
  reconcileStalePublications,
  reconcileUnknownPublications,
  resolvePublicationMedia,
  runPublication,
  DEFAULT_LEASE_MS,
  type PublicationDeps,
  type ReconcileDeps,
  type ReconcileUnknownResult,
  type PublicationRunResult,
  type PublicationRunStatus,
} from "./publication";

export {
  createXChannelAdapter,
  createLinkedInChannelAdapter,
  classifyXFailure,
  classifyLinkedInFailure,
  channelSupportsFormat,
  getChannelAdapter,
  hasChannelAdapter,
  listChannelAdapters,
  registerBuiltinChannelAdapters,
  registerChannelAdapter,
  resetChannelAdapters,
  ChannelAdapterNotRegisteredError,
  type ChannelAdapter,
  type PublishMedia,
  type PublishOutcome,
  type PublishRequest,
} from "./adapters";

export {
  chatDeps,
  contentStorage,
  automationDeps,
  automationStorage,
  createAutomationRunHandler,
  enqueueAutomationRunJob,
  registerAutomationRunJob,
  registerAnalyticsRefreshJob,
  enqueueAnalyticsRefreshJob,
  automationRunPayloadSchema,
  ANALYTICS_REFRESH_JOB_TYPE,
  analyticsRefreshPayloadSchema,
  AUTOMATION_RUN_JOB_TYPE,
  type AutomationRunPayload,
  createGenerationRunHandler,
  createPublicationRunHandler,
  createVisualRunHandler,
  generationDeps,
  generationRunPayloadSchema,
  publicationDeps,
  publicationRunPayloadSchema,
  registerBuiltinVisualProviders,
  registerContentJobs,
  registerGenerationRunJob,
  registerPublicationRunJob,
  registerVisualRunJob,
  visualAssetStorage,
  visualRunDeps,
  visualRunPayloadSchema,
  GENERATION_RUN_JOB_TYPE,
  PUBLICATION_RUN_JOB_TYPE,
  VISUAL_RUN_JOB_TYPE,
  type GenerationRunPayload,
  type PublicationRunPayload,
  type VisualRunDeps,
  type VisualRunPayload,
} from "./service";

export { CHAT_INTENT_MARKER, createGatewayChatIntent, createGatewayGenerationModel } from "./model";

export {
  createVisualGeneration,
  runVisualGeneration,
  createVisualAssetRevision,
  createVisualGenerationSchema,
  VisualServiceInputError,
  type CreateVisualGenerationInput,
  type VisualRunResult,
  type VisualServiceDeps,
} from "./visualService";

export {
  registerVisualProvider,
  hasVisualProvider,
  getVisualProvider,
  resetVisualProviders,
  createLocalAssetStorage,
  validateVisualOutput,
  assertSafeStorageKey,
  hashIntent,
  visualGenerationIdempotencyKey,
  visualIntentSchema,
  ALLOWED_VISUAL_MIMES,
  MAX_VISUAL_BYTES,
  MAX_VISUAL_DIMENSION,
  modalityOfCapability,
  providerModalities,
  resolveProviderModel,
  InvalidVisualInputError,
  VisualCapabilityUnsupportedError,
  VisualModelUnsupportedError,
  VisualProviderNotRegisteredError,
  type AssetStoragePort,
  type MediaModality,
  type VisualCapability,
  type VisualGenerationOutput,
  type VisualGenerationRequest,
  type VisualKind,
  type VisualProviderPort,
} from "./visual";

export {
  createFixtureVisualProvider,
} from "./visualFixture";

export {
  MAX_VARIATION_COUNT,
  MIN_CAROUSEL_SLIDES,
  MAX_CAROUSEL_SLIDES,
  listVisualSpecs,
  getVisualSpec,
  resolveVisualSpec,
  validateVariationCount,
  validateCarouselSlideCount,
  variationIdentityKey,
  type VisualSpec,
} from "./visualSpecs";

export type {
  ClaimVisualGenerationResult,
  InsertVisualAssetRefRow,
  InsertVisualAssetRow,
  InsertVisualGenerationRow,
} from "./storage";

export {
  createContentRouter,
  createDefaultContentRouter,
  type ContentApiDeps,
} from "./routes";

// ── Phase 13: automation / autopilot foundation ───────────────────────────────
export {
  advanceAutomationRun,
  automationPolicySpecHash,
  automationResearchIdempotencyKey,
  automationRunIdempotencyKey,
  boundAutomationTargets,
  createAutomationPolicy,
  createAutomationRun,
  currentAutomationStep,
  deriveAutomationStep,
  dispatchAutomationDueRuns,
  dispatchScheduledAutomationPolicies,
  dueAutomationSlot,
  isTerminalRunStatus,
  automationRunStepKey,
  normalizeAutomationPolicyInput,
  resolveAutomationLimits,
  snapshotAutomationPolicy,
  summarizeAutomationRun,
  synthesizeStory,
  triggerAutomationPolicy,
  updateAutomationPolicy,
  AutomationLimitError,
  AutomationPolicyInactiveError,
  AutomationPolicyInputError,
  AutomationPolicyNotFoundError,
  AutomationRunNotFoundError,
  AUTOMATION_ADVANCE_LEASE_MS,
  AUTOMATION_TRIGGER_MANUAL,
  AUTOMATION_TRIGGER_SCHEDULED,
  DEFAULT_AUTOMATION_LIMITS,
  MAX_AUTOMATION_ATTEMPTS,
  automationGenerationConfigSchema,
  automationLimitsSchema,
  automationPublicationConfigSchema,
  automationTargetSchema,
  automationTriggerConfigSchema,
  type AutomationAdvanceResult,
  type AutomationDispatchResult,
  type AutomationDeps,
  type AutomationGenerationConfig,
  type AutomationLimits,
  type AutomationPolicySnapshot,
  type AutomationPublicationConfig,
  type AutomationResearchPort,
  type AutomationRunSummary,
  type AutomationStep,
  type AutomationTriggerConfig,
  type CreatedAutomationRun,
  type NormalizedAutomationPolicy,
  type ScheduledAutomationDispatchResult,
} from "./automation";

export {
  DatabaseAutomationStorage,
  type AutomationStoragePort,
  type ClaimAutomationRunResult,
  type InsertAutomationPolicyRow,
  type InsertAutomationRunRow,
  type PatchAutomationRunRow,
  type UpdateAutomationPolicyRow,
} from "./automationStorage";

export {
  createAutomationRouter,
  createDefaultAutomationRouter,
} from "./automationRoutes";

export {
  createLearningRouter,
  DatabaseLearningStorage,
  createLearningRecorder,
  deriveEditMetrics,
  deriveApprovalDecision,
  normalizeProviderMetrics,
} from "./learning";

export { createDefaultLearningRouter } from "./learning/http";

// ── Phase 1.5 additions ───────────────────────────────────────────────────────
export { createHumanEditRevision, getArtifactHistory } from "./artifact";
export { composeGenerationPolicyInput, type ComposePolicyOverrides } from "./policy";
export {
  archiveTemplate,
  archiveVoice,
  createTemplate,
  createVoice,
  listTemplateRevisions,
  listVoiceRevisions,
  reviseTemplate,
  reviseVoice,
  AuthoringInputError,
  type AuthoringDeps,
  type TemplateInput,
  type TemplatePatch,
  type VoiceInput,
  type VoicePatch,
} from "./authoring";
export {
  declaredVariables,
  renderTemplateStructure,
  templatePlaceholders,
  undeclaredVariables,
  type RenderedTemplate,
} from "./templateRender";
export { startContentScheduler } from "./service";
