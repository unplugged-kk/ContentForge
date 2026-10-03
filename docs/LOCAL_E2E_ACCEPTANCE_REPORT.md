# ContentForge — Local Real-World E2E Acceptance Report

**Date:** 2026-10-03 · **Mode:** audit → execute → observe (no product code changed)
**Environment:** local Docker Compose, macOS, Docker 29.6.1 · commit `0f3f108`
**Status:** PARTIAL — see §9 for what could not be executed and why.

---

## 1. Environment

| Component | Value |
|---|---|
| Stack | `docker compose up -d` → `contentforge-app` (healthy, `:3000→5000`), `contentforge-db` (`postgres:16-alpine`, `:5432`) |
| Worker | **same process as the app** — no separate worker container by design (`docker-compose.yml`) |
| Queue | pg-boss v10, schema `pgboss`, 11 job types |
| Migrations | applied on boot (`[db] database migrations applied`), 0 error lines |
| Readiness | `/api/ready` → 200 `{checks:{database:"up"}}` |
| Client | `GET /` → 200, `<title>ContentForge</title>` |

## 2. Configuration (as tested)

| Setting | Value |
|---|---|
| `AI_BASE_URL` | `https://api.commandcode.ai/provider/v1` (Command Code) |
| `AI_TEXT_MODEL` | `deepseek/deepseek-v4.1-flash` (was `google/gemini-2.0-flash-001` — **corrected, see F10**) |
| Gemini | `video.*` tasks → `gemini-3.8-flash` via the **existing gateway**; key set |
| Decision layer | `JEV_DECISION_ENGINE_ENABLED=1`, `JEV_RESEARCH_GATE=1`, `JEV_FRAMING=1`, `JEV_CONTENT_GATE=1`; Jev **unconfigured** locally (`TYPESAFE_API_KEY` absent) |

`.env.example` documents 75 keys; the local `.env` sets 36. **22 keys in use are undocumented** (F9).

## 3. Required APIs — answering "is there any other API I need?"

| Capability | API/key needed? | Evidence |
|---|---|---|
| Text generation | **Yes** — one OpenAI-compatible gateway key (`AI_API_KEY` + `AI_BASE_URL`) | `server/ai/{config,router}.ts` |
| Gemini (video) | **Only for the captionless fallback** (`GEMINI_API_KEY`); claim extraction goes through the same gateway | `research/transcript/geminiVideo.ts`, `ai/router.ts` |
| YouTube discovery | **NO API key.** Public Atom feed (`/feeds/videos.xml?channel_id=`) | `research/providers/youtube.ts` |
| YouTube transcripts | **NO API key.** `yt-dlp` subprocess, captions only | `research/transcript/fetch.ts` |
| YouTube publish | OAuth client (`YOUTUBE_CLIENT_ID/SECRET`), not an API key | `social/youtube.ts` |
| X | xQuick key | `social/x.ts` |
| LinkedIn / Threads | access token (+ app secret for Threads refresh) | `social/linkedin.ts`, `social/threads.ts` |
| Image generation | **Yes — and MISSING.** Only `openai-image` exists (needs an OpenAI-compatible *images* API); no such endpoint is configured | `content/visualProviders/openaiImage.ts` |
| Audio / video | ElevenLabs / fal (paid, gated) or local `macos-say` / fixtures | `content/visualProviders/*` |

**Conclusion: no YouTube Data API key is required anywhere in the discovery or transcript path.** The only genuinely missing capability is an **images-capable endpoint**.

## 4. Tests executed

### Phase 2 — API and security (`PASS`)
`/api/health` 200 · `/api/ready` 200 · `/api/auth/config` 200 · authenticated GETs 200 · **anonymous → 401** (including `/API/ARTIFACTS` case variant and `/api/../api/artifacts`) · **CSRF**: no token → 403, bad token → 403, good → 201 · malformed JSON → 400 · bad schema → 400 · **cross-owner id → 404** (non-leaking) · missing id → 404 · non-numeric id → 400 · **no `X-Powered-By`**, HSTS + nosniff present · **foreign Origin preflight → 401, no CORS header** · error bodies contain no stack/SQL/paths · latency **3–6 ms** on all read endpoints.

### Phase 4/5 — YouTube discovery + transcript (`PASS`, free)
- Video found keylessly via `yt-dlp "ytsearch5:platform engineering kubernetes"`.
- **Chosen: `WksAqIZ9PFA` — "Platform Engineering 2.0: Just-Enough Kubernetes and AI-Native DevOps", CNCF (Booking.com).**
- `POST /api/video/intake` → **200 `ingested`**, `sourceId 1`, `transcriptHash 7360b672…`, **38,513 chars**, **33 chunks**.
- Persisted: `video_sources` (lang `en-orig`, source `subs`, **670 cues**) + `video_chunks`. Provenance recorded.
- Not exercised: failure paths (no captions / private / timeout / non-English) — would have needed extra videos.

### Phase 6 — Gemini summary (`PASS`, 1 paid call)
- `POST /api/video/sources/1/extract {"maxChunks":1}` → **200 in 2.39 s**, task `video.extract` → **`gemini-3.8-flash`**, via the **existing gateway**.
- Claim persisted with provenance: *"Shweta Bora is a lead architect at Booking.com."* conf 0.95, risk low, `chunk_id 1`, `timestamp_ms 11390`, `source_url` = the video URL.
- No secret leakage in the response.

### Phase 7 — transcript → content (`PASS`, with caveats)
Automation policy (`providerIds:["video"]`, the URL, one `x_post/x` target) →
`ResearchJob 4 → source 3 → evidence 5 → Story 2 → Opportunity 2 → GenerationJob 2 → Artifact 2`.

- **Story 2 was synthesised from the transcript evidence** — its body carries `[excerpt#5]` verbatim from the talk.
- **GenerationJob 2 succeeded** on `deepseek/deepseek-v4.1-flash` (attempt 1).
- **Artifact 2** (draft, 240 chars): *"Everyone has a platform. Almost no one means the same thing by it. The map isn't the territory: naming something "platform" doesn't make it function as one. Define the capability your teams actually consume — then build that."* — a direct paraphrase of the transcript's opening. **The transcript does influence the post.**
- Run status: **`awaiting_approval`** — the correct human boundary; no auto-publish.

### Phase 9 — review / approval (`PASS`)
`submit-review` → 200, `in_review` · `approve` → 200, `approved` · `history` → 1 revision, unchanged (append-only). `revise` returned **400** with my body shape (schema mismatch or bad input — not investigated further).

### Phase 10 — scheduling (`PASS`, deliberately not due)
`POST /api/schedules` → **201**, status `active` (the approved-only gate passed). `dispatch` → 200 and materialised **0 occurrences** — correct, because the schedule's `startAt` is in the future.
**Occurrence materialisation was NOT exercised on purpose:** a due occurrence enqueues `publication.run`, which would attempt a **real external publish** — unauthorised at this phase.

### Phase 12 — restart (`PASS`)
`docker compose restart` → both containers healthy, `/api/ready` 200. Everything survived: users 2, research jobs 5, stories 3, artifacts 2, schedules 1, **video chunks 33**, ledger 2; artifact 2 still `approved`.

## 5. Findings

| # | Sev | Workflow | Expected | Actual | Evidence | Root cause | Repro | Prod impact | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| F1 | **High** | API contract | unknown `/api/*` → JSON 404 | **200 + HTML** (SPA catch-all) | `GET /api/definitely-not-a-route` (session) → 200 `<!DOCTYPE html>` | routers fall through to `serveStatic` | yes | Agents/curl treat a typo'd endpoint as success | Return a JSON 404 for unmatched `/api/*` before the SPA catch-all |
| F2 | **High** | Media publish | provider can fetch the media URL | **401 to any sessionless caller** | `GET /api/provider-media/bogus-token` (no session) → 401 | the global `authGate` blocks it before the grant-token check | yes | Provider-fetch media (Instagram, etc.) cannot work | Allowlist `/api/provider-media/` in `authGate`; the grant token is the auth |
| F3 | **High** | Media durability | assets immutable + retrievable later | **bytes are process-memory only** | `createLocalAssetStorage()` is a `Map`; no disk; volumes are for the multer path | only the in-memory `AssetStoragePort` is wired | yes | Every asset reference breaks after a restart | Persist bytes to a volume-backed store |
| F4 | Med | Review UI | image visible for review | **metadata card only, no `<img>`** | `workspace-cards.tsx` `VisualAssetCard` renders id/mime/hash | review path never streams bytes | yes | Owner cannot see the generated image before approving | Add an authenticated byte route for owners |
| F5 | Med | Automation | a failed generation fails its run | run stayed **`running`** for minutes; reached `failed` only later | run 1: `running` (attempt 3) → **`failed`** after later ticks/restart | failure propagates only on a subsequent tick | yes | Runs look in-flight long after the work is dead | Fail the run when its generation dead-letters |
| F6 | Med | Research fidelity | long transcript informs the post | **one 400-char evidence excerpt** from a 38,513-char transcript | Story 2: "(1 evidence item)"; artifact reflects only the opening | `deriveEvidence` clips to 400 chars; one excerpt per source | yes | ~1% of a talk can reach the post; later facts cannot | Add multi-excerpt or summarised evidence per long source |
| F7 | Med | Transcript quality | clean transcript text | **duplicated phrases** | chunks: "over and over which I have seen coming over and over again. again." | VTT rolling-caption collapse is incomplete | yes | Duplicated text reaches evidence and the post | Strengthen the rolling-dedupe in `transcript/vtt.ts` |
| F8 | ~~Med~~ **FIXED** | Image generation | one real image | **now WORKS** | `gemini-image` provider added; real Nano Banana Pro generation returned `image/jpeg 1376×768, 399,888 bytes`, asset 1 `ready`, attached to artifact 3 | no images-capable provider existed | yes | Image generation now available | **Fixed in this session** — see the Addendum |
| F9 | Low | Config docs | every used key documented | **22 used keys undocumented** | `AI_*`, `GOOGLE_*`, `X_*` OAuth absent from `.env.example` | template predates the AI gateway/OAuth additions | yes | A new operator cannot configure the AI gateway from the template | Document them |
| F10 | Low | Local config | a served model id | **404 `No endpoints found`** → job dead-lettered | `google/gemini-2.0-flash-001` on OpenRouter; provider now serves 10 models | stale model id in the local `.env` | yes | (Local only) generation cannot run | **Corrected during this test** to `deepseek/deepseek-v4.1-flash` |
| F11 | Low | AI abstraction | one gateway | **two Gemini paths** (gateway + native `fetch`) | `ai/router.ts` vs `research/transcript/geminiVideo.ts` | pre-existing | n/a | Two places to change keys/models | Fold the native path into the gateway, or document the split |
| F12 | Low | AI routing | no dead routing entries | `video.classify`, `video.premium` have **no call site** | `ai/router.ts:19-24` | declared for later | n/a | Misleads operators reading the routing table | Remove or wire them |
| F13 | Low | Legacy image route | `POST /api/images/generate` works | reads `response.data[0].url`; `gpt-image-1` returns `b64_json` | `routes.ts:2737-2746` | stale provider assumption | likely | The legacy image route probably fails with the default model | Read `b64_json` too |
| F14 | Low | Error hygiene | no driver text to clients | legacy handlers echo raw `err.message` on 500 | ~200 `res.status(500).json({message: err.message})` sites in `routes.ts` | handlers respond directly instead of `next(err)` | static | Possible Postgres/driver detail leakage | Route them through `errorHandler` |
| F15 | Info | Video API | client sees language/cue count | intake response omits `lang`/`cueCount`/`source` (present in DB) | `POST /api/video/intake` response keys | response shape | yes | An extra call is needed to see them | Include them in the response |
| F16 | Info | Middleware order | CSRF rejection before body errors | malformed JSON → **400 before 403** | `express.json` precedes `verifyCsrf` | mount order | yes | Cosmetic; no side effect | — |

## 6. Issues found and fixed

Only **configuration**, never product code (per the brief):
1. **F10** — local `AI_TEXT_MODEL` pointed at a model OpenRouter has retired → corrected to `deepseek/deepseek-v4.1-flash` via the Command Code provider, after probing the provider's model list (85 models; 6 DeepSeek).
2. Staged the **Gemini key** into the local gitignored `.env` so the one authorised Gemini call could run.

## 7. Paid / external calls made

| Call | Provider | Count |
|---|---|---|
| `video.extract` claim extraction | Gemini (`gemini-3.8-flash`) | **1** (bounded by `maxChunks:1`) |
| Text generation (`generation.run`) | Command Code (`deepseek/deepseek-v4.1-flash`) | **1 succeeded** (+1 dead-lettered under the stale model) |
| `yt-dlp` transcript fetch | YouTube (keyless) | 1 video |
| Image generation | — | **0 (blocked, F8)** |
| Publishing | — | **0 (not authorised)** |

## 8. Data created (local only)

1 test user (+1 second user for isolation tests) · 5 research jobs · 1 video source with 33 chunks and 670 cues · 1 video claim · 3 stories · 2 opportunities · 2 generation jobs (1 failed, 1 succeeded) · 2 artifacts · 1 schedule (not due) · 2 decision-ledger rows · 1 dead-lettered job.

## 9. Tests NOT run, and why

| Phase / Test | Why not run |
|---|---|
| Phase 3 + 8 — real image generation and image→artifact | **BLOCKED** — no images-capable endpoint is configured (F8); the only image provider needs an OpenAI images API |
| Phase 11 — real publish | **Requires your explicit authorisation** (explicitly gated by the brief) |
| Phase 10 occurrence materialisation | Doing so would enqueue a **real publish** (unauthorised) |
| Phase 5 failure paths (no captions / private / timeout / non-English) | Each needs another video/network fault; deferred to keep spend and runtime bounded |
| Phase 14 memory profiling | Only latency measured (3–6 ms reads); no memory instrumentation present |
| **Jev matrix J1–J10** | Jev is **unconfigured locally** (`TYPESAFE_API_KEY` absent) → every decision would return its declared fallback. Tested incidentally: triage fail-open, quality-gate hold-not-block, ledger fallback rows (§ Phase 2/7). A meaningful Jev audit requires a Jev key **and** a real agent backend (local default is `fixture`) |
| Manual vs Jev comparison | Same blocker as the Jev matrix |

## ADDENDUM — post-report work (owner-directed)

After reviewing the report the owner directed two changes, both executed locally.

### 1. F8 FIXED — Nano Banana (Gemini image) provider

New `server/content/visualProviders/geminiImage.ts`, registered in
`registerBuiltinVisualProviders()`. It calls the native `generateContent`
endpoint (`responseModalities: ["TEXT","IMAGE"]`), reads the inline image, and —
per F8 — it **is** behind `assertPaidMediaAllowed`, and it sends the key in the
`x-goog-api-key` header rather than the URL. The intent→prompt mapping is
*imported* from the OpenAI provider, not re-implemented.

**Verified live through the product path, one paid call:**

| Step | Evidence |
|---|---|
| Provider registered & selectable | `POST /api/visual-generations {providerId:"gemini-image"}` → **201** |
| Real generation | status → **`ready`**; asset 1 = **`image/jpeg`, 1376×768, 399,888 bytes** |
| Bytes validated + persisted | `visual_assets` row with real dimensions; within the mime/size/dimension caps |
| Attached to an artifact | image opportunity 4 → **artifact 3** (draft) → `visual_asset_refs` row (asset 1, position 0) |
| Review path | `GET /api/artifacts/3/visuals` returns the reference (metadata only — F4 still stands) |
| Unit tests | `geminiImage.test.ts` — **9/9 pass** (pure parsers, camelCase+snake_case, JPEG/PNG dimensions, failure taxonomy, and the paid-gate refusal) |

Note: the model returned **JPEG**, not PNG — the dimension parser read 1376×768
from the JPEG SOF marker, so that parser is validated against real bytes.

Config added (documented in `.env.example`, closing part of F9):
`GEMINI_IMAGE_MODEL`, `GEMINI_IMAGE_SIZE`, `GEMINI_NATIVE_BASE_URL`,
`GEMINI_IMAGE_TIMEOUT_MS`, and the `CONTENTFORGE_ALLOW_PAID_MEDIA` gate.

### 2. F3 CONFIRMED EMPIRICALLY (still open)

The Docker runtime (Dory) stopped mid-session and was restarted, which restarted
the app process. Afterwards the asset **row** survived but its **bytes** did not:

```
POST /api/visual-assets/1/refine  → generation 2 → FAILED
"Invalid visual input: asset \"local:c30fb77fd35f87750fb0…\" is unavailable"
```

That is F3 reproduced with a live error rather than by reading the code. Also
observed: the **PostgreSQL data survived the runtime restart** (assets 1,
artifacts 3, stories 3, chunks 33, jobs 5) — durability is fine for the database,
and missing only for asset bytes.

### 3. Jev configured locally — real decisions verified

`TYPESAFE_API_KEY` added locally → `/api/decision/status` reports
`configured: true, transport: api, engine: true`.

One real decision through the product path:

```
POST /api/decision/triage →
  c0 "Kubernetes deployment failure patterns at scale" → PURSUE  (score 0.8575, relevance 0.98)
  c1 "Celebrity gossip roundup 2026"                   → DROP    (score 0.1035, relevance 0.02)
  summary: considered 2, pursued 1, dropped 1
```

This is the first **real** (non-fallback) decision-layer evidence in this report:
it discriminates on-expertise from off-expertise content exactly as designed.

**Still not run:** the full **J1–J10 matrix** and the manual-vs-Jev comparison.
Those test *skill selection and orchestration*, which in this codebase is the
**agent runtime**, not the Jev decision layer — Jev makes bounded typed decisions
(triage, gates, framing, strategy) at specific boundaries, so J1–J10 as written
do not map onto the built architecture. Running them meaningfully needs the
non-`fixture` agent backend plus a definition of "selected skill" in that layer.
That is a scope/definitition question for the owner, not a missing key.

## 10. Remaining verification gaps

1. ~~Real image generation and image→artifact→review~~ — **since closed (see Addendum §1)**.
2. Any external publish (needs authorisation).
3. Occurrence → publication → result transitions (needs a publish authorisation).
4. Multi-target repurposing (X + LinkedIn) end-to-end — the brief's J6; not run.
5. The full Jev matrix J1–J10 and the manual-vs-Jev comparison (see Addendum §3).
6. Long-transcript fidelity beyond the first excerpt (F6).
7. Media durability across restart — **now confirmed as F3** (Addendum §2).
