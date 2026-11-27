# ContentForge — Pilot Operations Runbook & Validation Protocol

**Last Updated:** 2026-11-27  
**Branch:** `work/productization-mvp` (based on `origin/main` @ `0dca955`)  
**Companion Docs:** `docs/LOCAL_VPS_DEPLOYMENT.md` (host topology & Compose), `docs/DOGFOODING.md` (daily notes), `docs/channel-onboarding.md` (optional platform tokens), `docs/product-discovery/PRODUCT_STRATEGY.md` (M2 scope)

---

## 1. Pilot Security Defaults (Verified in Code)

Before inviting any pilot operator, confirm these safety defaults remain intact in `.env`:

| Env Variable | Recommended Pilot Value | Behaviour Verified in Code |
|---|---|---|
| `ALLOW_TRUSTED_AUTOMATION` | **unset / `0`** | Blocks `approvalMode: "trusted"` and `publicationConfig.mode: "on_approval"` with HTTP `403`; holds any legacy DB row at `awaiting_approval` (`server/content/automation.ts`). |
| `ALLOW_ENV_CHANNEL_FALLBACK` | **unset / `0`** | Owner-scoped publishing fails closed (`ownerUserId != null`) across X, Threads, Instagram, LinkedIn, and YouTube (`server/social/envFallback.ts`). No pilot user can accidentally publish via the host operator's `.env` keys. |
| `ALLOW_ENV_XQUICK_FALLBACK` | **unset / `0`** | Same fail-closed rule specifically for X/xQuick (`server/social/x.ts`). Only set alongside `SINGLE_OPERATOR_OWNER_ID=<ownerId>` for single-operator self-hosting. |
| `JEV_DECISION_ENGINE_ENABLED` | **unset / `0`** | Keeps all 10 Jev decision flags OFF (`DEC-08`); no shadow/live autonomous policy overrides. |
| `STORY_LLM_SYNTHESIS` | **unset / `0`** (or `1` when AI key configured) | `0` uses deterministic zero-cost brief synthesis (`server/story/synthesis.ts`); `1` enables hybrid LLM synthesis with strict `evidenceId` validation and deterministic fallback. |
| `ENCRYPTION_KEY` | Strong 32-byte secret | Encrypts per-user connected channel tokens at rest; **back up separately — rotating without re-encryption invalidates stored channel tokens**. |
| `SESSION_SECRET` | Strong random secret | Fail-closed session signing in production. |

---

## 2. Export-First Pilot Onboarding (Zero Channel Credentials Required)

A pilot creator can complete the entire M2 vertical slice **without connecting any X, Threads, LinkedIn, Instagram, or YouTube credentials**:

1. **Start stack (local or VPS):**
   - Local: `make up` (uses `docker-compose.yml` + `docker-compose.local.yml`, loopback `127.0.0.1:3000`).
   - VPS: see `docs/LOCAL_VPS_DEPLOYMENT.md` (`make deploy-vps`, Cloudflare Tunnel ingress, single app container — **never** run a second worker container).
2. **Create operator account:** Open `http://localhost:3000` (or pilot URL) and sign in / register.
3. **Discover & Research (`/sources` → Discover tab):**
   - Run a topic query or paste a direct `https://` URL (automatically routed to the `web` provider).
   - Confirm evidence items, conflicts, and the **Research Brief Summary** card populate; reopening the job from history or `?jobId=<id>` restores the exact brief.
4. **Synthesise & Add Expertise (`/create`):**
   - Click **Create from Research** (preserves `provenance: "researched"` and `researchJobId`) OR start from a first-hand/hybrid story (`POST /api/stories` supports `first_hand`, `researched`, and `hybrid` inputs).
   - Add your personal proof points / war-story notes in **Your Notes & Proof Points** (`input-creator-notes`) so the generator grounds personal experience instead of fabricating it.
5. **Generate & Audit (`/create` → Review):**
   - Generate an `x_post`, `x_thread`, or `threads_post` (reusing the same Story without re-running research).
   - Inspect the **Claim & Quality Audit** card (`card-claim-audit`): verify supported vs. unsupported claims, uncited numbers, ungrounded first-person flags, and paraphrase overlap (`>= 0.35`).
   - Edit individual X thread units (`{ units }` preserved) and save a new immutable human-edit revision.
6. **Approve & Export:**
   - Click **Approve** (human approval recorded as `approvedBy: "human"`).
   - Use **Copy Text**, **Copy Thread**, or **Export Markdown** (includes clickable source titles & canonical URLs joined from `/api/research/jobs/:id/sources`).
7. **Publish Manually & Close the Learning Loop:**
   - Paste and publish manually on X / Threads.
   - Log the manual publication via `POST /api/artifacts/:id/log-manual-publish` (`{ externalUrl, publishedAt, topicTag, hookType }`) — records an `exhausted` manual schedule (`providerCalled: false`, immune to scheduler dispatch) and returns `publicationId`.
   - After 24–72h, record observed metrics via `POST /api/learning/publications/:id/observations`.
   - Review `GET /api/learning/weekly-digest` for cohort medians, explicit missingness counts, non-causal confidence badges (`insufficient` / `directional` / `moderate`), and `nextExperiment`.
   - Future generations in the same `(channel, format)` automatically inject up to 3 of your recent approved `human_edit` exemplars (<=280 chars each) into `assembleContext`.

---

## 3. Optional Live Channel Publishing (Owner-Authorized Only)

Only enable live publishing when the owner explicitly authorizes credentials and reviews provider terms:

- **X (via xQuick):** Owner must confirm `xquik.com` commercial/API terms vs. official X API v2 before allowing non-founder pilot users to enter keys in Settings (`Settings → Connected Accounts → X → xQuick API Key`).
- **Threads:** Configure OAuth credentials per `docs/channel-onboarding.md` (`Access Token` in Settings).
- **Safety invariants enforced in code:**
  - Unapproved or killed-opportunity artifacts return HTTP `409`.
  - X posts/thread units failing `validateXText` fail closed with `providerCalled: false` *before* any media upload.
  - Partial thread failures record persisted `liveUnits` and block blind retries (`409`) to prevent duplicate posts.
  - Scheduled legacy posts require a strictly future `scheduledAt`.

---

## 4. Backup, Restore & Disaster Recovery

ContentForge already ships host-level `make backup` and `make restore` targets (see `docs/LOCAL_VPS_DEPLOYMENT.md` §3). Follow this procedure before any schema migration or pilot upgrade:

1. **Take a verified pre-change backup:**
   ```bash
   make backup
   ```
   Confirm the resulting `.sql` / `.dump` file is non-empty and record its timestamp & byte size.
2. **Test restore on a disposable database (never production):**
   - Restore the latest backup into a fresh local/disposable PostgreSQL database, verify row counts on `users`, `research_jobs`, `stories`, `artifacts`, `publications`, and `performance_signals`, and verify `npx drizzle-kit check` exits `0`.
   - **Status note:** Restore drill has not yet been executed against a live VPS dump in this session; owner must run one real restore drill before onboarding external pilot users.
3. **Database Migrations (`migrations/`):**
   - Migrations apply automatically on boot (`server/index.ts` `migrate()`).
   - Never hand-edit applied SQL files (`0000_init.sql`..`0035_auth0_subject.sql`).
   - Generate new migrations via `npm run db:generate`, verify `npx drizzle-kit check`, and confirm CI `Schema/Migration Consistency` (`migration-guard.yml`) passes cleanly.
4. **Secret Compromise / Incident Response:**
   - Immediately revoke compromised provider/AI keys at the vendor console (OpenAI/AI gateway, xQuick/X, Threads, Auth0, Cloudflare).
   - Rotate `SESSION_SECRET` (invalidates active sessions).
   - Never commit `.env` or paste credentials into logs/issues; confirm GitHub Secret Scanning + Push Protection are enabled on the repository settings page.

---

## 5. Privacy, Data Isolation & Offboarding

- **Per-user scoping:** All canonical domain queries (`stories`, `opportunities`, `artifacts`, `publications`, `learning/weekly-digest`, `social` credentials) enforce owner scoping (`userId` ownership check, returning non-leaking `404` on cross-owner access).
- **Secrets handling:** Stored provider tokens are encrypted at rest with `ENCRYPTION_KEY`; API responses return masked metadata only.
- **Pilot user data deletion / offboarding:** Before external pilots, document a tested per-user cascade deletion SQL/script (deleting `users` + dependent rows across `research_jobs`, `stories`, `artifacts`, `publications`, `connected_accounts`, `performance_signals`) and verify it on a disposable DB.

---

## 6. M3 Validation Protocol (Founder 5-Session Benchmark → External Pilot)

Technical completion of M2 does **not** prove product-market fit. Run this two-stage validation protocol before building any deferred feature (Jev, MCP, SaaS billing, extra channels):

### Stage A — 5-Session Founder Benchmark (Export-First)
Run 5 real weekly technical posts (Data Infra / DevOps / AI topics) and record a row per session in a local `DOGFOODING_NOTES.md` (using `docs/DOGFOODING_REPORT_TEMPLATE.md` per `docs/DOGFOODING.md`):

| Metric | Target Signal | Failure / Re-evaluate Signal |
|---|---|---|
| End-to-end time (topic → approved export) | **<= 20 minutes** | > 35 minutes or slower than writing raw |
| Claim audit usefulness | Catches >= 1 real unsupported/uncited/overstated line before posting | Consistently noisy false positives or misses obvious errors |
| Human edit distance (Post #4–5 vs. Post #1–2) | Noticeably fewer structural rewrites once voice exemplars populate | Output still sounds generic / requires full rewrite |
| Publishable rate | **>= 4 of 5** drafts actually posted (as-is or lightly edited) | <= 2 of 5 posted |
| Weekly digest actionability | Gives 1 honest next-post hypothesis without hallucinating causation | Empty or misleading |

### Stage B — 3–5 External Technical Creator Pilot (After Stage A Passes)
Recruit 3–5 DevOps/Platform/Data engineers or DevRel creators for a 2-week Export-First pilot:
- **Repeat usage:** Does each creator complete >= 2 sessions in Week 2 without prompting?
- **Willingness to pay:** Ask explicitly at Day 14 what (if anything) they would pay monthly and which workflow step would make them cancel if removed.
- **Decision gate:** Only unlock M3 commercial features (live multi-channel OAuth onboarding, billing, or Jev calibration) after >= 3 of 5 pilot creators report measurable time savings or higher publish consistency.
