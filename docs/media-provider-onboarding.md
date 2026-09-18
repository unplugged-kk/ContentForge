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

## Certified providers (Phase 27.3)

### `elevenlabs` (audio / TTS)

| Field | Value |
| --- | --- |
| providerId | `elevenlabs` |
| modelId (cert) | `eleven_flash_v2_5` (discovered via `GET /v1/models`; keep separate from providerId) |
| voice | Existing non-cloned voice from `GET /v2/voices` (or `ELEVENLABS_VOICE_ID`) |
| env | `ELEVENLABS_API_KEY` (aliases: `ELEVEN_API_KEY`, `XI_API_KEY`) |
| auth | Server-only `xi-api-key` header |
| API | Synchronous `POST /v1/text-to-speech/:voice_id` → MP3 bytes |
| capabilities | `generate_audio` only; no voice cloning / design / remix exposed |
| health | Configured + `GET /v1/user` reachable; cheap voice catalog refresh on health |
| usage metadata | `character-cost`, `request-id`, latency (observational only) |
| validation | MIME, duration, codec, sample rate, channels, content hash via ffprobe |

### `fal` (video / text-to-video)

| Field | Value |
| --- | --- |
| providerId | `fal` |
| modelId (cert) | `fal-ai/wan/v2.2-a14b/text-to-video` (separate from providerId) |
| env | `FAL_KEY` (alias: `FAL_API_KEY`) |
| auth | Server-only `Authorization: Key …` |
| API | Queue submit `POST https://queue.fal.run/{modelId}`; status/result use app-namespace URLs from `status_url` / `response_url` (e.g. `GET https://queue.fal.run/fal-ai/wan/requests/{id}/status`, accept HTTP 202 while in progress) |
| cert defaults | 480p, 17 frames @ 16fps (~1.06s), one output |
| reconciliation | Persist `requestId` + status/response URLs under `.scratch/fal-request-ids/`; never blind-resubmit |
| validation | MP4 probe, dimensions, duration, content hash; ContentForge owns imported bytes |

### Paid certification (manual / opt-in)

Ordinary `npm test`, DB tests, and Playwright **must never** call ElevenLabs or fal.

Require both:

```bash
CONTENTFORGE_REAL_MEDIA_E2E=1
CONTENTFORGE_MEDIA_CERTIFICATION=1
```

Hard budgets (durable `.scratch/media-cert-budget.json`):

- `MEDIA_CERT_MAX_ELEVENLABS_CALLS=1`
- `MEDIA_CERT_MAX_FAL_CALLS=1`
- ElevenLabs text ≤ 200 chars; fal ≤ 2s / 480p; no regenerate

Run:

```bash
CONTENTFORGE_REAL_MEDIA_E2E=1 CONTENTFORGE_MEDIA_CERTIFICATION=1 npm run test:media:certify
```

If fal submit succeeded but import failed, reconcile the **same** request without a new submit:

```bash
CONTENTFORGE_REAL_MEDIA_E2E=1 CONTENTFORGE_MEDIA_CERTIFICATION=1 \
  DATABASE_URL='postgresql://cfuser:cfpass@127.0.0.1:5433/cf_e2e_live' \
  npx tsx script/media-certify-fal-reconcile.ts
```

Keys live only in local `.env` (gitignored). Never commit secrets.

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
