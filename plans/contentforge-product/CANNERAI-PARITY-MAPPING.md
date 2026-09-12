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
| Voice / writing-style matching | Voice → GenerationPolicy → GenerationJob | PARTIALLY IMPLEMENTED — **API foundation complete**: reusable voice profiles with immutable revisions (create / revise / archive / revisions), feeding an immutable policy revision and the rendered prompt. **Deferred**: automatic style analysis of the user's own posts, and any UI |
| Templates | ContentTemplate → GenerationPolicy → GenerationJob | PARTIALLY IMPLEMENTED — **API foundation complete**: structure/variables/constraints/instructions as data, immutable revisions, deterministic rendering with explicit `[missing: var]` markers and undeclared-variable rejection. **Deferred**: authoring UI, seeded corpus |
| Platform-aware formatting | Format profile → policy prompt | IMPLEMENTED for x_post/x_thread; other pairs are one registration away |
| Multi-platform formatting | format × channel dimensions | ARCHITECTURALLY READY — only X formats are implemented; no fake placeholders registered |
| Chat-to-post | chat → Story(human) → Opportunity → GenerationJob | IMPLEMENTED — durable idempotency (`idempotencyKey` → same Opportunity/job) and explicit `regenerate`; no conversational UI |
| Repurposing (format change) | Story → new Opportunity → new Artifact | IMPLEMENTED — never re-researches, never clones evidence |
| Regeneration after rejection | GenerationJob (`regenerate`) → new Artifact revision | IMPLEMENTED (idempotent duplicate delivery vs intentional regeneration is explicit) |
| Human editing | Artifact revision (`provenance=human_edit`) | **API foundation complete** — `POST /artifacts/:id/revise` (stale-base guarded) creates a new draft revision, `GET /artifacts/:id/history` exposes the chain, prior revisions and their approvals/publications stay pinned. **Deferred**: editor UI |
| Approval workflow | Artifact readiness | IMPLEMENTED (`draft → in_review → approved \| rejected`, pinned per revision; approval never carries to a new revision) |
| Scheduling | Schedule → Occurrence | PARTIALLY IMPLEMENTED — **durable periodic scheduler tick implemented** (cron → compare-and-set claim → idempotent publication claim → pg-boss); one-shot only, **recurrence expansion still deferred and explicitly rejected** rather than faked |
| Publishing | Publication → ChannelAdapter | IMPLEMENTED for X (x_post/x_thread via existing xQuick); other channels ARCHITECTURALLY READY |
| Publication reconciliation | Publication lease + `Result(unknown)` | PARTIALLY IMPLEMENTED — reconcile-first is enforced; the X `reconcile()` resolver is a stub |
| Analytics | Publication → Result | PARTIALLY IMPLEMENTED — one durable Result per Publication; metric mappers deferred |
| Image generation | new format + payload schema + model port | DEFERRED |
| Carousel | new format + payload schema | DEFERRED |
| Video script | format + frozen policy export | DEFERRED (Video Factory untouched) |
| Second Brain / Context Vault | future context subsystem | DEFERRED — must feed policy/research context, **never bolted onto Story** |
| Style analysis of real posts | observed-evidence layer | DEFERRED |
| One-click transforms | new Artifact revision | DEFERRED |
| Multi-brand / collaboration | identity model | DEFERRED |
| Notifications, search, activity feed | new surfaces | DEFERRED |
| Billing / subscriptions | — | DEFERRED (out of scope by design) |

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

