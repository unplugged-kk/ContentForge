# ContentForge — Research Provider Architecture

Label: `wayfinder:research` (architecture) | Workstream: ContentForge only
Parent map: `plans/contentforge-product/MAP.md` | Locked input: Ticket 04
Created: 2026-09-10 | Status: design only — no implementation

## 0. Scope and method

This document designs the **stable seam** between ContentForge's research engine
and every source of information it will ever read. It is architecture, not
implementation: no code, no migrations, no schema, no routes, no UI.

**Inspected before designing (read-only):**

- `plans/contentforge-product/MAP.md`, `plans/cannerai-parity/MAP.md`
- Wayfinder Tickets 01–08, in particular the Ticket 04 resolution (research
  architecture) and the 03/05/06/07 resolutions it depends on
- `server/discoverRefresh.ts`, `server/marketPulse.ts`, `server/rssAutopost.ts`,
  `server/youtubeConnector.ts` (read in full)
- `server/routes.ts` — ingest, reference/vault, discovery, YouTube route groups
- `shared/schema.ts` (full), `shared/xDeveloperRisk.ts` (full)
- `architecture/system-architecture.md`, `architecture/data-model.md`,
  `architecture/workflows.md`
- External prior art (architecture only, no code copied): Postiz, last30days,
  Agent-Reach

**Findings that correct or sharpen the MAP** (verified against source, not
assumed):

| # | Finding | Consequence for this design |
|---|---|---|
| F1 | **Neither `pg-boss` nor `bullmq` is installed.** `package.json` contains neither; `scheduler.ts` uses in-process `node-cron`. | Locked 06 chose pg-boss, but it is a **Phase-B prerequisite, not an existing fact**. Provider work must not assume a queue exists. |
| F2 | **ArXiv is parsed twice, differently** — regex `<entry>` extraction in `discoverRefresh.ts:201-230`, cheerio-XML in `routes.ts:1030-1047`. | Duplicate provider mechanics. Provider layer collapses these. |
| F3 | **Reddit is fetched twice** — `top.json` discovery (`discoverRefresh.ts:68-142`) and thread `.json` extraction (`routes.ts:961-997`). | Same. |
| F4 | **Generic web extraction exists twice** — `extractGenericWebpage` (`routes.ts:1054-1082`) and `/api/vault/extract-url` (`routes.ts:2579`). | Same. |
| F5 | `shared/xDeveloperRisk.ts:47-52` rule `research-no-x-scrape` says verbatim: **"Web-wide research is fine; for x.com/twitter.com only: no HTML scraping."** | The no-scraping constraint is **X-scoped, not universal**. This materially shapes AP-4 (§23). |
| F6 | `extractGenericWebpage` fetches any user-supplied URL with no private-range blocking, no size cap, default redirect following, 10s timeout. | **SSRF exposure.** §18 treats this as a first-class requirement, not a nicety. |
| F7 | `discoverRefresh.ts:265-289` injects **3 fabricated ideas** when all sources fail. | Masks total provider failure — explicitly retired by the degradation model (§13). |
| F8 | `discoverRefresh.ts:2` header comment claims "11 subreddits"; the array has **15**. | Doc drift in current code; provider config replaces it. |
| F9 | `architecture/*.md` proposes Redis+BullMQ, a `channels` entity, pgvector dedupe, and Postiz as a separate container. | **Divergent proposal, not locked.** Locked 06 says pg-boss. This document follows 01–08; §23 records the conflict. |
| F10 | `github` discovery query hardcodes `created:>2026-02-01` (`discoverRefresh.ts:179`). | Stale literal → provider config. |
| F11 | `rss_sources.lastFetchedAt` exists in schema, never written; `discovery_settings` fields have no readers. | Provider state/cursor must be real (§5), else the same rot recurs. |

**Not reopened:** Tickets 01–08. Where this design needs something they did not
settle, it becomes an explicit decision in §23.

---

# 1. Purpose

The provider layer exists to answer exactly one question:

> *"Given a research intent, what can we read, and how do we read it without
> teaching the research domain anything about a specific source?"*

### Provider responsibilities

- Own all source-specific mechanics: HTTP, auth, pagination, parsing, rate-limit
  signalling, retry-after interpretation, cursor/checkpoint state.
- Normalize provider-native shapes into one `NormalizedSource` shape **at the
  provider edge** — the engine never sees provider-native payloads.
- Declare capabilities honestly, and refuse operations it cannot perform.
- Report health and degradation truthfully, including *which backend* served.
- Enforce its own per-provider budget ceiling (given by the engine).

### Research Engine responsibilities

- Own orchestration: initiation → collect → normalize-check → rank → deep-fetch
  → synthesize → validate → freeze (locked 04 §2).
- Own budgets, deadlines, parallelism, provider selection, fallback policy.
- Own dedupe, clustering, evidence extraction, conflict relations, confidence.
- Own the frozen `ResearchJob` output and its validity rules.
- Supply correlation identity and budget to every provider call.

### Story responsibilities

- Own editorial meaning only: `title`, `insight_body`, `basis_claim_ids`,
  `angles[]`, `evidence_refs` (IDs, never copies), `provenance` (locked 05 §3).
- Reference evidence **by ID**. A Story is never an evidence store, and never
  knows a provider exists.

### Explicit non-ownership

The provider layer does **not** own: ranking, dedupe, clustering, evidence
creation, confidence, synthesis, Story creation, content generation, scheduling,
publishing, or any channel mechanics. It also does not own *which* providers run
— that is engine/config.

**One-line boundary:** providers produce *normalized sources*; the engine
produces *evidence and research*; Stories produce *editorial meaning*.

---

# 2. Design Principles

| # | Principle | Rationale / enforcement |
|---|---|---|
| P1 | **Provider-agnostic research domain** | The engine has no conditional on provider identity. Enforced by contract test: engine code contains zero provider ids. |
| P2 | **One research engine** | Directed and autonomous are *initiations*, not systems (locked 04 §1). One output shape. |
| P3 | **Directed + autonomous share everything below initiation** | Collect → normalize → rank → deep-fetch → synthesize → validate → freeze is identical code. |
| P4 | **Providers are replaceable** | Removing or upgrading any provider changes no engine code. |
| P5 | **Provider mechanics stay at the edge** | Parsing, auth, pagination, cookies, CLIs, sidecars: all inside the provider. |
| P6 | **Normalized evidence enters the core** | Only `NormalizedSource` crosses the seam; provider-native shapes never do. |
| P7 | **Provenance is preserved end-to-end** | Provider identity, backend identity, version, retrieval method, and retrieval time ride on every source → evidence → ResearchJob. |
| P8 | **Source identity is stable** | Identity keys are `(provider, kind, nativeId)` fused with canonical URL; not titles, not array positions. |
| P9 | **Provider failures are explicit** | Typed, classified, recorded. No silent empty arrays; no fabricated fallback content (retires F7). |
| P10 | **Provider fallback is observable** | Which backend served, what failed, whether a fallback occurred — all recorded on the result. |
| P11 | **No provider-specific tables in the core domain** | Providers may have their own state store (§5, §20); the research domain does not. |
| P12 | **No provider-specific prompts in the domain model** | Synthesis prompts are engine-owned and provider-blind. |
| P13 | **Research is reusable** | ONE ResearchJob → ONE frozen result → N Stories → N Opportunities → N Artifacts. |
| P14 | **Format change never re-runs research** | New format = new Opportunity on the same Story (locked 05 §9). |
| P15 | **Security/trust boundaries are explicit** | Retrieved content is untrusted data, never instruction. Access class is declared per provider. |
| P16 | **Partial success is valid** | A multi-source job that loses sources still yields valid research, provided ≥1 sourced claim survives (locked 04 §2/§6). |
| P17 | **Deterministic by default** | Provider/backend selection is config-ordered and health-gated, never quality-guessed, so research is explainable and reproducible from its record. |
| P18 | **Budget is an input, not an afterthought** | Every provider call receives a ceiling and a deadline; exceeding it fails fast and cheaply. |

---

# 3. SourceProvider Contract

The seam is deliberately small: **three optional operations plus declaration and
probe.** Everything else is provider-internal.

> Conceptual contract only — not production code, not a file to create yet.

```ts
// ---------- Capability declaration ----------
type Capability =
  | "discover"   // find candidates with no query (browse/seed)
  | "search"     // find candidates for a query
  | "fetch";     // retrieve canonical content for a known ref

// ---------- Identity ----------
interface SourceProvider {
  readonly id: string;              // registry key: "hn", "reddit", "rss", "youtube", "web", "trends", ...
  readonly contractVersion: string; // contract this provider implements, e.g. "1"
  readonly version: string;         // provider/adapter's own version
  readonly capabilities: readonly Capability[];
  readonly accessClass: AccessClass; // "open" | "credentialed" | "local-agent-only"

  // Optional — present IFF declared in capabilities. Engine must never call an undeclared op.
  discover?(ctx: DiscoverContext): Promise<NormalizedSource[]>;
  search?(ctx: SearchContext, query: ResearchQuery): Promise<NormalizedSource[]>;
  fetch?(ctx: FetchContext, ref: SourceRef): Promise<NormalizedSource>;

  // Optional. Deep, capability-level health probe (§12). Absence => probe is "unknown".
  probe?(): Promise<ProviderHealth>;
}

// ---------- Context (engine-owned, passed in) ----------
interface BaseContext {
  readonly correlationId: string;   // ResearchJob id; stamped on every result
  readonly deadline: Date;          // absolute; provider must not exceed
  readonly budget: ProviderBudget;  // ceilings the provider must respect
  readonly config: Readonly<Record<string, unknown>>; // this provider's config slice
}
type DiscoverContext = BaseContext & { readonly window?: TimeWindow };
type SearchContext   = BaseContext & { readonly window?: TimeWindow; readonly limit?: number };
type FetchContext    = BaseContext;

// ---------- Reference ----------
interface SourceRef {
  readonly provider: string;        // owning provider id
  readonly kind: string;            // provider-defined: "story" | "post" | "video" | "paper" | "page" | ...
  readonly nativeId: string;        // provider-native identifier
  readonly canonicalUrl: string;    // normalized absolute URL
}
```

### Operation semantics

| Operation | Input | Output | Ownership | Failure behaviour | Mandatory? |
|---|---|---|---|---|---|
| `discover` | `DiscoverContext` (window, budget, deadline) | `NormalizedSource[]` (candidates, may be empty) | Provider performs browse/seed; engine supplies window & budget | Typed provider error, or `[]` **with** a diagnostic. Never fabricated results. | Optional — only for providers with a browse/seed notion (HN, Reddit, RSS, trends, YouTube channels) |
| `search` | `SearchContext` + `ResearchQuery` | `NormalizedSource[]` (candidates) | Provider maps query → its own query language; engine never builds provider queries | Typed error; empty is valid but must be distinguishable from failure | Optional — only for providers that can query (HN, Reddit, GitHub, ArXiv, web, YouTube, last30days) |
| `fetch` | `FetchContext` + `SourceRef` | **one** `NormalizedSource` with full `content` | Provider retrieves canonical content suitable for evidence extraction | Typed error; must not return a "best effort" body silently | Optional — only for providers whose candidates can be deepened (all except pure-feed cases) |
| `probe` | none | `ProviderHealth` | Provider runs a real capability-level check | Probe failure is itself a health result, not an exception | Optional |

### Deliberate omissions (the "smallest seam" argument)

The following were **considered and rejected** as contract operations, because
each would leak provider mechanics into the engine:

| Rejected operation | Why rejected | Where it lives instead |
|---|---|---|
| `paginate` | Paging is a provider's business; the engine asked for N results, not N pages. | Provider config + `limit` in context |
| `subscribe` / `stream` | Turns the engine into a webhook router; conflicts with pull-based engine orchestration. | Scheduled `discover` calls |
| `authenticate` / `refreshToken` | Auth is provider mechanics; the engine must not know OAuth exists. | Provider internals + vault |
| `listSources` / `listChannels` | Confuses provider config with domain config. | Provider config store (§5) |
| `embed` / `score` | Ranking is engine-owned (P1, §11). | RankingHook |
| `extractEvidence` | Evidence creation is the engine's (see §8 boundary). | Engine |
| `fetchComments` / `fetchTranscript` as separate ops | Explodes the contract per source shape. | `kind` + capability-appropriate content inside one `fetch` |
| `healthCheck` as required | Not every provider can afford a probe; declaring the *shape* is enough. | Optional `probe` |

**Stability claim:** `discover`/`search`/`fetch` + declaration + optional probe
has absorbed every source examined — feeds, APIs, forums, video, papers,
trends, arbitrary pages, and external agent providers. A new source shape
changes `kind`, `metadata`, and provider internals; it does not change the
contract. Contract changes are versioned (§21) and additive within a major.

---

# 4. Provider Capability Model

Three concepts that are constantly conflated and must stay separate:

| Concept | Definition | Example | Who owns it |
|---|---|---|---|
| **Source / channel** | A logical place information comes from | `reddit`, `youtube`, `last30days`, `web` | ContentForge (registry + config) |
| **Capability** | What can be *done* against that source | `search`, `fetch`, `fetch-transcript` | Declared by the provider |
| **Implementation / backend** | The concrete mechanism doing it | `twitter-cli`, `yt-dlp`, `OpenCLI`, an HTTP API, a sidecar | Provider-internal, invisible to the engine |

**Rule:** the engine reasons in *source capability* terms only. It never learns
backend names, and cannot depend on them.

### Capability vocabulary

Contract-level capabilities are only the three operations. **Source-level
capabilities** are descriptive metadata a provider advertises so the engine can
plan work (e.g. "this query can be time-windowed", "this source yields
engagement metrics"). They are *hints for planning*, never a code path.

| Source-level capability | Meaning | Consumed by |
|---|---|---|
| `discover` | Can produce candidates without a query | Engine collection planning |
| `search` | Can answer a directed query | DirectedInitiation |
| `fetch` | Can deepen a ref to full content | Stage-2 fetch |
| `transcript` | Fetch can return spoken-word text | Engine (topic extraction) |
| `comments` | Fetch can return discussion bodies | Engine (discussion signal) |
| `engagement` | Results carry engagement signals | RankingHook input |
| `time-window` | Supports explicit recency windows | Dispatchers |
| `historical` | Can query the past, not just now | Directed research |
| `structured-metadata` | Provides typed fields beyond text | Engine normalization check |
| `pagination` | Can return more than one page | Provider-internal; surfaced as `limit` |
| `bulk` | Can return many items per call cheaply | Budget planning |

**Worked example (YouTube).** The engine sees source `youtube` with
`{ search, fetch, transcript, engagement, time-window, pagination }`. It issues
a `search`, gets candidate video refs, shortlists some, and calls `fetch` on
those refs; each result may carry `content.text` (transcript) and
`engagement.raw`. The engine never learns that the backend is RSS + oEmbed +
yt-dlp, never deals with XML or caption formats, and never has a YouTube branch.
Swapping the backend leaves the engine untouched.

**Worked example (last30days).** Source `last30days` with
`{ search, discover, engagement, time-window, historical }`. From the engine's
view it is a peer of `reddit`, not a special case. Its multi-source internals are
*inside* it (see §14).

### Declaring vs performing

A provider may *declare* a capability and still fail it at runtime (auth expired,
backend blocked). Declaration is a contract; health is the runtime truth.
**The engine must treat a declared-but-failing capability as degradation, not as
an orchestration error** — this distinction is what makes §12 and §13 work.

---

# 5. Provider Registry

### How providers are registered and identified

- A provider is **code registered under a stable string id** (`hn`, `reddit`,
  `rss`, `github`, `arxiv`, `trends`, `youtube`, `web`, `last30days`,
  `agent-reach`, …). Ids are the registry keys and are **never reused** with a
  different meaning.
- Registration is a single append to a registry map at startup. Adding a source
  means *registering a provider*, never creating a pipeline (the required
  invariant).
- Each registration records: `id`, `capabilities`, `accessClass`,
  `contractVersion`, `version`, and a factory that receives the provider's
  config slice.

### Instances vs types

Two levels:
1. **Provider type** — the registered code (`rss`, `youtube`).
2. **Provider instance / source config** — a configured use of that type
   (a specific RSS feed set, a specific YouTube channel list, a specific
   subreddit set). Instance identity = `type + configKey`.

This is what allows 48 RSS feeds to be one provider rather than 48 pipelines,
while still letting a single feed be disabled.

### Configuration model

| Concern | Representation | Notes |
|---|---|---|
| Enable / disable a provider | Provider config flag | Replaces the readerless `discovery_settings.enabledSources` (F11) — wired for real or removed. |
| Enable / disable an instance | Per-instance flag | Replaces RSS/YouTube `isActive`, generalized. |
| Queries, subreddits, channels, geos, feed lists | Provider config entries | Replaces every hardcoded literal (HN query, 15-subreddit array, `geo=US`, GitHub `created:>2026-02-01` (F10)). |
| Domain/topic vocabulary | Engine config (autonomy config) | Replaces `NICHE_TECH_TERMS` in the provider; belongs to the engine's ranking context (locked 04 §3/§10). |
| Budget ceilings | Provider config + engine override | Engine wins at runtime (§19). |

**Ownership rule:** *provider config* describes how to read a source. *Domain
config* describes what the user cares about. These must not merge — the current
code merges them (`NICHE_TECH_TERMS` inside `marketPulse`) and that is precisely
why the vertical is hardcoded.

### Version representation

- `contractVersion` — which SourceProvider contract shape the provider implements.
- `version` — the provider adapter's own version (bumped on behavior change).
- `integrationVersion` — for external providers, the pinned upstream version
  (§14/§15/§21).

All three are recorded on every result, so evidence produced months apart is
still interpretable.

### How the engine selects a provider

Deterministic, in order:

1. **Eligibility** — provider declared the required capability and is enabled.
2. **Access** — `accessClass` permitted in this deployment (see §18/§23).
3. **Health** — provider not in cooldown for *that capability* (§12).
4. **Config order** — the initiation's `source_hints` or the domain config's
   ordered source list decides among equals.
5. **Record** — whichever provider actually served is stamped on the result.

**No quality-based selection.** Selection never guesses which provider is
"better" — that would make research non-reproducible and would smuggle ranking
into dispatch (violates §11's separation).

### Health & degradation advertisement

Providers expose health through `probe()` (§12) and through per-result
diagnostics. Degradation is *reported*, never *hidden*: a provider that returned
fewer results because one internal backend was down says so.

### Replacing a provider without touching the engine

Guaranteed by construction: the engine holds only `(id, capabilities,
accessClass, contractVersion)` and calls the three operations. Replacement is
removing one registry entry and adding another with the same id and a superset
of the capabilities. **Acceptance test:** replace a provider and prove zero
engine-diff.

### Registry persistence

The registry (types) is code. The **configuration** (which providers and
instances are enabled, their queries, their budgets, their cursors) is data.
Whether that data lives in a config table, a JSON document, or the existing
`discovery_settings`/`rss_sources`/`youtube_channels` tables is **AP-11** (§23);
this document does not presume a schema.

---

# 6. Multi-Backend / Fallback Model

Prior art: Agent-Reach's channel model — *each channel is an ordered list of
preferred + fallback backends, each really probed, first fully-working one wins*;
backends rotate as platforms change and the user sees nothing.

### The two fallback tiers

```
TIER 1 — inside a provider (automatic, health-driven)
  Logical capability  (e.g. reddit.search)
        ↓
  Backend A  (preferred)      ← probed, healthy → used
        ↓ (unhealthy / runtime failure)
  Backend B  (fallback)       ← probed, healthy → used
        ↓
  Backend C  (last resort)    ← exhausted → capability unavailable

TIER 2 — across providers for the same logical source (config-declared)
  Logical source "recent-discussion"
        ↓
  Provider "last30days"  →  Provider "native providers"  →  give up
```

**Tier 1 is the primary mechanism and the one adopted from Agent-Reach.**
Backends are *internal* to a provider. The engine sees one provider, one result
set, and a diagnostic saying a fallback occurred. This keeps the engine's view
stable and is why backend identity is recorded but never reasoned about.

**Tier 2 exists but must be rare and explicit.** When two *different providers*
can serve the same purpose (last30days's Reddit coverage vs a native Reddit
provider), that redundancy is declared in configuration as an ordered list — not
discovered at runtime. Tier 2 is deterministic, recorded, and user-visible.

### Selection, health, retry, cooldown, circuit breaking

| Concern | Design |
|---|---|
| **Selection order** | Config order. First backend whose probe is `healthy` (or `unknown`, if the provider opts in) wins. Deterministic. |
| **Probe** | Capability-level, cheap, cached (§12). Runs on registration, on schedule, and before high-cost operations. |
| **Runtime failure** | A backend that fails an operation is marked `degraded` for **that capability** and the provider immediately tries the next backend within the same call — no engine round-trip. |
| **Retry** | Bounded and class-aware (§13). `transient` → one in-call retry with jitter; `rate_limited` → honor `Retry-After`, mark cooldown; `permanent`/`policy` → no retry, advance to next backend. |
| **Cooldown** | Per `(provider, backend, capability)`. Duration from `Retry-After` when present; otherwise exponential from provider config. Cooldown is advisory to the dispatcher and enforced by the provider. |
| **Circuit breaking** | Provider-internal. After N consecutive failures for a capability, that backend is `open` for a cooldown window, then `half-open` (one probe request) before resuming. Not over-engineered: a counter, a timestamp, a threshold. |
| **Recovery** | Cooldown expiry → `half-open` → single probe → `healthy`. Recorded so a recovered backend is visible. |
| **Observability** | Every result records `{provider, backend, fallbackOccurred, backendsAttempted[]}`. Per-call telemetry in §22. |

### Determinism vs adaptivity — the rule

**Selection is deterministic; health is adaptive.** The system adapts to
*availability*, never to *perceived quality*. Concretely:

- Allowed adaptive inputs: probe status, cooldown state, circuit state.
- Forbidden adaptive inputs: engagement, relevance, past result quality,
  "this backend usually finds better stuff".

**Reproducibility is not achieved by re-running selection — it is achieved by
recording it.** Every `NormalizedSource` and every piece of evidence carries the
provider, backend, version, and retrieval method that produced it. Re-running a
research job may take a different path; the *record* of what path was taken is
permanent. That is what makes the pipeline auditable.

### What the engine must not care about

Whether the backend is an API, a CLI, a library, an HTTP service, a sidecar, or
a local agent. The provider's `id`, `capabilities`, and `accessClass` are the
engine's entire view. This is the whole point of Tier 1: **backend plurality is a
provider implementation detail.**

---

# 7. Discovery vs Search vs Fetch

### Definitions

| Operation | Question it answers | Returns | Cost profile |
|---|---|---|---|
| **Discover** | "What exists right now that might be worth researching?" | Candidates, no query | Cheap-ish, broad, scheduled |
| **Search** | "What exists for *this* question?" | Candidates for a query | Directed, budgeted per query |
| **Fetch** | "Give me the canonical content behind this candidate." | One full source | Expensive, bounded by shortlist size |

They are separate because they have **different cost, different frequency, and
different trust**. Conflating them is how the current code ends up doing full
extraction on every discovered item.

### The two-stage pattern (locked 04 §2)

```
   discover / search          ← Stage 1: cheap, broad, many candidates
          ↓
   candidate selection        ← engine: dedupe → cluster → rank (RankingHook)
          ↓
   fetch (shortlist only)     ← Stage 2: expensive, narrow, bounded by budget
          ↓
   evidence                   ← engine: excerpt + hash + source_ref
```

**Stage 1 must be sufficient to rank without fetching.** That is why
`NormalizedSource` carries `title`, `excerpt`, `publishedAt`, and
`engagement.raw` at candidate time. If ranking required full bodies, the budget
model would be meaningless.

**Stage 2 is shortlist-bounded.** The engine decides how many candidates become
fetches. Providers never decide this.

### Why ContentForge needs all three

- **Discover alone** cannot answer a directed question ("what is the community
  saying about Postgres queues?").
- **Search alone** cannot drive autonomous discovery ("what is worth covering
  today?") — there is no query yet.
- **Fetch alone** cannot exist — you cannot fetch what you have not found.

Together they are exactly the two initiations (locked 04 §3) sharing one
pipeline: `AutonomousInitiation` leans on `discover`; `DirectedInitiation` leans
on `search`; **both** require `fetch` to produce evidence.

### Mapping existing ContentForge behaviour onto the stages

| Current code | Stage | Notes |
|---|---|---|
| `discoverRefresh.ts` HN/Reddit/RSS/GitHub/ArXiv/Trends blocks | **discover** (with hardcoded queries — effectively discover-as-search) | Each becomes a provider `discover` (and `search` where a query is natural). |
| `marketPulse.ts` HN front page + Google Trends | **discover** | Two provider calls; the boost logic moves to the engine (§11). |
| Reddit comment fetch inside discover (`discoverRefresh.ts:113-133`) | **fetch** performed eagerly and unconditionally | Becomes Stage-2 `fetch`, shortlist-gated. This alone removes a large amount of wasted work. |
| `/api/ingest` (`routes.ts:1086`) | **fetch** by URL | Becomes `web.fetch` (plus specialized providers for known kinds). |
| `extractRedditThread` / `extractGitHubRepo` / `extractArxivPaper` / `extractGenericWebpage` | **fetch** | Four ad-hoc fetchers, two of which duplicate discovery logic (F2–F4). |
| `/api/youtube/extract` (oEmbed) | **fetch** (metadata only) | Becomes `youtube.fetch`; transcript is a new capability (§4). |
| `/api/vault/extract-url` | **fetch** (duplicate of ingest, F4) | Collapses into `web.fetch`. |
| `checkYoutubeChannels` / `runRssAutopostForBatch` | **discover** + immediate generation | Discovery side becomes provider; the generation side is *not* research and is out of scope here. |

**Hard rule:** provider-specific fetching logic must never reach Story
generation. Stories consume evidence IDs; they never know how content was
retrieved. This is already locked (03 §2, 05 §3) and the two-stage pattern is how
it stays true in practice.

---

# 8. Normalized Source / Evidence Boundary

Three distinct things, deliberately separated:

| Layer | What it is | Owner | Lifecycle |
|---|---|---|---|
| **Source metadata** | What the provider knows about a thing | Provider | Per retrieval, re-fetchable |
| **Evidence** | A pinned excerpt + hash + source reference used to support a claim | Research Engine | Immutable once the job completes |
| **Provider diagnostics** | How the retrieval went | Provider → engine | Telemetry, not domain data |

**The provider never produces evidence.** It produces `NormalizedSource`. The
engine decides which part of a source becomes evidence and pins it. This is the
single most important boundary in this document: it is what prevents provider
mechanics from becoming provenance, and it is what lets the same source support
different claims across different jobs without collision.

### `NormalizedSource` — the normalized boundary

```ts
type AccessClass = "open" | "credentialed" | "local-agent-only";

interface NormalizedSource {
  // ---- identity ----
  ref: SourceRef;                    // {provider, kind, nativeId, canonicalUrl}
  provider: string;                  // provider id
  backend: string;                   // which backend served it (recorded, not reasoned about)
  providerVersion: string;
  integrationVersion?: string;       // external provider pin
  retrievalMethod: string;           // "api" | "feed" | "html" | "cli" | "sidecar" | ...
  accessClass: AccessClass;

  // ---- bibliographic ----
  canonicalUrl: string;
  title: string | null;
  author: { name?: string; handle?: string; id?: string } | null;
  publishedAt: string | null;        // ISO-8601, provider-declared
  retrievedAt: string;               // ISO-8601, engine-observed

  // ---- content (Stage 1 excerpt / Stage 2 full) ----
  excerpt?: string;                  // ranking-sufficient snippet
  content?: {
    text: string;                    // normalized plain text — the only form the engine reads
    html?: string;                   // sanitized, optional, NEVER rendered raw
    mime: string;
    length: number;
    truncated: boolean;              // honesty about truncation
  };

  // ---- signals ----
  contentHash: string;               // hash of normalized text (dedupe identity)
  engagement?: {
    raw: Record<string, number | string>;  // provider-namespaced: {score, upvotes, stars, views...}
    normalized?: number;                   // set ONLY by a RankingHook, never by a provider
  };

  // ---- provenance / safety ----
  metadata: Record<string, unknown>; // provider-specific extras; engine treats as OPAQUE
  warnings?: string[];               // e.g. "truncated", "partial-thread", "no-transcript"
  degraded?: { reason: string; backendAttempts: string[] };
}
```

### Field-ownership rules

- `metadata` is **opaque and namespaced**. The engine may store it, may expose it
  in diagnostics, and may pass it to a RankingHook — but core code may not
  branch on its contents. This is the valve that keeps provider specificity out
  of the domain.
- `engagement.raw` keys are provider-defined and **not comparable across
  providers** (Reddit `score` ≠ HN `points` ≠ GitHub `stars` ≠ X `likes`).
  `engagement.normalized` is left for a ranking hook to compute; providers must
  never set it.
- `contentHash` is computed over **normalized text**, not raw HTML — otherwise
  the same article from two backends hashes differently and dedupe fails.
- `canonicalUrl` is produced by the provider using the shared normalization
  rules (§10), so a URL from any provider is comparable.

### The evidence boundary

The engine derives evidence from a `NormalizedSource`:

```
NormalizedSource ──(engine)──▶ Evidence
                                { id, job_id, source_ref, kind, excerpt,
                                  excerpt_hash, retrieved_at }
```

Locked 04 §5 identity is `(job_id, source_ref, excerpt_hash)` — content-addressed,
so two jobs quoting the same passage do not collide and re-quoting within a job
dedupes. Note the dependency: **`source_ref` stability (P8) is what makes
content-addressed evidence work.** This is why provider identity and native IDs
are contract-level, not metadata.

### Diagnostics boundary

Diagnostics (`warnings`, `degraded`, `backendAttempts`, latencies, counts) go to
telemetry (§22) and to the ResearchJob's job metadata — **never into evidence**.
An excerpt must not carry "this came from the fallback backend"; that is
retrieval provenance, held at job/source level.

---

# 9. Provenance

Locked rule (03 §2, 04 §5): **evidence and provenance belong on ResearchJob.**
Stories reference research by ID. This section traces how that survives the
provider seam.

```
Provider (id, version, accessClass)
   │  emits
   ▼
NormalizedSource (provider, backend, integrationVersion, retrievalMethod,
                  canonicalUrl, retrievedAt, contentHash, metadata)
   │  engine derives, pinning
   ▼
Evidence (id, job_id, source_ref → (provider, kind, nativeId, canonicalUrl),
          kind, excerpt, excerpt_hash, retrieved_at)
   │  owned by, frozen with
   ▼
ResearchJob (sources[] with per-source provenance, evidence[], claims[])
   │  referenced by ID
   ▼
Story (basis_claim_ids, evidence_refs — IDs only, never copies)
   │  basis for
   ▼
Artifact (attribution[] snippets only — never raw evidence)
```

### Interpreting "Where did this claim come from?"

The path is resolved **without touching a provider API**:

1. `Story.basis_claim_ids` → the claims supporting the insight.
2. claim → `evidence_id`(s) (locked 04 §6: sourced claims MUST cite ≥1 evidence).
3. `evidence.id` → `source_ref` → `(provider, kind, nativeId, canonicalUrl)`.
4. `ResearchJob.sources[]` → `canonicalUrl`, `retrievedAt`, `retrieval_metadata`.

So the answer is *"claim C rests on evidence E, which quotes source S, retrieved
from provider P via backend B at time T, canonical URL U."* Every element is a
stored fact. **No provider call is needed to answer it**, which is exactly why
provenance must be copied into the job at freeze time rather than looked up
later — providers change, rate-limit, and disappear; provenance must not.

### Provider-decoupling rules for provenance

| Rule | Reason |
|---|---|
| Provenance records `provider` + `backend` + `version`, not a client object | Providers are replaceable; the record must outlive them. |
| Provenance records `canonicalUrl`, not a provider-internal URL | Shareable, human-checkable, stable. |
| Provenance records `retrievedAt` separately from `publishedAt` | Recency judgments need the difference. |
| Provenance never stores credentials, cookies, or session identifiers | They are not provenance and must never leak into a job. |
| Artifacts carry only attribution snippets, never evidence copies | Locked 03 §2: nothing copies raw evidence downstream. |
| `metadata` may be stored with the source but is advisory | Storing opaque provider extras is allowed; *reasoning* on them in core is not. |

### The X-specific compliance constraint on provenance

`shared/xDeveloperRisk.ts` rule `research-no-ml-training-export` forbids using X
API content to train external ML models or bulk-redistribute it, and
`data-retention-deletion` requires deletion/export support for stored X payloads.
Consequences:

- X-derived evidence is bounded by the same retention/deletion semantics as any
  other stored X payload.
- Provider-level raw-content retention is **opt-in per provider** and must be
  capped (§18, AP-14 in §23) — storing full X bodies indefinitely is a policy
  problem, not just a storage one.

---

# 10. Deduplication and Cross-Source Clustering

Prior art: last30days merges the same story across platforms into one cluster
rather than three separate items ("Wireless Festival announced on Reddit,
discussed on X, ticket prices on TikTok = one cluster").

### Generic identity ladder

Dedupe proceeds in escalating cost, cheapest first. **Provider-agnostic by
construction** — there is no per-source duplicate system.

| Level | Key | Cost | Catches | Misses |
|---|---|---|---|---|
| L1 | `ref` = `(provider, kind, nativeId)` | zero | exact re-retrieval of the same item | same item via a different provider |
| L2 | `canonicalUrl` | zero | the same page/article/post across providers and feed variants | syndicated copies with different URLs |
| L3 | `contentHash` (normalized text) | low | identical bodies, mirrors, reworded titles with identical text | near-duplicates |
| L4 | near-duplicate (similarity/embedding, fuzzy title) | higher | syndication, quotes, lightly-edited reposts | — (fog: thresholds) |

L1–L3 ship with Phase-1 provider work. **L4 is explicitly fog** — locked 04 §9
leaves dedupe policy beyond canonical-URL default undecided, and thresholds must
not be invented here. L4 requires a storage decision (see AP-15, §23).

### Canonical URL normalization (shared, provider-side)

Every provider must produce canonical URLs using **one shared normalization**:
lowercase scheme + host, strip `www.`, drop fragments, drop tracking params
(`utm_*`, `ref`, `fbclid`, …), normalize trailing slash, resolve known redirect
wrappers, and preserve identity-bearing params. A single shared implementation
prevents each provider inventing its own — and prevents the current situation
where dedupe is a 60-character title prefix (`discoverRefresh.ts:33-41`).

### Clustering model

A **cluster** is a set of `NormalizedSource`s judged to be the same underlying
story. Clustering is engine-owned and produces:

```
Cluster {
  id
  members: SourceRef[]           // ordered by ranking; never merged destructively
  primary: SourceRef             // representative for evidence extraction
  agreement: "corroborates" | "updates" | "differs" | "contradicts" | "unclear"
}
```

**Clusters never merge content.** Every member survives with its own provenance —
this is required by locked 04 §5's conflict model, which states both claims
survive and synthesis must not silently pick a winner. Clustering is a *view*
over sources, not a destructive collapse.

### Source disagreement and updates

| Situation | Handling |
|---|---|
| Two sources corroborate | `agreement: corroborates`; both cited; confidence may rise (locked 04 §8: `verified` = multiple independent sources). |
| One source updates another (later, same subject) | `agreement: updates`; both retained; recency recorded. |
| Sources differ in detail | `agreement: differs`; both retained, no winner. |
| Sources contradict | First-class **conflict relation**, never a merge (locked 04 §5): `{claim_a, claim_b, nature, note}`. |
| Same source re-read later, changed | Treated as a **new source retrieval**, not a mutation — historical evidence is immutable. |

### Repeated research of the same subject

- Re-running research is **explicit** and produces a **new ResearchJob** with
  `parent_job_id` (locked 04 §1). It never mutates prior evidence.
- Dedupe is **within a job** (and against recent jobs for cost, not for
  correctness). Cross-job identity is for the *library* (§20), not for erasing
  history.
- The `(job_id, source_ref, excerpt_hash)` evidence key (locked 04 §5) is what
  makes both statements simultaneously true: no collision across jobs, natural
  dedupe within one — **and it depends entirely on the provider giving stable
  `source_ref`s**, which is why §8 puts identity in the contract.

### Interaction with locked ResearchJob/Story

| Rule | Source |
|---|---|
| Evidence identity is content-addressed with `job_id` | 04 §5 |
| Conflicts are first-class relations, both claims survive | 04 §5 |
| Confidence per claim: `verified` / `indicated` / `speculative` | 04 §8 |
| Story references evidence by ID; never copies | 05 §3 |
| Same research serves N formats with no re-research | 05 §9 |

Clustering feeds **claim** construction and conflict detection — it does not
create its own entity in the locked model, and it does not alter Story semantics.

---

# 11. Provider Ranking / Source Ranking

**Three distinct ranking problems**, deliberately not collapsed:

| # | Problem | Question | Mechanism | Owner |
|---|---|---|---|---|
| R1 | **Provider / backend selection** | Which executor runs this operation? | Health + config order (§6) | Registry/dispatcher |
| R2 | **Research relevance ranking** | Which retrieved results matter for this research? | `RankingHook` (locked 04 §9) | Research Engine |
| R3 | **Story / Opportunity ranking** | Which research should become content, in what form? | Opportunity selection (locked 05 §4) | Engine + policy |

**Why they must not collapse:** R1 is a *reliability* decision, R2 is a *relevance*
decision, R3 is a *strategy* decision. Merging them makes it impossible to answer
"did this rank low because the source was down, because it was irrelevant, or
because the strategy deprioritised the topic?"

### Signal ownership — the hard line

| Signal | Origin | Belongs to | Notes |
|---|---|---|---|
| Engagement (upvotes, likes, stars, views, points) | Provider | **R2 input**, provider-namespaced | Comparable only after a hook normalizes; providers must not normalize (they lack cross-source context) |
| Recency / published-at | Provider | **R2 input** | Time-window filtering is engine-declared |
| Authority / source reliability | Mixed | **R2 input**, engine-curated | Provider may supply a raw reputation hint; the *trust* judgment is ContentForge's |
| Popularity trends over time | Provider (if historical) | **R2 input** | Requires `historical` capability |
| Topic relevance | Engine | **R2** | Engine owns domain/query semantics |
| Novelty / significance | Engine | **R2** | Requires cross-job context (library) |
| Dedupe / duplication penalty | Engine | **R2** before ranking | Applied via clustering (§10) |
| User/domain preferences | Engine config | **R2 context** | From domain config, not provider |
| Content strategy / format fit | Engine + policy | **R3** | Never a provider concern |

### The `RankingHook` seam (locked 04 §9)

```
RankingHook(score(items, context) → ranked)
```

- Providers **never rank** and never sort by their own notion of importance.
  A provider may return results in its natural order; the engine re-ranks.
- `context` carries domain config, time window, and (later) library/novelty
  signals — **not** provider internals.
- The first hook implementation generalizes today's behaviour: `viralScore`
  ranking with the ×1.5 breaking-news boost from `marketPulse.ts`, with
  `NICHE_TECH_TERMS` promoted out of the provider and into domain config.
- Provider-derived engagement must be **namespaced and raw** at the seam so a
  hook can decide how (or whether) to compare across sources. Normalizing inside
  a provider would bake one source's scale into every other source's ranking.

### Determinism and audit

R2 and R3 must be **replayable from stored data**: the hook version, its inputs
(ranked items + context), and its output are recorded. Otherwise a research
result cannot be explained later. Provider-side ordering is not trusted as
ranking.

---

# 12. Provider Health and Diagnostics

The conceptual equivalent of `agent-reach doctor` / last30days' `doctor`, but
scoped to ContentForge and capability-aware.

### Probe levels (progressively real)

Agent-Reach's key lesson: a probe that only checks *"does the executable exist"*
is nearly useless — it must **actually exercise** the capability. ContentForge
adopts escalating probe depth:

| Level | Name | Checks | Cost |
|---|---|---|---|
| L0 | **Configured** | Provider registered, config present and well-formed, enabled | ~0 |
| L1 | **Credentials present** | Required credential/token exists and is non-expired (shape only) | ~0 |
| L2 | **Reachable** | Network/auth handshake succeeds | low |
| L3 | **Capability-functional** | A *cheap real call* for the declared capability returns a valid, parseable shape | low–medium |
| L4 | **Content-valid** | Returned content satisfies the contract (non-empty text where required, hashes compute, canonical URLs normalize) | medium |

- L0–L2 run on startup and on schedule.
- **L3 is the meaningful probe** and runs before expensive operations and on a
  cadence.
- L4 runs opportunistically (it is a byproduct of real calls) and is the
  leading indicator of upstream breakage (the YouTube-RSS / Bilibili-style case:
  L2 passes while L3 fails).

### `ProviderHealth` shape

```ts
interface ProviderHealth {
  provider: string;
  contractVersion: string;
  version: string;
  accessClass: AccessClass;
  state: "healthy" | "degraded" | "unavailable" | "unconfigured" | "unknown";
  capabilities: Record<Capability, {
    state: "healthy" | "degraded" | "unavailable" | "unsupported";
    backend?: string;              // which backend is currently serving
    lastSuccessAt?: string;
    lastProbeAt?: string;
    lastError?: { class: FailureClass; message: string };
    fallbackAvailable: boolean;
  }>;
  checkedAt: string;
}
```

### Required answers

| Question | Field |
|---|---|
| Is the provider configured? | `state: "unconfigured"`, L0 |
| Is authentication valid? | L1 + `lastError.class = authentication` |
| Is the backend reachable? | L2 |
| Does the backend actually perform the capability? | **L3** — `capabilities[c].state` |
| What capability failed? | per-capability `state` + `lastError` |
| What fallback is available? | `capabilities[c].fallbackAvailable` + `backend` |
| When was the last successful probe? | `capabilities[c].lastProbeAt` / `lastSuccessAt` |
| Is the provider degraded? | `state: "degraded"` + per-capability detail |

### Surfaces

- **Operator view** — a provider health list ("reddit: search healthy via
  backend-2, fetch degraded since T, fallback available") equivalent to `doctor`.
- **Job view** — a ResearchJob records the health snapshot used at dispatch, so
  "why was this research thin?" is answerable after the fact.
- **Machine view** — health feeds §22 alerts like locked 06 §13's minimum set
  (extended with provider-level degradation).

**Not in scope:** auto-repair / auto-install. Agent-Reach installs and routes
backends; ContentForge should *report* and *degrade*, not mutate the host
(see §23/AP-5).

---

# 13. Failure and Degradation Model

### Failure taxonomy → core retry classes

Locked 06 §9 defines four core classes. Provider failures map onto them; the
provider classifies, the engine enforces.

| Provider failure | Core class | Retryable | Fallback-eligible | Notes |
|---|---|---|---|---|
| Authentication failure (expired/revoked token) | `policy_human` | No | Yes (if another backend has its own auth) | Surfaced to operator; a refresh is a human/system action, not a blind retry |
| Configuration failure (missing key, bad query) | `permanent` | No | No | Our bug; fails loudly |
| Rate limit / quota (429, `Retry-After`) | `rate_limited` | Not counted as attempt | Yes, if another backend is available | Honor `Retry-After` as **reschedule**, not retry (locked 06 §9) |
| Provider unavailable (service down, backend blocked) | `transient` | Yes | Yes | Fallback first, then cooldown |
| Upstream unavailable (source's own infra down) | `transient` | Yes | Yes (different source) | E.g. Reddit's API down but RSS alive |
| Unsupported capability (provider can't do it) | `permanent` | No | N/A | Should have been caught at dispatch (capability check) |
| Content unavailable (deleted, private, paywalled, 404) | `permanent` | No | No | Not an error — a *source-state* result |
| Timeout | `transient` | Yes | Yes | Provider must respect engine deadline |
| Malformed response (unparseable) | `transient` → then `permanent` | Yes (1), then no | Yes | One retry; if repeatable, mark capability `degraded` |
| Policy / security rejection (robots, ToS, access-class violation) | `policy_human` | **Never** | No | Loud; may disable the instance |
| Transient backend failure | `transient` | Yes | Yes | The Tier-1 case |
| Permanent provider failure (dead backend) | `permanent` | No | Yes (fallback), then `unavailable` | Circuit opens; operator notified |

### Surfacing to the ResearchJob

Every provider call records, on the job:

```
providerAttempt {
  provider, backend, capability,
  outcome: "ok" | "empty" | "failed" | "skipped",
  failureClass?, message?,
  fallbackOccurred, backendsAttempted[],
  latencyMs, resultCount, retrievedCount
}
```

**Empty ≠ failed.** "This source had nothing today" and "this source broke" are
different facts, and only an explicit `outcome` distinguishes them. This directly
retires the current all-sources-failed-injects-fake-ideas behaviour (F7) —
fabricated content must never be a failure path.

### Partial success (P16)

- Some sources succeed → **valid research**; failed sources are recorded as
  degraded and the job's confidence may be affected via the weakest load-bearing
  claim (locked 04 §8).
- Locked 04 §2: provider failures degrade to partial results and **never fail the
  job unless zero sources survive**.
- Combined with locked 04 §6 (≥1 sourced claim required for validity): **the job
  fails only when zero usable sources survive *and* zero sourced claims can be
  formed** — with the uniform `author_statement` exception for `human_input` jobs.
- A job that is valid-but-thin must say so. Thinness is data, not silence.

### All providers fail

| Situation | Behaviour |
|---|---|
| All providers fail, no evidence possible | Job → `failed` with a typed aggregate reason (which providers, which classes). No fabricated sources. |
| All *discover* providers fail but the job was directed and one *search* provider works | Job proceeds — capability-level failure, not provider-level fatal. |
| Providers succeed but yield no usable content | Job → `failed` (`no_sourced_content`), distinct from transport failure. |
| Budget exhausted before completion | Job → `failed` (`budget_exhausted`) with partial results retained as non-frozen diagnostics; never silently truncated into a "complete" job. |

---

# 14. last30days Integration Boundary

**Posture.** last30days is (a) an **external, replaceable provider** behind
`SourceProvider` for recent-discussion research, and (b) an **architectural
reference** for resolution, clustering, library, watchlists, and versioned JSON
contracts. It is **not** a subsystem, its prompt contract is **not** our domain
contract, and its internal store is **not** our store. It is actively evolving
(v3.x line), so coupling is a standing risk.

### Shape

```
ContentForge SourceProvider  (id: "last30days")
          ↓
   last30days adapter        ← maps ResearchQuery → its invocation;
          ↓                     maps its JSON → NormalizedSource[]
   last30days process/API    ← external; version-pinned; out-of-process
          ↓
    external sources         ← its business, not ours
```

### Contract

| Aspect | Design |
|---|---|
| **Input** | `ResearchQuery` (topic/query, time window, `source_hints` as *preferences*, depth) + engine budget/deadline/correlation. The adapter maps this onto its CLI/API surface. **No prompt text is exchanged.** |
| **Output normalization** | Its machine-readable JSON → `NormalizedSource[]`. Each entry: `ref` (its stable per-item id + canonical URL), bibliographic fields, `excerpt`, `content` where it provides bodies/transcripts, `engagement.raw` namespaced (upvotes/likes/odds stay labeled as such), `metadata` holding the rest **opaquely**. |
| **Versioning** | `integrationVersion` pinned in config and recorded on every result. Its `--emit=json` version is validated against a supported range; unknown/missing fields degrade gracefully rather than throw. **Its schema version is never our contract version** (§21). |
| **Timeout** | Hard per-call deadline from the engine; external process killed on expiry and recorded as `transient`. |
| **Health** | L2/L3 probe via its own doctor/preflight surface; the adapter reports `unavailable`/`degraded` — mirrors §12. |
| **Failure** | Maps onto §13 classes. A partially-degraded run (it returns fewer sources than requested) is a **valid partial result with `degraded` diagnostics**, not a job failure. |
| **Provenance** | The adapter must preserve *its* per-item source attribution (which platform a hit came from) into `metadata` and, where the item is a platform post, into `source_ref`/`canonicalUrl` — so our evidence can still answer "where did this claim come from?" at the platform level, not merely "from last30days". |
| **Security** | It is an **untrusted external process** producing untrusted content (§18). Crucially, its **browser-cookie / session-based paths must not be enabled in the server deployment** — see AP-4 (§23), which this design keeps unchanged. |
| **Upgrade / replacement** | Bump `integrationVersion`; re-run the contract test. Removal = unregister the provider; nothing in the engine, domain, or Story layer changes. |
| **What we adopt from it** | Versioned machine-readable boundaries; pre-research resolution as a *provider-internal* step; cross-source clustering (as engine logic, §10); a research library (§20); watchlist/delta framing; doctor-style diagnostics. |
| **What we must not adopt** | Its prompt contract; its internal SQLite store as our store; its `--emit=json` schema as our domain schema; its cookie-based access paths in the core server. |

### Why an adapter rather than native reimplementation

Because it is genuinely good at breadth and it moves fast. An adapter keeps the
option to reimplement later without a migration, and keeps the engine blind to
its internals. The **only** thing ContentForge depends on is: *"given a query and
a window, return a versioned JSON document we can map."* That is replaceable by
design.

---

# 15. Agent-Reach Integration Boundary

### Two models

**Model A — Agent-Reach as a server-side external provider.**
The server invokes its CLI/MCP surface directly; its credential store
(`~/.agent-reach/config.yaml`, cookies) lives on the server host.

**Model B — Agent-Reach as a local-agent capability.**
The architecture pattern is adopted (ordered backends, probed health, routing).
Access to sources requiring a real browser session is delegated to a user-run
local agent outside the server; the server never holds cookies.

### Comparison

| Dimension | Model A (server-side) | Model B (local-agent) |
|---|---|---|
| **Security** | Server host holds full-session cookies; compromise = account takeover. Credentials equal to a logged-in user sit next to the app. | Cookies stay on the user's machine. Server holds nothing usable for impersonation. |
| **Cookies / browser sessions** | Required for Reddit/FB/IG/XHS/LinkedIn paths. Directly conflicts with our server-side posture. | Containable; outside the trust boundary. |
| **Credentials** | Duplicated credential store alongside our encrypted vault — two sources of truth. | Server keeps only its own vault. |
| **Deployment** | Requires Python 3.10+, third-party CLIs, and often a residential proxy ($1/mo noted upstream) on the app host. | App host stays Node+Postgres. |
| **Multi-tenancy** | Impossible to isolate per user: one host session serves all tenants → cookies are *shared* credentials. **Disqualifying for any multi-user future.** | Per-user local agent is the only coherent multi-tenant shape. |
| **Reproducibility** | Cookie-dependent reads are non-deterministic and can silently degrade as sessions expire. | Same, but failure is visible and local. |
| **Reliability** | Upstream CLIs break without notice (documented: yt-dlp blocked by Bilibili → backend swap). On the server this is an outage. | Breaks are user-visible and user-fixable. |
| **Operational complexity** | High: system packages, PATH management, per-platform config, proxies, silent breakage. | Low for us: nothing to operate server-side. |
| **Provider availability** | Broad but fragile. | Same breadth, but gated on the user running it. |
| **ToS / ban risk** | **Real and documented upstream** ("accounts may be detected and banned; use a burner"). A server automating cookie sessions multiplies exposure and attributes it to the operator. | Risk stays with the user's own machine and account choice. |
| **Fit with locked architecture** | Conflicts with the official-API posture for anything X-related (`official-api-only`); strains the trust model for everything else. | Compatible: it is *a provider run elsewhere*. |

### Recommendation (explicit)

> **Adopt Model B.**
>
> 1. **Adopt Agent-Reach's *pattern* unconditionally** — ordered preferred +
>    fallback backends per logical source, real capability-level probing,
>    doctor-style diagnostics, deterministic routing. This becomes §6 and §12.
> 2. **Do not make Agent-Reach a mandatory server-side dependency.** The server
>    must run with zero Agent-Reach components installed.
> 3. **Permit it, optionally, as a `local-agent-only` provider** behind the same
>    `SourceProvider` contract, where the server dispatches to a user-run agent
>    and receives normalized results. Access class is enforced at dispatch (§5).
> 4. **Never enable cookie/session paths server-side.** Independent of any
>    provider's convenience.

**If this recommendation were to be changed** (i.e. Agent-Reach server-side), the
following would have to be explicitly accepted, and it is the reason the answer
is no: shared host cookies make multi-tenancy incoherent; a server-side session
store duplicates our vault; upstream breakage becomes our outage; and the
documented ban risk is transferred from a user's burner account to the operator's
infrastructure. That is not a trade this architecture should make silently.

---

# 16. Existing ContentForge Source Migration

Every existing implementation is classified **KEEP / WRAP / REFACTOR /
GENERALIZE / REPLACE / REMOVE**. Preference is behaviour-preserving migration:
the endpoints and parsing that work today keep working, moved behind the seam.

| Existing capability | Current implementation | Target provider | Operation | Verdict | Migration strategy |
|---|---|---|---|---|---|
| **Hacker News** | `discoverRefresh.ts:43-66` (hardcoded query, 15 hits); `marketPulse.ts:32` front page | `hn` | `discover`, `search` | GENERALIZE | Wrap Algolia calls as-is; promote query + `tags` to provider config. Behavior-identical first. |
| **Reddit** | `discoverRefresh.ts:68-142` (15 subs hardcoded, `top.json`, eager comment fetch) | `reddit` | `discover`, `search`, `fetch` | GENERALIZE + REFACTOR | Split: **discover/search** = subreddit listing; **fetch** = thread + comments (currently eager → make Stage-2 shortlist-gated). Merge with the duplicate thread extractor (F3). Subreddit list → config. |
| **RSS** | `discoverRefresh.ts:144-174` (20-of-48 day rotation); `rssAutopost.ts:54-79` (autopost) | `rss` | `discover`, `fetch` | GENERALIZE | Provider reads the existing `rss_sources`. **Wire `lastFetchedAt` for real** as provider cursor (F11). Rotation heuristic becomes provider config. The autopost *generation* path is not research — out of scope here. |
| **GitHub** | `discoverRefresh.ts:176-199` (hardcoded query + stale `created:>2026-02-01`) | `github` | `discover`, `search`, `fetch` | GENERALIZE | Same API calls; promote query and date window to config (F10). Fetch = repo/README/issues (already exists in `routes.ts:999-1028`). |
| **ArXiv** | `discoverRefresh.ts:201-230` (regex XML) **and** `routes.ts:1030-1047` (cheerio XML) | `arxiv` | `discover`, `search`, `fetch` | REFACTOR | **Two implementations collapse into one** (F2). Pick one parser, keep both entry points as ops. |
| **Google Trends** | `discoverRefresh.ts:232-252` (geo=US); `marketPulse.ts:46-73` (US/IN/GB) | `trends` | `discover` | GENERALIZE + REFACTOR | One provider; geos → config. Merge the two call sites (F4-adjacent). |
| **Market Pulse** | `marketPulse.ts:147-181` (HN front page + Trends → keywords → boost) | splits: `hn` + `trends` providers; boost → **RankingHook** | `discover` (provider) / ranking (engine) | REFACTOR | The **fetching** is provider work; `NICHE_TECH_TERMS`, keyword extraction, and `applyBreakingNewsBoost` ×1.5 are **engine/ranking** work and must leave the provider layer (§11). |
| **YouTube (channels)** | `youtubeConnector.ts:63-121` (RSS feed, `lastVideoId` dedupe) | `youtube` | `discover`, `fetch` | GENERALIZE | Feed polling is already provider-shaped. `lastVideoId` becomes provider cursor. The *autopost generation* tail is out of scope (not research). |
| **YouTube (video/transcript)** | `routes.ts:2646-2663` oEmbed extract; **no transcript anywhere** | `youtube` | `fetch`, `transcript` | EXTEND | Keep oEmbed; **transcript is genuinely new** capability. Do not invent it here — flagged as an implementation requirement. |
| **URL / web ingestion** | `routes.ts:1086-1420` (`/api/ingest`) + `extractGenericWebpage:1054-1082` | `web` | `fetch` | GENERALIZE + REFACTOR | Keep cheerio extraction behaviour; **add SSRF guards (§18) as a prerequisite**, then expose as `web.fetch`. `/api/ingest` becomes a thin front-end over it. |
| **Article/blog ingestion** | `detectSourceType:940-959` → generic cheerio branch; substack/medium/dev.to/hashnode classified but unhandled | `web` (+ future per-kind extractors) | `fetch` | GENERALIZE | `detectSourceType` becomes a provider **routing hint**, not a domain branch. Per-kind extractors are a registry inside `web`, not a second pipeline. |
| **Reddit/GitHub/ArXiv thread+doc fetchers** | `routes.ts:961-997`, `999-1028`, `1030-1047` | respective providers | `fetch` | REFACTOR | Move into providers; remove duplication with discovery (F2–F3). |
| **Context vault URL extract** | `routes.ts:2579-2600` (duplicate cheerio scrape) | `web` | `fetch` | REMOVE (duplicate) | Delete the duplicate; call `web.fetch` and store the vault *item*. Vault remains a **context store**, not an ingestion path. |
| **References ingest** | `references` table + `/api/ingest` writes | — | — | REFACTOR | `references` becomes a **context/source store (P-4)**, not the research sink. Evidence still belongs to ResearchJob (locked 04 §5). AP-4/P-4 boundary → AP-13 (§23). |
| **Monitored accounts** | `monitored_accounts` table — writers exist, no engine reader | `x` (future) / config | `discover` | REMOVE or WIRE | Either a real provider input or delete. No third state (locked 08). |
| **`discovery_settings` dead fields** | `enabledSources`, `minViralScore`, `customKeywords`, `monitoredXAccounts` — no readers | — | — | REMOVE | Provider enable/disable and thresholds now have real homes (§5, §11). |
| **Fabricated fallback ideas** | `discoverRefresh.ts:265-289` (3 canned ideas when all sources fail) | — | — | REMOVE | **Explicitly prohibited** by P9/§13. Failure must be visible. |
| **`rss_sources.lastFetchedAt`** | Schema field, never written | provider cursor | — | KEEP + WIRE | Becomes real provider state, or is removed. |

**Migration principle:** for every row above, the first step is a
**behaviour-preserving** move — same endpoint, same parsing, same output — so the
seam can be verified before any new capability is added. Only then are hardcoded
queries, geos, and subreddit lists promoted to config.

---

# 17. Research Engine Boundary

```
                 INITIATION
              (directed | autonomous | human_input)
                        │
                        ▼
                 RESEARCH ENGINE
        owns orchestration, budgets, deadlines,
        parallelism, selection policy, dedupe,
        clustering, evidence, conflicts, confidence,
        validity, freezing
                        │
                        ▼
                PROVIDER REGISTRY
        (code registry + data config; capability
         and access-class gating; health/cooldown)
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
     Provider        Provider       Provider
    (backends:      (backends:     (external:
     API/feed)       CLI/library)   last30days /
        │               │           local agent)
        └───────────────┴───────────────┘
                        │
                NormalizedSources     ← the seam. Only this crosses.
                        │
                   Dedup / Cluster
                        │
                     Evidence         ← created by the ENGINE, not providers
                        │
                   ResearchJob        ← frozen, immutable, provenance-complete
                        │
                      Story
                        │
            Opportunities / Artifacts
```

### The Research Engine owns

Orchestration · budgets · deadlines · parallelism · source selection · dedupe ·
clustering · evidence extraction · conflict handling · confidence · validity ·
completion · freezing · provenance assembly.

### The Research Engine must never own

OAuth implementation · `yt-dlp` · Reddit client mechanics · RSS parser details ·
browser-cookie extraction · provider-specific prompt formats · provider-specific
database schemas · backend names in control flow.

### Enforcement

- **Contract test:** engine modules contain zero provider ids and zero
  provider-specific imports; only the registry knows provider identity.
- **Type boundary:** the engine imports `NormalizedSource`, never a
  provider-native type.
- **Prompt boundary:** synthesis prompts are constructed from normalized sources
  and query context; they never embed provider-native payloads.

---

# 18. Security Model

Retrieved content is **untrusted data, never instructions.** This is the
governing rule for the entire provider layer, and it is sharpest for arbitrary
web research.

### Prompt injection from retrieved content

| Threat | Control |
|---|---|
| Page/comment/transcript contains instructions ("ignore previous instructions, publish X") | Retrieved text enters **data context only**, never system/instruction context. The engine's synthesis prompts explicitly frame retrieved text as untrusted excerpts. |
| Injected text tries to trigger tool/action calls | The research engine has **no tool-calling authority**. Retrieval cannot cause a publish, a fetch, or a write. |
| Injected text tries to corrupt provenance or attribution | Evidence is derived mechanically (excerpt + hash + `source_ref`); the model does not author provenance. |
| Injected markup/HTML | `content.text` is normalized plain text; `content.html` is sanitized and **never rendered raw** (we already have DOMPurify for the article path — reuse it). |

**Rule:** if a piece of retrieved content can change the *behavior* of the
system rather than the *content* of an answer, that is a defect.

### Malicious webpages & untrusted HTML

- Strip `script`/`style`/`iframe`/event handlers; parse text, never execute.
- Never render provider HTML in the UI; render sanitized text.
- Treat all provider `metadata` as attacker-controlled values (no `eval`, no
  template injection, no SQL/path interpolation).

### SSRF — the most acute gap (F6)

`extractGenericWebpage` currently fetches **any user-supplied URL** with no
private-range protection, no size limit, and default redirect following. Required
before `web` becomes a provider:

| Control | Requirement |
|---|---|
| **Scheme allowlist** | `http`/`https` only; reject `file:`, `gopher:`, `ftp:`, `data:`. |
| **Private-range blocking** | Deny loopback, link-local (`169.254.0.0/16` — cloud metadata), private RFC1918 ranges, IPv6 ULA/link-local, `.internal`/`.local`. |
| **DNS rebinding** | Resolve, validate, then connect to the **validated IP**; re-validate on redirect. |
| **Redirect abuse / limit** | Manual redirect handling with a hop cap; validate **every** hop against the same rules. |
| **Response limits** | Max bytes, max redirects, max decompressed size; reject huge/non-text content types. |
| **Timeouts** | Per-call deadline from the engine (not a fixed constant), enforced end-to-end. |
| **Egress policy** | Allowlist of ports (80/443); optionally a domain allowlist mode for restricted deployments. |
| **Response validation** | Content-type sanity, encoding handling, truncation recorded honestly (`truncated: true`). |

**No arbitrary-URL fetching without all of the above.** This is a
prerequisite, not a follow-up.

### Credentials, cookies, and local sessions

| Item | Rule |
|---|---|
| Provider secrets | Only via the existing encrypted vault (`enc:v1:`); never in config files that reach the browser; never logged. |
| Cookies / browser sessions | **Not permitted in the server core.** `local-agent-only` access class exists precisely so this is expressible without violating the rule (§15, §23/AP-4). |
| Temporary files | Provider-scoped, securely created, cleaned up, never world-readable; documented precedent: last30days hardened its cookie temp files after disclosure. |
| Credential leakage | Providers must not return credentials, session ids, or auth headers in `metadata`/diagnostics; the engine must strip/deny them on normalization. |

### Isolation of external processes

- External providers run **out-of-process** with a wall-clock timeout, output
  size cap, and no inherited host credentials beyond what they explicitly need.
- Their stdout/JSON is **untrusted input** — schema-validated, size-bounded,
  never interpolated into prompts or SQL directly.
- Failure to parse = `malformed response` (§13), not an exception that can take
  down the job.

### Resource limits

Per-call deadline, per-job budget, max concurrent provider calls, max bytes per
response, max results per call. Enforced by the engine and reported on the job.

### Compliance constraints already in the repo

`shared/xDeveloperRisk.ts` remains authoritative and is **provider-configurable
but not provider-optional**:

- `official-api-only` — X data/actions via official API only; no HTML scraping,
  no browser automation.
- `research-no-x-scrape` — **X-scoped**: "Web-wide research is fine; for
  x.com/twitter.com only: no HTML scraping."
- `research-no-ml-training-export` — no X content for external model training or
  bulk redistribution.
- `data-retention-deletion` — deletion/export support for stored X payloads.
- `secrets-server-side`, `rate-limit-backoff`, `billing-aware-reads` (cache
  aggressively).

**Access class is how these become architecture:** `open` (public feeds/web),
`credentialed` (our own API credentials, official), `local-agent-only`
(user-run agent, never server-side). A provider declares its class; the
dispatcher refuses to run a class the deployment disallows.

---

# 19. Cost and Budget Model

Operational resource budgeting only. **No billing, no subscription logic, no
invoicing.**

### Budget dimensions

| Budget | Scope | Owner | Enforced by |
|---|---|---|---|
| **ResearchJob budget** | Total ceiling for one research run | Engine | Engine refuses to start work that exceeds it |
| **Provider call budget** | Max calls per provider per job | Engine (per-provider) | Engine |
| **Fetch budget** | Max Stage-2 fetches per job | Engine | Shortlist sizing |
| **Token budget** | Max LLM tokens for synthesis/ranking | Engine | Model gateway (`aiCall`/`logAiUsage`) |
| **Time budget (deadline)** | Wall-clock ceiling | Engine | Passed to providers; hard kill |
| **Provider-specific cost** | A provider's own unit cost (API credits, per-call fees) | Provider | Provider must stop cleanly at ceiling |
| **Fallback cost** | Additional spend incurred by fallback | Provider → job record | Recorded; counted against the job budget |

### Where budget decisions belong

- **Engine decides** the job envelope: how many providers, how many calls, how
  many fetches, how many tokens, what deadline.
- **Provider decides nothing global.** It receives a ceiling and must fail fast
  (`budget_exhausted`) rather than silently overspend or silently return less.
- **Cost is recorded per event**, not aggregated into oblivion: one record per
  provider call (provider, backend, capability, units, unit cost, latency), plus
  existing AI-usage logging for synthesis. The existing `ai_usage_log` +
  dashboard path is kept and extended; the X budget surface
  (`X_MONTHLY_READ_LIMIT`) is the precedent for provider-level read ceilings and
  should generalize.
- **Free-tier awareness is config, not code.** Many providers are free within
  limits; ceilings live in provider config so a paid path is opt-in.

### Budget exhaustion behaviour

| Case | Behaviour |
|---|---|
| Time budget hit | Providers killed; partial results retained as diagnostics; job `failed(budget_exhausted)` unless already valid — never silently "complete". |
| Call/fetch budget hit | Remaining work skipped and **recorded as skipped**, not as empty. |
| Token budget hit | Synthesis fails cleanly with a typed reason. |
| Provider cost ceiling hit | That provider stops; others continue; provider marked `degraded(budget)`. |

**Anti-goal:** never let a budget stop turn into a thinner-but-silently-complete
ResearchJob. Thinness must be visible in the job record.

---

# 20. Caching and Reuse

### Where caching belongs

| Cache | Purpose | Key | Scope |
|---|---|---|---|
| **Provider response cache** | Avoid re-hitting a source for the same call | `(provider, backend, operation, query/config hash, window)` | Provider-internal |
| **Normalized source cache** | Reuse a fetched+normalized source across jobs | `(provider, kind, nativeId)` + `contentHash` | Engine |
| **Canonical URL cache** | Stable identity + redirect resolution | normalized URL | Shared/provider |
| **Content hash index** | Dedupe and change detection | `contentHash` | Engine |
| **Research library** | Reuse prior *research*, not just sources | query/topic + job lineage | Engine |

**Ownership:** provider caches are provider mechanics (§5: providers may have
their own state store — the core domain has no provider tables). The
**normalized source cache, hash index, and library are engine-owned**, because
they are about research reuse, not source access.

### The locked invariant

> **Changing output format must never trigger research again.**

Enforced structurally, not by caching: a new format creates a new **Opportunity**
on the same **Story**, which references the same frozen **ResearchJob** (locked
05 §9). Caching is an optimization on top; the invariant holds even with a cold
cache, because the frozen job + immutable evidence are already stored.

### Re-running research is explicit

> **Re-running research produces a new ResearchJob; it never silently mutates
> historical evidence.**

- Manual re-research → new job with `parent_job_id` (locked 04 §1).
- Scheduled/autonomous research → new job each run; each freezes its own evidence.
- Historical jobs are immutable once complete (locked 03 §2). Corrections arrive
  as new jobs.
- The **library** may link jobs (`updates`/`supersedes` relationships) — that is
  metadata over immutable records, not mutation.

### Repeated queries and repeated fetches

- Identical `(provider, operation, query, window)` within a short window → served
  from the provider response cache where the source permits it (respecting
  `billing-aware-reads`: cache aggressively for read-heavy sources).
- The same `source_ref` fetched twice in one job → one fetch, two uses.
- The same content reached via two providers → dedupe by `contentHash` (§10),
  **but both provenances are retained** (that is corroboration, and locked 04 §8
  wants it: `verified` = multiple independent sources). Dedupe must not destroy
  the fact that two independent sources agree.

### Cache honesty

Every cached result records that it was cached (`retrievalMethod: "cache"`),
with original `retrievedAt` preserved. A stale cached source must never be
presented as freshly retrieved.

---

# 21. Versioning

Five independent version boundaries. **ContentForge releases are never coupled
to last30days or Agent-Reach releases.**

| Boundary | What it versions | Change policy | Compatibility expectation |
|---|---|---|---|
| **SourceProvider contract** (`contractVersion`) | The `discover`/`search`/`fetch` + declaration + probe shape | Additive within a major; breaking = new major | Engine supports current + previous major during migration; a provider declares which it implements |
| **NormalizedSource contract** | The normalized object fields/semantics | Additive within a major; new optional fields are non-breaking | Consumers must tolerate unknown optional fields; **required fields never silently change meaning** |
| **Provider adapter** (`version`) | One provider implementation's behavior | Bump on any behavior change | Recorded on every result so evidence is interpretable across versions |
| **External integration** (`integrationVersion`) | Pinned upstream version of last30days / Agent-Reach / any external provider | Pin explicitly; bump deliberately | Validated against a supported range; unknown extras degrade gracefully; **its schema version is never our contract version** |
| **ResearchJob output** | The frozen research document shape | Additive within a major | Downstream must tolerate absent optional sections (locked 04 §7: absent = "not established", never "N/A") |

### Compatibility rules

1. **Additive by default.** New optional capability, new optional field, new
   `kind` — all non-breaking.
2. **Meaning changes are breaking**, even if the shape does not change. A field
   whose semantics shift requires a major bump.
3. **Providers declare; the engine validates.** A provider whose
   `contractVersion` the engine does not support is refused at registration, not
   discovered mid-job.
4. **Results carry their versions.** `providerVersion` + `integrationVersion` +
   `contractVersion` on every `NormalizedSource` means old evidence remains
   interpretable forever.
5. **External drift is contained.** If an external provider's JSON changes
   within our supported range, the adapter degrades gracefully (missing optional
   fields) and reports `degraded`; it must not throw out of the job.
6. **No lockstep.** Upstream shipping v3.25 does not require a ContentForge
   release. Upgrading is a config pin + contract test.

---

# 22. Observability

Minimum telemetry to answer "what happened in this research run, and why is the
result thin?"

### Per provider call

| Field | Why |
|---|---|
| `correlationId` | The ResearchJob id (locked 06 §13 discipline, research-side) |
| `provider`, `backend` | Which executor actually ran |
| `capability` | discover / search / fetch |
| `outcome` | `ok` / `empty` / `failed` / `skipped` — **empty ≠ failed** |
| `failureClass` | §13 class when failed |
| `fallbackOccurred`, `backendsAttempted[]` | Tier-1 fallback visibility (P10) |
| `latencyMs` | Performance and timeout diagnosis |
| `resultCount` | Items returned |
| `fetchedCount` | Items deepened (Stage 2) |
| `cached` | Whether the response was a cache hit |
| `costUnits` / `costUSD` | §19 |

### Per research job

| Field | Why |
|---|---|
| `correlationId` (job id) | End-to-end trace |
| `initiationKind` | directed / autonomous / human_input |
| `providerAttempts[]` | Every call, above |
| `sourcesRetrieved` / `sourcesDeduped` / `clustersFormed` | §10 funnel |
| `evidenceCount`, `claimsSourced`, `claimsGenerated` | Locked 04 §6 counts |
| `conflictsFound` | Locked 04 §5 |
| `confidenceRollup` | Derived (weakest load-bearing claim) |
| `healthSnapshotUsed` | The §12 health state at dispatch time |
| `budgetUsed` / `budgetExhausted` | §19 |
| `outcome` | `complete` / `partial` / `failed(reason)` |
| `durationMs`, model, tokens, cost | Extends existing `ai_usage_log` |

### Per provider (aggregate)

Health state per capability, last success, error class distribution, fallback
rate, cooldown/circuit state, cache hit rate, average latency, result yield.

### Alerts (minimum set)

Extends locked 06 §13's set with provider-level signals:

- A provider `unavailable` for more than one cycle.
- A capability `degraded` for N consecutive jobs.
- Fallback rate above a threshold (means the preferred backend is rotting).
- A job that completed with **zero sources from N attempts** (all-sources-failed
  visibility — the direct replacement for F7's fabrication).
- Any job `failed(budget_exhausted)`.

### Deliberate restraint

No per-provider bespoke metric families. Providers report **the same** telemetry
shape; provider-specific detail lives in `metadata`/diagnostics as opaque data.
Otherwise every new source multiplies dashboards.

---

# 23. Architectural Decisions

Ticket 01–08 decisions are **not reopened**. The following are decisions this
workstream must resolve, plus two first raised in the MAP.

## Resolved by this document

### AP-4 — Research access policy → **RESOLVED (recommendation)**

**Decision:** keep the **core server cookie-free**, and formalize access as a
declared, enforced **access class** per provider:

| Class | Meaning | Server rule |
|---|---|---|
| `open` | Public feeds, public APIs, public web | Allowed |
| `credentialed` | Requires our own official API credentials (OAuth/API key), stored in the vault | Allowed |
| `local-agent-only` | Requires a user browser session / cookies / local agent | **Refused server-side by the dispatcher.** Expressible, never runnable in the core. |

**Important sharpening (F5):** the repo's own rule text is *already* X-scoped —
"Web-wide research is fine; for x.com/twitter.com only: no HTML scraping." So
this decision does **not** newly forbid broad research; it makes the boundary
explicit and machine-enforced rather than implicit, and it extends the same
discipline to cookie-based access on *any* source for the reasons in §15
(ban risk, shared-credential multi-tenancy incoherence, duplicated vault,
upstream breakage becoming our outage).

**Consequences if this were ever overturned:** shared session credentials across
tenants; a second credential store beside the vault; a documented
account-ban risk attributed to the operator; non-deterministic reads; and a
server-side dependency on third-party CLIs that break without notice. Those must
be *explicitly accepted*, not discovered.

**Status:** recommended, awaiting human confirmation. The MAP's recommendation is
upheld, not overturned.

### AP-5 — External provider execution model → **RESOLVED (recommendation)**

**Decision:** external providers run **out-of-process behind the same
`SourceProvider` contract**, via a narrow execution boundary (subprocess with
JSON I/O, or a local HTTP service — the choice between them is an
implementation detail, not an architectural one).

- The engine never links a foreign runtime into its process.
- A provider that needs Python (e.g. a last30days adapter, `yt-dlp` for
  transcripts) supplies it **inside its own adapter boundary**; the Node app does
  not gain a Python dependency.
- Out-of-process gives us the timeout, output-cap, and isolation guarantees §18
  requires, which in-process libraries cannot.
- Standardization on a JSON I/O contract is what keeps `integrationVersion`
  pinnable and swappable (§21).

**Status:** recommended, awaiting human confirmation. This is the enabling
decision for last30days (§14) and for any `local-agent-only` provider (§15).

## New decisions raised by this document

| ID | Decision | Why it can't be avoided | Blocks | Recommended default | Deadline |
|---|---|---|---|---|---|
| **AP-11a** | **Registry config storage** — where provider instances, queries, enable flags, budgets, and cursors live (config table / JSON doc / reuse of `discovery_settings`+`rss_sources`+`youtube_channels`) | §5 needs a data home; locked 04 says "registry" without pinning the mechanism; the existing tables already hold RSS/YouTube config and dead fields (F11) | All Phase-D provider work; OD-2 from the MAP | Reuse + extend existing tables initially (behaviour-preserving), with a provider-config abstraction so storage can move later | Before first provider migration |
| **AP-13** | **`references` vs evidence** — is `references` a context/source store (P-4) feeding ResearchJob, or retired into evidence? | Two ingest sinks risk re-creating the duplicate-provenance problem locked 04 exists to kill (MAP AP-4/OD-7) | `web`/`ingest` provider migration; vault semantics | `references` = context source (P-4); evidence stays on ResearchJob exclusively | Before `web` provider lands |
| **AP-14** | **Raw-content retention per provider** | §9/§18 show retention is a policy question (X retention/deletion rules) with real storage cost; "store everything" is a compliance liability | Evidence design; provider raw-store | Store excerpts + hashes by default; full bodies only where the provider's terms allow, with a retention window | Before first external provider |
| **AP-15** | **Near-duplicate detection (L4)** — similarity/embedding store and thresholds | §10 L4 is needed for real syndication dedupe but thresholds are explicit fog (locked 04 §9) | Dedupe quality | Defer L4; ship L1–L3 (URL + hash) first; revisit with the library | Phase D late |
| **AP-16** | **Research correlation identity** | Locked 06 §13 defines the *publish* correlation (Publication idempotency key). Research needs its own correlation id stamped on every provider call and job record (§22) | All §22 telemetry | `research_job_id` as the research correlation id, propagated to every provider call | Before Phase-B research work |
| **AP-17** | **Provider health/telemetry surface** | §12/§22 require an operator view; MAP AP-7 (notifications) is separate and unresolved | Operability | A read-only provider-health surface first; alerts later | With first provider migration |

## Recorded conflict (not a decision to take now)

**F9 — `architecture/*.md` diverges from locked Tickets 01–08.** Those documents
propose Redis + **BullMQ** (with pg-boss only as a fallback), a `channels`
entity as the central configuration unit, pgvector-based dedupe, and Postiz as a
separate container. Locked 06 §6 chose **pg-boss**. This document follows the
locked tickets.

**Action:** the divergence must be reconciled before Phase-B implementation —
either the architecture docs are updated to match Tickets 01–08, or the locked
scheduler decision is formally reopened (which is *not* this document's
authority). Until then, `architecture/*.md` is **prior art, not specification**.
Note also that **neither library is currently installed** (F1), so this
reconciliation is a live blocker rather than a documentation tidy-up.

## Unresolved / fog (deliberately not decided here)

| Item | Why deferred | Recommended default |
|---|---|---|
| Ranking signal weights and novelty thresholds | Locked 04 §9 fog | Leave to the first RankingHook implementation |
| Clustering similarity thresholds (L4) | Locked 04 §9 fog | AP-15 |
| pg-boss tuning, pool sizes, retention windows | Locked 06 §15 fog | Phase-B implementation |
| Which external providers to build first | Product sequencing | §24 / roadmap (Prompt 6) |
| Auto-repair of broken backends | Out of scope by §12 | Never in core; operator-reported only |

---

# 24. Final Recommended Architecture

```
                         INITIATION
                    ┌──────────┴──────────┐
               Directed              Autonomous          + human_input
                    └──────────┬──────────┘
                               ▼
                       RESEARCH ENGINE
        orchestration · budgets · deadlines · parallelism
        selection policy · dedupe · clustering · evidence
        conflicts · confidence · validity · freezing
                               │
                               ▼
                       PROVIDER REGISTRY
        code registry (types) + data config (instances, queries,
        budgets, cursors) · capability + access-class gating
        health · cooldown · circuit state
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
   Native                Native                 External
   (open/credentialed)   (credentialed)         (any class)
   ┌──────────┐          ┌──────────┐           ┌────────────────┐
   │ hn       │          │ youtube  │           │ last30days     │
   │ reddit   │          │ github   │           │ Agent-Reach    │
   │ rss      │          │ arxiv    │           │ (local-agent-  │
   │ web      │          │ trends   │           │  only)         │
   └──────────┘          └──────────┘           └────────────────┘
        │                      │                      │
        └──────────────────────┼──────────────────────┘
                               │
                 ╔═════════════▼═════════════╗
                 ║   NormalizedSource seam    ║   ← only this crosses
                 ║  ref · provider · backend  ║
                 ║  canonicalUrl · timestamps ║
                 ║  excerpt/content · hash    ║
                 ║  engagement.raw · metadata ║
                 ║  diagnostics · accessClass ║
                 ╚═════════════╤═════════════╝
                               ▼
                    Dedup / Cluster        (generic: ref → URL → hash → [L4 fog])
                               ▼
                         Evidence          (engine-created; content-addressed)
                               ▼
                        ResearchJob        (frozen, immutable, provenance-complete)
                               ▼
                           Story           (references evidence by ID)
                               ▼
                 Opportunities → GenerationJobs → Artifacts
```

### Backend fallback (Tier 1, inside every provider)

```
   capability call
        │
        ▼
   preferred backend ──healthy──▶ NormalizedSource[]  (+ backend recorded)
        │ unhealthy / runtime failure
        ▼
   fallback backend ───healthy──▶ NormalizedSource[]  (+ fallbackOccurred)
        │
        ▼
   exhausted ─▶ capability unavailable (typed failure; cooldown; circuit opens)
```

### The five invariants this design must preserve

1. **Adding a source = registering/configuring a provider.** Never a new pipeline.
2. **Only `NormalizedSource` crosses the seam.** Provider-native shapes never do.
3. **Evidence and provenance live on ResearchJob.** Stories reference IDs.
4. **Format change never re-runs research.** New format = new Opportunity.
5. **Retrieved content is untrusted data.** Never instruction; never authority.

---

# 25. Acceptance Criteria

- [x] Existing ContentForge research inputs were inspected
      (`discoverRefresh`, `marketPulse`, `rssAutopost`, `youtubeConnector`,
      ingest/vault/reference routes, `schema.ts`, `xDeveloperRisk.ts`).
- [x] Ticket 04 was respected (one engine, two initiations, SourceProvider
      registry, two-stage fetch, evidence/provenance, fact-vs-interpretation,
      RankingHook seam, reuse invariant).
- [x] Tickets 01–08 remain locked (nothing reopened; divergences recorded, not
      resolved by this document).
- [x] SourceProvider contract is small and stable (three optional operations +
      declaration + optional probe; explicit omissions table given).
- [x] `discover` / `search` / `fetch` are clearly separated (§7 + two-stage).
- [x] provider vs backend vs source/channel are clearly separated (§4).
- [x] Agent-Reach fallback/health ideas were evaluated (§6, §12, §15) and the
      ordered-backend + real-probe pattern is adopted.
- [x] last30days ideas were evaluated (§14, and §6/§10/§20 references).
- [x] last30days is **not** made into the domain contract (§14: adapter only;
      its JSON is not our schema; its prompt contract is not ours).
- [x] Agent-Reach is **not** made a mandatory server dependency (§15: Model B,
      `local-agent-only`, zero components required server-side).
- [x] Cookie/browser-session research risk is **explicitly resolved as a
      recommendation** (AP-4, §23) and left unflagged only pending human
      confirmation.
- [x] Normalized source / evidence boundary is defined (§8), including the rule
      that providers never produce evidence.
- [x] Provenance is preserved end-to-end (§9) with the `Story → claim → evidence
      → source_ref → provider/backend/version` resolution path.
- [x] Dedupe and clustering are provider-agnostic (§10: ref → URL → hash → L4
      fog; no per-source duplicate systems).
- [x] Provider health/diagnostics are defined (§12: L0–L4 probe levels, typed
      health shape, doctor-style surface).
- [x] Failure/fallback behaviour is defined (§13: taxonomy → 4 core classes,
      fallback eligibility, partial success, all-fail, empty ≠ failed).
- [x] Existing sources have a migration mapping (§16: 18 rows, each with a
      KEEP/WRAP/REFACTOR/GENERALIZE/REPLACE/REMOVE verdict).
- [x] Security boundaries are defined (§18: prompt injection, malicious pages,
      SSRF/redirect/DNS rebinding, credentials/cookies/temp files, process
      isolation, resource limits, compliance rules).
- [x] Budget/cost boundaries are defined without billing (§19).
- [x] Caching/research reuse is defined (§20), preserving "format change never
      re-runs research" and "re-running creates a new ResearchJob".
- [x] Versioning is defined (§21: five independent boundaries; no lockstep with
      upstreams).
- [x] Observability is defined (§22: per-call, per-job, per-provider, alerts)
      using research correlation IDs.
- [x] No application code was modified.
- [x] No database schema was modified.
- [x] No Video Factory files were modified.
- [x] No Mission Control files were modified.

**Post-conditions verified at session end:** `git status` shows only this
document and previously-existing working-tree changes; no files under `server/`,
`shared/`, `client/`, `migrations/`, or any Video Factory / Mission Control
location were touched.

---

# Appendix A — Verified findings against current source

| ID | Finding | Anchor |
|---|---|---|
| F1 | pg-boss / BullMQ not installed | `package.json` (absent); `server/scheduler.ts` uses `node-cron` |
| F2 | ArXiv parsed twice (regex vs cheerio-XML) | `discoverRefresh.ts:201-230`; `routes.ts:1030-1047` |
| F3 | Reddit fetched twice (listing vs thread) | `discoverRefresh.ts:68-142`; `routes.ts:961-997` |
| F4 | Generic web extraction duplicated | `routes.ts:1054-1082`; `routes.ts:2579` |
| F5 | No-scrape rule is X-scoped | `shared/xDeveloperRisk.ts:47-52` |
| F6 | SSRF exposure in generic fetch | `routes.ts:1066-1070` (no private-range/size guard) |
| F7 | Fabricated fallback ideas | `discoverRefresh.ts:265-289` |
| F8 | Header says 11 subreddits; array has 15 | `discoverRefresh.ts:2` vs `:69-89` |
| F9 | `architecture/*.md` diverges (BullMQ, `channels`) | `architecture/system-architecture.md` §1/§2 vs locked 06 §6 |
| F10 | Stale hardcoded GitHub date | `discoverRefresh.ts:179` |
| F11 | Dead config/state (`lastFetchedAt`, `discovery_settings.*`, `monitored_accounts`) | `schema.ts:215-223,239-248,262` |

# Appendix B — Provider catalogue (target state)

| Provider id | Capabilities | Access class | Backends (illustrative) | Replaces |
|---|---|---|---|---|
| `hn` | discover, search | open | Algolia API | `discoverRefresh` HN, `marketPulse` HN |
| `reddit` | discover, search, fetch | open | public JSON (currently); fallbacks TBD | `discoverRefresh` Reddit, `extractRedditThread` |
| `rss` | discover, fetch | open | `rss-parser` | `discoverRefresh` RSS, `rss_sources` reads |
| `github` | discover, search, fetch | open | REST API | `discoverRefresh` GitHub, `extractGitHubRepo` |
| `arxiv` | discover, search, fetch | open | Atom API | `discoverRefresh` ArXiv, `extractArxivPaper` |
| `trends` | discover | open | Google Trends RSS (per geo) | `discoverRefresh` Trends, `marketPulse` Trends |
| `youtube` | discover, search, fetch, transcript | credentialed | RSS feed; oEmbed; transcript backend (new) | `youtubeConnector`, `/api/youtube/extract` |
| `web` | fetch | open | cheerio extractor registry | `/api/ingest`, `extractGenericWebpage`, vault extract |
| `x` | (future) fetch via official API only | credentialed | official API | `fetchTweetTextByIdViaOfficialApi` |
| `last30days` | discover, search | credentialed / open per source | external process | — (new) |
| `agent-reach` | per enabled channel | **local-agent-only** | external local agent | — (new) |

**Note:** `accessClass` is a per-provider declaration, but providers whose
internals span multiple sources (last30days) must declare the **most
restrictive** class among the sources they may touch in this deployment, or
expose per-channel sub-capabilities. The simplest safe rule: if any enabled
internal path needs a session, the provider is `local-agent-only`.
