# CannerAI parity — architectural mapping & status

Status legend: **IMPLEMENTED** (works end to end, tested) · **PARTIALLY
IMPLEMENTED** (the architecture and some capability work; a named gap remains) ·
**ARCHITECTURALLY READY** (primitive + seam exist and are tested; the capability
itself is not built) · **DEFERRED** (not started, deliberately).

Governing rule: a capability is a *layer on a primitive*, never a new pipeline.
No parallel CannerAI domain model exists.

## The primitives

```
ResearchJob → Story → Opportunity → GenerationPolicy → GenerationJob → Artifact
            → approval → Schedule → Occurrence → Publication → Result
```

- **GenerationPolicy** (new, phase 1) — immutable, content-addressed revisions of
  the *rules* for making content: voice ref, template ref, objective, audience,
  format × channel constraints, model preference, plus the rendered system prompt.
- **Voice** and **ContentTemplate** — reusable configuration consumed by a policy.
- **Format profile** (code registry) — platform-aware guidance/constraints per
  format × channel. Only implemented formats are registered.

## Capability status

| CannerAI capability | Owned by | Status |
|---|---|---|
| URL / article ingestion | `SourceProvider` → ResearchJob → Story | IMPLEMENTED — `web` provider reads operator-configured / directed URLs through the SSRF-guarded safe fetch, then extracts readable text |
| Research synthesis → reusable meaning | Story | IMPLEMENTED |
| Research reuse across formats | Story → N Opportunities | IMPLEMENTED (proven: research rows unchanged) |
| Multi-provider ingestion | N `SourceProvider` → one ResearchJob | IMPLEMENTED (proven: rss + reddit + hn + web → 8 sources / 8 evidence, one job) |
| Autonomous discovery | `kind=autonomous` → provider `discover` | PARTIALLY IMPLEMENTED — durable job + provider discovery path; there is no topic-ranking or auto-selection layer, and discovery never bypasses approval |
| Trend signals | `hn` provider → NormalizedSource | PARTIALLY IMPLEMENTED — Hacker News front page/search is the trend input (a trend is a *source*, not a domain entity). No Google Trends / social-volume provider |
| Reddit ingestion | `reddit` provider → NormalizedSource | PARTIALLY IMPLEMENTED — provider, normalization and credentialed seam implemented and tested; Reddit returns **403 to anonymous scripted clients** on many networks, so the open path is unreliable in practice and the credentialed path needs an operator-supplied token |
| YouTube ingestion | `youtube` provider → NormalizedSource | PARTIALLY IMPLEMENTED — public channel feeds, **metadata-only** (`fetch`/transcript deliberately undeclared). No Data-API backend, no transcripts |
| Source deduplication | durable unique identities | IMPLEMENTED — `(job, canonical_url)` and `(job, provider, native_id)` unique indexes, proven against real PostgreSQL |
| One Story → many formats | Opportunity (`format` × `channel`) | IMPLEMENTED (x_post + x_thread) |
| Voice / writing-style matching | Voice → GenerationPolicy → GenerationJob | PARTIALLY IMPLEMENTED — reusable voice profiles + Phase 11 observed-style evidence. **Phase 14 does not auto-apply learning signals to voice.** Deferred: automatic style mutation, drift correction, UI |
| Templates | ContentTemplate → GenerationPolicy → GenerationJob | PARTIALLY IMPLEMENTED — **API foundation complete**: structure/variables/constraints/instructions as data, immutable revisions, deterministic rendering with explicit `[missing: var]` markers and undeclared-variable rejection. **Deferred**: authoring UI, seeded corpus |
| Platform-aware formatting | Format profile → policy prompt | IMPLEMENTED for x_post/x_thread; other pairs are one registration away |
| Multi-platform formatting | format × channel dimensions | PARTIALLY IMPLEMENTED — generation still requires a format profile; an existing Artifact revision can be distributed to every adapter that `supports(format)` (X and LinkedIn share `{ text }`). No new cosmetic format |
| Chat-to-post | chat → Story(human) → Opportunity → GenerationJob | IMPLEMENTED — durable idempotency (`idempotencyKey` → same Opportunity/job) and explicit `regenerate`; no conversational UI |
| Repurposing (format change) | Story → new Opportunity → new Artifact | IMPLEMENTED — never re-researches, never clones evidence |
| Regeneration after rejection | GenerationJob (`regenerate`) → new Artifact revision | IMPLEMENTED (idempotent duplicate delivery vs intentional regeneration is explicit) |
| Human editing | Artifact revision (`provenance=human_edit`) | **API foundation complete** — `POST /artifacts/:id/revise` (stale-base guarded) creates a new draft revision, `GET /artifacts/:id/history` exposes the chain, prior revisions and their approvals/publications stay pinned. **Deferred**: editor UI |
| Approval workflow | Artifact readiness | IMPLEMENTED (`draft → in_review → approved \| rejected`, pinned per revision; approval never carries to a new revision) |
| Scheduling | Schedule → Occurrence | PARTIALLY IMPLEMENTED — durable scheduler tick + `every:<n><unit>` recurrence. Phase 16: one independent Schedule per Publication target (distinct `startAt`). Calendar/RRULE still deferred |
| Publishing | Publication → ChannelAdapter | **IMPLEMENTED** for X and LinkedIn. One Artifact revision → N independent Publications (`POST /api/artifacts/:id/publications`). `Publication.channel` is the delivery target. Threads/Instagram/YouTube: DEFERRED |
| Publication reconciliation | Publication lease + `Result(unknown)` | PARTIALLY IMPLEMENTED — reconcile-first per Publication (X write-action + LinkedIn listing). Never creates a second Publication for the same occurrence. Cannot safely confirm "not published" |
| Analytics | Publication → Result → PerformanceSignal → LearningSignal | PARTIALLY IMPLEMENTED — **P-8 corpus exists**: typed edit/approval/publication/performance/derived signals, timestamped metric snapshots, ChannelAdapter metric seam (X mapped; LinkedIn `not_available`), descriptive summaries, owner isolation. **Not** post-level ranking, best times, topic/voice performance scores, or research→performance recommenders. Legacy `analytics`/`viral_scores` remain a closed posts-table island. No UI |
| Image generation | Visual provider → VisualGeneration → VisualAsset → Artifact | PARTIALLY IMPLEMENTED — **durable pipeline complete** including bounded `variationCount` (1–8), ordered assets, partial-success, SQL uniqueness, `VisualSpec` registry, async `visual.run`. Fixture producer is live-green. `openai-image` is a real `VisualProviderPort` on the existing AI client; live OpenRouter `openai/dall-e-3` returned 404. Deferred: working vendor model on this deployment, UI |
| Carousel | Opportunity(format) → VisualGeneration → Artifact | PARTIALLY IMPLEMENTED — **one generation → N ordered `carousel_slide` assets** + payload `slides[]` (2–10) + `visual_asset_refs` positions. Incomplete generations stay `partial` and cannot become ready. Publishing X/LinkedIn carousels: **DEFERRED**. No slide-layout UI |
| Carousel generation (visual slides) | Visual provider (`generate_slide`) as ContentForge composition | IMPLEMENTED for production of ordered assets via the generic provider; native multi-image vendor APIs not required. Real vendor slides: same as image generation |
| Image editing / transformation | new VisualGeneration (`refine_image`) → new VisualAsset | PARTIALLY IMPLEMENTED — explicit refine HTTP/API; source asset immutable; worker loads bytes via AssetStoragePort. `edit_image` remains declared but unproduced. No in-place mutation |
| Thumbnail | VisualAsset → Artifact (`thumbnail` payload) | PARTIALLY IMPLEMENTED — payload schema + `thumbnail` spec in VisualSpecRegistry; produced like images. Deferred: derivation-from-parent policy |
| Video script | format + frozen policy export | DEFERRED (Video Factory untouched; see contract note below) |
| Second Brain / Context Vault | future context subsystem | DEFERRED — must feed policy/research context, **never bolted onto Story** |
| Style analysis of real posts | observed-evidence layer | PARTIALLY IMPLEMENTED — Phase 11 stores versioned observations; Phase 14 stores performance/edit/approval signals **without** rewriting style. Automatic re-analysis / style mutation: DEFERRED |
| One-click transforms | new Artifact revision | DEFERRED |
| Multi-brand / collaboration | identity model | DEFERRED |
| Notifications, search, activity feed | new surfaces | DEFERRED |
| Billing / subscriptions | — | DEFERRED (out of scope by design) |

## Video Factory boundary (contract only)

ContentForge owns the content/intent contract; Video Factory owns production.
No rendering code, renderer imports, or Video Factory modifications exist.

A future `video_script` flow would be:

```
Story → Opportunity → GenerationPolicy → GenerationJob
      → video_script Artifact (payload: script + visual/audio requirements)
      → external Video Factory (versioned request)
      → video asset referenced back (never produced inside ContentForge)
```

Required contract surface (not yet sent anywhere): request identity,
script payload, visual requirements, voice/audio requirements, aspect ratio,
output expectations, correlation ID, idempotency, status/result. The contract
is versioned in principle via the frozen generation policy + the format payload
schema registry; no `video_script` schema is registered yet because nothing
produces or consumes it — registering it without a consumer would be the fake
support this map forbids.

## Reference integrations

Postiz, last30days and Agent-Reach remain **references**, not dependencies:

```
last30days / Agent-Reach / future providers
        ↓
  SourceProvider
        ↓
   ResearchJob
```

They must register as providers. No Postiz code is copied or vendored, and no
second research pipeline or `channels` table may be introduced.

> Note: the session preamble asked to "always use last30days / Agent-Reach", but
> phase-1 scope (§35/§38) explicitly defers them. They stay behind the
> `SourceProvider` seam; integrating them is a research-expansion task, not this
> slice.

## Research providers (Phase 2)

One ResearchEngine, many interchangeable providers. **Research providers are
replaceable inputs to one durable ResearchEngine** — there is no per-source
pipeline, and no provider may write Evidence, Story or Opportunity directly.

| Provider | Access class | Capabilities | Status |
|---|---|---|---|
| `rss` | open | discover, search, fetch | IMPLEMENTED (pre-existing; still the only `fetch`/Stage-2 path) |
| `reddit` | open / **credentialed** when `REDDIT_ACCESS_TOKEN` is set | discover, search | IMPLEMENTED — end-to-end against a deterministic fixture; **real anonymous access is 403**, so production use needs the token seam |
| `youtube` | open | discover | IMPLEMENTED — public channel Atom feeds, metadata-only by design |
| `hn` | open | discover, search | IMPLEMENTED — real Algolia front page + search (external smoke verified) |
| `web` | open | search, fetch | IMPLEMENTED — SSRF-guarded, text-only, no browser runtime |

Capability availability is explicit and enforced by the registry: a provider that
does not declare a capability is never called for it (`youtube` has no `fetch`
because there is no transcript path on the open feed).

### Provider access classes

- `open` — no credentials, no cookies. The core stays cookie-free; no browser
  automation and no personal cookies exist anywhere in the research path.
- `credentialed` — the deployment supplies a token (`REDDIT_ACCESS_TOKEN`); the
  app never performs an OAuth dance, never stores a client secret, and never
  rotates one.
- `local-agent-only` — refused by default (`DEFAULT_ALLOWED_ACCESS_CLASSES`), and
  no such provider is registered.

### Deferred (research)

- last30days / Agent-Reach integrations (seam stays; nothing is vendored — no
  AGPL code is copied).
- Google Trends / social-volume trend providers.
- YouTube Data API backend and transcripts.
- Topic ranking / autonomous topic selection.
- Reddit OAuth token acquisition and rotation (operator-managed today).

