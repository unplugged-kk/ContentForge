# Media provider onboarding

ContentForge has one modality-neutral media boundary: `VisualProviderPort`.
Provider and model choice are configuration; they are not domain entities.

## Required change set

Adding a provider requires only:

1. Add one adapter under `server/content/visualProviders/`.
2. Register it in `registerBuiltinVisualProviders()`.
3. Declare modalities, capabilities, models, limits, health, and optional voices.
4. Add server-only environment configuration to `.env.example`.
5. Run the reusable provider contract suite plus a real provider smoke test.
6. Certify failure mapping, retry, ambiguity/reconciliation, restart, owner
   isolation, import validation, and secret non-disclosure.

No change is permitted or required in Story, Opportunity, GenerationPolicy,
ContextAssembly, Artifact lifecycle, Approval, Schedule, Occurrence,
Publication, ChannelAdapter, or Result.

## Adapter contract

An adapter declares:

- stable `providerId` and independent model IDs;
- implemented modality/capabilities only;
- model and voice catalogs as inert metadata;
- configuration, reachability, capability, and processing readiness separately;
- provider-specific request mapping inside `generate()`;
- final bytes and objective metadata (MIME, dimensions or audio stream data,
  duration, codec, cost/usage/latency when available);
- normalized failures.

Manifests/descriptors cannot execute code. Credentials and provider base URLs
stay in server configuration and never enter discovery responses, request
snapshots, agent payloads, events, artifacts, or logs.

## Selection and retries

Selection is exact and deterministic: `providerId` plus optional `modelId`.
A configured fallback may be selected only before an external side effect.
After submit, timeout means `unknown`; reconcile that provider job before any
new submission. Retry means the same durable generation. Regenerate creates a
new generation.

## Certification checklist

- [ ] configured
- [ ] reachable
- [ ] capability verified
- [ ] real submit
- [ ] real output
- [ ] validated import through `AssetStoragePort`
- [ ] retry semantics
- [ ] ambiguous outcome reconciliation
- [ ] process restart
- [ ] owner isolation
- [ ] no secrets leaked

Only providers passing every relevant item are labeled `IMPLEMENTED`. A fixture
can satisfy deterministic orchestration tests but never production
certification.
