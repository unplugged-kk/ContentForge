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
  reconcileStalePublications,
  runPublication,
  DEFAULT_LEASE_MS,
  type PublicationDeps,
  type PublicationRunResult,
  type PublicationRunStatus,
} from "./publication";

export {
  createXChannelAdapter,
  getChannelAdapter,
  hasChannelAdapter,
  listChannelAdapters,
  registerBuiltinChannelAdapters,
  registerChannelAdapter,
  resetChannelAdapters,
  ChannelAdapterNotRegisteredError,
  type ChannelAdapter,
  type PublishOutcome,
  type PublishRequest,
} from "./adapters";

export {
  chatDeps,
  contentStorage,
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
  InvalidVisualInputError,
  VisualCapabilityUnsupportedError,
  VisualProviderNotRegisteredError,
  type AssetStoragePort,
  type VisualCapability,
  type VisualGenerationOutput,
  type VisualGenerationRequest,
  type VisualKind,
  type VisualProviderPort,
} from "./visual";

export {
  createFixtureVisualProvider,
} from "./visualFixture";

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
