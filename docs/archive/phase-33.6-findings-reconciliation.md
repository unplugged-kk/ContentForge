# ContentForge — Phase 33.6 Findings Reconciliation Matrix

**Status:** READ-ONLY reconciliation. No production code was modified by this pass.
**Worktree:** `/Users/kishore/git/cf-design/336recon`, branch `phase-33.6-findings-reconciliation`.
**Tree reconciled:** `main` @ **`d4a3760`** (`git rev-parse HEAD`), which is `0763fcf` (the "final audit" tip)
plus the 33.5 outcome doc. `git log --oneline -1` → `d4a3760 docs(33.5): parallel blocker remediation outcome — FINAL NO-GO`.
**Environment:** `DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e`, `E2E_PORT=4508`. No secret printed.

---

## 0. Method and provenance

Every prior status was **re-derived**, never carried over. Two classes of evidence are used and labelled:

- **executed** — a command actually run in this pass against the current tree (counts below in §14);
- **source** — the claim re-checked by reading the current `file:line` (E2E/Playwright suites were **not** re-run
  in this pass; where a row says "source", the assertion is the component/spec that exists in the tree now).

Important tree fact: the current tree is **newer** than the bases used by the 33.2 / 33.3 verifiers (`bcf1470`) and the
33.5 outcome (`0763fcf`). Three findings those reports logged as OPEN are already fixed on this tree
(commits `fcb743c`, `9d1073c`, `4320f47`); this is recorded explicitly where it applies.

Sources enumerated: `docs/phase-2*.md`, `docs/phase-3*.md`, `docs/final-*.md`, `docs/design-*.md`,
`docs/design-orchestration/*`, `docs/ux-audit/*`, `docs/STATUS.md`. The identifier-family sweep and the
"not located" determination is in §12.

Classification legend: **FIXED · PARTIALLY FIXED · DEFERRED · NON-BLOCKING · BLOCKER · NOT APPLICABLE**.

---

## 1. Security & authentication findings

| ID | Source | Original claim | Verification against CURRENT tree | Class |
|---|---|---|---|---|
| **SEC-01** | `final-audit-security.md` §2/§9 | `authGate.ts` compared `req.path.startsWith("/api")` case-sensitively while Express routes case-insensitively → `/API/...` bypassed the gate and became owner 1. CRITICAL. | `server/middleware/authGate.ts:43` now `const path = req.path.toLowerCase();` then `:44 if (!path.startsWith("/api"))`. `server/middleware/rateLimit.ts:30` likewise. **executed:** `npx tsx --test server/middleware/authGate.test.ts` → **10/10 pass**, incl. `does not let a case-variant path bypass the gate` and `still admits an authenticated case-variant path`. | **FIXED** |
| **SEC-03** | `final-audit-security.md` §2/§9 | `getUserId(req) ?? 1` fallback (~90–95 sites) made any gate bypass full owner-1 access. | **executed:** `grep -rn "getUserId(req) ?? 1" server` → only 2 hits, both comments (`userContext.ts:92`, `authGate.ts:41`). `requireOwnerId` referenced **104×** in `server`. `authGate.test.ts` static pin `no owner-1 fallback remains in the central identity helpers` passes. | **FIXED** |
| **SEC-02** | `final-audit-security.md` §3/§9; `final-contentforge-v1-audit.md` §4/§18.2; `phase-33.5-outcome.md` §2 | `discovery_settings` has no `user_id`; any authenticated user reads/overwrites another's `customKeywords`. HIGH / owner-isolation. | `shared/schema.ts:309-317` — table is `id, auto_refresh_frequency, custom_keywords, monitored_x_accounts, enabled_sources, min_viral_score, updated_at`; **no `user_id`**. **executed (live DB):** `information_schema.columns where table_name='discovery_settings'` → `id,auto_refresh_frequency,custom_keywords,monitored_x_accounts,enabled_sources,min_viral_score,updated_at`. `grep -rn "alter.*discovery_settings.*user_id" migrations` → none. | **BLOCKER** |
| **SEC-04** | `final-audit-security.md` §6/§9 | AI-generated `contentHtml` returned un-sanitised and rendered via `dangerouslySetInnerHTML` (`ingest.tsx:587` ← `routes.ts` `/api/content-actions/:action`) → DOM/Stored XSS. MEDIUM. | `client/src/pages/ingest.tsx:587` still `dangerouslySetInnerHTML={{ __html: variation.contentHtml \|\| "" }}`. `server/routes.ts:1673` builds `contentHtml: String(v.contentHtml \|\| v.content \|\| "").trim()` with **no** `sanitizeHtml` (function exists at `routes.ts:35`; applied only at `:703,:714,:906`). Not executed (AI unconfigured). | **NON-BLOCKING** (open, MEDIUM, latent) |
| **SEC-05** | `final-audit-security.md` §6/§9 | Raw HTML persisted server-side (`POST /api/vault`, `/api/references`) without sanitisation → latent future XSS sink. MEDIUM. | `server/routes.ts` `/api/vault` create path stores body raw; no `sanitizeHtml` on that write (only `:703,:714,:906`). Client strips tags today. | **NON-BLOCKING** (open, MEDIUM, latent) |
| **SEC-06** | `final-audit-security.md` §2/§9 | Gate checks `session.userId` present but never that the user row exists; a deleted user's session still authenticates (dangling id). LOW. | `server/middleware/userContext.ts:78-83` `requireAuthMiddleware` → `if (!req.session?.userId) …` only. No user-existence lookup. | **NON-BLOCKING** (open, LOW) |
| **SEC-07** | `final-audit-security.md` §9 | `GET /api/bookmarklet` builds a `javascript:` URL from `req.get("host")` unvalidated. LOW/informational. | `server/routes.ts:1841-1844` still interpolates `baseUrl` from the request host into the bookmarklet with no allowlist. | **NON-BLOCKING** (open, latent) |
| **preaudit SEC-01…SEC-14** | `phase-34-preaudit-matrix.md` §2 | Security *verification matrix* (tracked-secret scan, `.env` scan, CSRF, SSRF, log redaction, uploads, paid gate, error sanitisation, …). Not new findings — checks. | Each derives from the same code as above; the ones that matter: **CSRF** enforced (`server/middleware/csrf.ts`), **SSRF** guarded (`server/security/ssrf.ts`, `legacyFetchDenial.test.ts`), **masking** `maskSecret` (`client/src/lib/secret-display.ts`), **paid gate** now closed by the SEC-01 fix, **uploads** static `/uploads` documented. | **NON-BLOCKING** (checks, no new defect) |

---

## 2. Tenant-isolation matrix (`phase-34-preaudit-matrix.md` §3)

| ID | Original claim | Verification against CURRENT tree | Class |
|---|---|---|---|
| **TEN-01** | Newer-slice rows owner-scoped over real HTTP (anon 401, B→A 404). | **executed:** `TEST_DATABASE_URL=… npx tsx --test server/content/ownerIsolation.dbtest.ts` → **5/5 pass** (`anonymous callers get 401`, `owner B gets 404 …`, `owner B cannot branch paid/state-changing work`, `owner A still reaches every own row`, NULL-bridge). | **FIXED** |
| **TEN-02** | Legacy owner isolation incl. real-`Authorization`-header guard. | `server/legacyOwnerIsolation.dbtest.ts` present with the A4 guard (owner A with no account uses env token, never B's). Source-verified; covered by SEC-03/OWN-01 fix commits. | **FIXED** |
| **TEN-03** | research/agent/learning `ForOwner` reads. | `server/research/*`, `server/agent/agent.dbtest.ts`, `server/content/learning.dbtest.ts`, experimentation/policyActivation dbtests present; DB suite ran green for these on a fresh DB. | **FIXED** |
| **TEN-04** | Autonomy foreign candidate → `UNKNOWN_STATE`, no leak. | `server/content/autonomy/autonomy.dbtest.ts` owner-isolation case passes (part of the 17/20 that pass). | **FIXED** |
| **TEN-05** | Legacy NULL-attributed bridge visible to any authenticated user (R1a). | **executed:** ownerIsolation `legacy NULL-attributed rows remain visible (documented bridge)` **passes**. | **NON-BLOCKING** (documented residue) |
| **TEN-06** | Shared voices/templates/policies config (R1b). | Readers present; explicit single-tenant decision. No per-row mutation. | **NON-BLOCKING** (documented) |
| **TEN-07** | `/api/publications/dispatch` not owner-scoped (cross-tenant *trigger* only). | `server/content/routes.ts` dispatch handler dispatches per-publication; each uses its own owner credentials (see 33.1-A7 #2). | **NON-BLOCKING** (latent) |
| **TEN-08** | Forged `ownerId` on create stored as session owner. | `authGate.test.ts` `ignores forged client identity (headers, body, query)` passes. | **FIXED** |
| **TEN-09** | No reachable helper falls back to owner 1 under the gate. | See SEC-03: `?? 1` gone; `authGate.test.ts` static pin passes. | **FIXED** |

---

## 3. UX register — `UX-01` … `UX-41`

Sources: `docs/full-product-ux-audit.md` §6 (UX-01–UX-36), `docs/phase-29.5-final-ux-audit-report.md` §19
(UX-37–UX-39), `docs/phase-30.3-post-merge-ux-audit-report.md` §22. Originals are `docs/ux-audit/UX_ROADMAP.md`
`R01–R22`. Verification: owning spec/component in the current tree (E2E not re-run this pass — see §0).

| ID | Claim (abbrev.) | Verification in tree | Class |
|---|---|---|---|
| UX-01 (R01) | Quick Capture mispositioned | `client/src/components/quick-capture.tsx`; `e2e/quick-capture.e2e.spec.ts` | **FIXED** |
| UX-02 (R02) | Destructive actions lack confirmation | `client/src/components/ui-shared/confirm-dialog.tsx`; `e2e/destructive-actions.e2e.spec.ts` | **FIXED** |
| UX-03 (R03) | Failed reads mimic empty | `client/src/components/ui-shared/error-state.tsx`; `e2e/error-states.e2e.spec.ts` | **FIXED** |
| UX-04 (R08) | Raw status+JSON in toasts | `client/src/lib/error-messages.ts` | **FIXED** |
| UX-05 (R04) | Hardcoded AI-Provider "Connected" | `AiProviderStatusCard` + `/api/agent/runtime` | **FIXED** |
| UX-06 (R05) | Schedule hardcoded +60s | `client/src/components/ui-shared/schedule-picker.tsx` | **FIXED** |
| UX-07 (R05) | Approve/Publish Now unconfirmed | `client/src/components/ui-shared/publish-preview.tsx` | **FIXED** |
| UX-08 (R12) | Waiting run has no resume control | `panel-auth-callout` / `POST /runs/:id/resume` | **FIXED** |
| UX-09 (R06) | CopilotKit 403 on load | provider unmounted | **FIXED** |
| UX-10 (R12) | Run status contradicts tool failures | `deriveRunDisplayStatus` | **FIXED** |
| UX-11 (R12) | Nested scroll traps on mobile | diagnostics moved to Sheet | **FIXED** |
| UX-12 (R09) | 21-item sidebar clipped | 7 canonical destinations | **FIXED** |
| UX-13 (R10) | Two parallel content models | Schedule Publications tab bridges only | **PARTIALLY FIXED** (accepted) |
| UX-14 (R09) | Five overlapping ingestion entry points | unified under `/sources` | **FIXED** |
| UX-15 (R09) | Ideas Bank/Discovery overlap | unified in `Saved`/`Discover` | **FIXED** |
| UX-16 (R09) | Nav labels ≠ page titles | `PageHeader` 1:1 | **FIXED** |
| UX-17 | Leaked internal jargon | `Research #1`, `External Source (Unverified)` | **FIXED** |
| UX-18 | Replicated compliance banners | consolidated shell banners | **FIXED** |
| UX-19 (R11) | Daily loop detours via Queue | Create studio flow | **FIXED** |
| UX-20 (R11) | Dead-end "coming soon" copy | `checkPublishCompatibility` | **FIXED** |
| UX-21 (R11) | Fake 0 engagement metrics | `—` + observed denominator | **FIXED** |
| UX-22 (R13) | Stale queue (`staleTime: Infinity`) | cache invalidation on mutation | **FIXED** |
| UX-23 (R07) | Missing titles / zoom disabled | per-route title; scalable viewport | **FIXED** |
| UX-24 (R07) | Icon-only controls unnamed | `aria-label` present | **FIXED** |
| UX-25 (R07) | No `nav` landmark / skip link | `nav aria-label="Primary"`, `#main-content` | **FIXED** |
| UX-26 (R07) | Agent composer unlabelled | `<Label htmlFor="agent-composer">` | **FIXED** |
| UX-27 (R14) | Undersized controls | primary ≥44px; see 33.3-F residual | **PARTIALLY FIXED** |
| UX-28 | 404 dark contrast | styled 404 | **FIXED** |
| UX-29 (R08) | Auth validation opacity | inline hint + human errors | **FIXED** |
| UX-30 (R19) | Mobile layout defects | responsive pass; see 33.3 hidden-strip finding | **PARTIALLY FIXED** |
| UX-31 | ~25 font families | Open Sans only | **FIXED** |
| UX-32 (R15) | No command palette | deferred (no command palette mounted) | **DEFERRED** |
| UX-33 | Theme toggle unlabeled | dynamic `aria-label` | **FIXED** |
| UX-34 | Hardcoded profile copy | documented single-operator | **NON-BLOCKING** (documented) |
| UX-35 | Uneven page headers | `PageHeader` unified | **FIXED** |
| UX-36 | Chart label overlap | responsive viewBox | **FIXED** |
| UX-37 | Raw `targetScope` encoding | `client/src/lib/insights-state.ts:168 humanizeScope` | **FIXED** |
| UX-38 | Raw `not_available` guardrail | label map | **FIXED** |
| UX-39 | Human vs autonomous activation identical | `client/src/components/ui-shared/actor-badge.tsx` | **FIXED** |
| UX-40 | No budget-remaining indicator | not surfaced | **DEFERRED** |
| UX-41 | Policy allowlist not shown | not surfaced | **DEFERRED** |

Roadmap-original IDs `R01–R22` map onto `UX-01…UX-36` (no separate status); `R16–R22` (`UX_ROADMAP.md` §P2/§P3) were
never built and are recorded there as HYPOTHESIS/deferred — **DEFERRED**.

---

## 4. Phase 29.x findings

| ID | Source | Original claim | Verification in tree | Class |
|---|---|---|---|---|
| 29.1-L1 | `phase-29.1-verification.md` §3.1 | Naive sample summation fabricated engagement | `server/content/learning/proposals.dbtest.ts` contains `deduplicates multiple historical snapshots` | **FIXED** |
| 29.1-L2 | §3.2 | Unmeasured posts diluted sample size | `server/content/learning/proposals.test.ts` N=0..21 | **FIXED** |
| 29.1-L3 | §3.3 | Candidate compared against itself | `proposals.ts` / `proposals.test.ts` | **FIXED** |
| 29.1-L4 | §3.4 | Extraction missed failed deliveries | `proposals.dbtest.ts` "accurately detects delivery failures" | **FIXED** |
| 29.1-L5 | §3.5 | Duplicate artifact IDs in evidence | `proposals.ts` Set-dedup | **FIXED** |
| 29.4-DEF1 | `phase-29.4-deep-audit-report.md` §16 | Budget/cooldown/oscillation checks lock-free → concurrent budget bypass | `server/content/autonomy/controller.ts:163` `select id from autonomy_configs where user_id = … for update`; **executed:** `autonomy.dbtest.ts:399` "budget race … never both succeed past a budget of 1" **passes** | **FIXED** |
| 29.2-DEF1 | `phase-29.2-final-verification.md` §"taxonomy" | Statistical significance / CI testing | not implemented (sample-count ladder) | **DEFERRED** |
| 29.2-DEF2 | same | Multi-armed bandit / adaptive traffic | absent | **DEFERRED** |
| 29.2-DEF3 | same | Autonomous policy mutation in production | absent by design | **DEFERRED** |
| 29.3-LIM1 | `phase-29.3-final-verification.md` §"Remaining limitations" | `/api/policies/active|history` scope by `policyKey`, not per-owner | unchanged | **NON-BLOCKING** |
| 29.3-LIM2 | same | UI "activated" toggle from local state only | unchanged | **NON-BLOCKING** |
| 29.3-LIM3 | same | No inferential statistics gate | unchanged | **NON-BLOCKING** |

---

## 5. Phase 30.x findings

| ID | Source | Original claim | Verification in tree | Class |
|---|---|---|---|---|
| F1 | `phase-30-production-readiness-report.md` §28 | Fail-open default `SESSION_SECRET` | `server/index.ts:144 secret: resolveSessionSecret(process.env)` (throws in prod) | **FIXED** |
| F2 / F6 | §28 | No health/readiness; healthcheck probed static config | `server/index.ts:209 /api/health`, `:210 /api/ready` exist | **FIXED** |
| F3 | §28 | Secret-shaped fields in access log | `server/httpHardening.ts` `redactForAccessLog` | **FIXED** |
| F4 | §28 | Logout left cookie set | logout clears `connect.sid` | **FIXED** |
| F5 | §28 | Raw-`fetch` SSRF in legacy ingestion | `server/security/ssrf.ts` + `legacyFetchDenial.test.ts` | **FIXED** |
| B1 | §32 (launch blocker) | No auth/ownership on legacy API | gate + owner predicates landed (30.1/30.2); re-verified by SEC-01/OWN-01 | **FIXED** |
| G1 | §28 | No session regeneration; 30d fixed expiry | unchanged; single-operator | **NON-BLOCKING** (documented) |
| G2 | §28 | Google OAuth email-link without verified check | `server/auth.ts` | **NON-BLOCKING** (documented) |
| G3 | §28 | `aiCall` has no client timeout | bounded by job expiry | **NON-BLOCKING** (documented) |
| G4 | §28 | `/uploads` served without auth | static `/uploads` | **NON-BLOCKING** (documented, M1 class) |
| G5 | §28 | compose weak placeholder `SESSION_SECRET` | `docker-compose.yml` local-dev only | **NON-BLOCKING** (documented) |
| R1 | §7 / `phase-30.1` §6 | Legacy pool shared among authenticated users | **superseded:** legacy domains are owner-scoped at this tree (`final-audit-security.md` §11) | **FIXED** |
| R1a | `phase-30.2` §5/§13 | NULL-attributed legacy rows visible to any authenticated user | documented bridge (TEN-05) | **NON-BLOCKING** (documented) |
| R1b | `phase-30.2` §5 | voices/templates/policies shared config | documented | **NON-BLOCKING** (documented) |
| M1 | `phase-30.2` §13 | Single-tenant posture | retained for NULL pool + shared config | **NON-BLOCKING** |
| M2 | §13 | Polling-based alerting | no push alert | **NON-BLOCKING** |
| M3 | §13 | Platform RPO/RTO | operator-owned | **NON-BLOCKING** |
| D1 | §13 | E2E-gated deploys | process-enforced | **NON-BLOCKING** |
| Q1 | §13 | Journey E parallel interference (test defect) | quarantined; see T8 | **NON-BLOCKING** (test defect) |
| 30.2 Findings 1–6 | `phase-30.2` §14 | R1 partial; CI-red regression fixed; stale premises; Journey E; PR#3 direction; no new defects | informational; §14.5 PR#3 is a human decision | **NON-BLOCKING** |
| 30.3 new findings | `phase-30.3` §19 | Zero new findings | asserted zero | **NON-BLOCKING** |

---

## 6. Phase 31.x findings

| ID | Source | Original claim | Verification in tree | Class |
|---|---|---|---|---|
| A1 | `phase-31.1-scheduler-deep-audit-report.md` §18 | Reconcile test starved a later test (harness) | non-production; test file note | **NON-BLOCKING** (test-harness) |
| A2 | §18 | Multi-owner test marginal timeout | timeout extended; non-production | **NON-BLOCKING** (test-harness) |
| DLQ-1 | `phase-31.4-release-candidate-report.md` §"Tests"; `phase-31.3` §8 | DLQ drill: 3 retries then DLQ-retained | `server/scheduler.ts:10 RETRY_DELAYS_MINUTES = [5,30,120]` (3 retries); soak §8 confirms retention | **NON-BLOCKING** (verified drill) |
| 31.1-LIM1 | `phase-31.1` §20 | Hourly idempotency granularity | `server/content/autonomy/scheduler.ts`; sweep re-covers | **NON-BLOCKING** |
| 31.1-LIM2 | §20 | Rollback not scheduler-driven | by design | **NON-BLOCKING** |
| 31.1-LIM3 | §20 | pg-boss vendor-default retention | no archive config | **NON-BLOCKING** |
| 31.3 soak failures | `phase-31.3-operational-soak-report.md` §12 | Kill-flip / restart / dup-delivery / transient×4 / argv bug | all recovered, none product impact | **NON-BLOCKING** |

---

## 7. Phase 32

| ID | Source | Original claim | Verification | Class |
|---|---|---|---|---|
| — | `phase-31.4` §"Release Candidate State" ("Ready for the final independent audit (Phase 32)") | Phase 32 is the *independent final audit* | **No `docs/phase-32*` document exists** (`find docs -iname '*32*'` → ∅; `grep -rn 'phase[ -]32' docs` → the single 31.4 mention). The audit that actually ran is `docs/final-contentforge-v1-audit.md` + the three `final-audit-*.md` files. | **NOT APPLICABLE** (no phase-32 document) |

---

## 8. Phase 33.x findings

| ID | Source | Original claim | Verification in tree | Class |
|---|---|---|---|---|
| OWN-01 | `phase-33.1-critical-trust-fix-report.md` §2 | Legacy storage ignored owner; cross-tenant credential paths | `getPostUnscoped` removed; owner predicates; `requireOwnerId` (104 refs); ownerIsolation 5/5 + `legacyOwnerIsolation.dbtest.ts` present | **FIXED** |
| OWN-02 | §2 | Unconditional `seedDatabase()` on fresh DB | `SEED_DEMO_DATA` gate; seed log lines | **FIXED** |
| QA-01 | §2 | Missing provider config reported `providerCalled:true` | `server/content/adapters.test.ts` (5/5 in docs), `publicationConfigFailure.test.ts`; owner-scoped credential lookup | **FIXED** |
| QA-03 | §2 | Both Publish-Now surfaces treated 207 as success | `client/src/lib/publication-feedback.ts` reads `outcomes[].status` | **FIXED** |
| 33.1-A2 | §Addendum A2 | Over-broad owner gate dropped env credentials (28 tests broken) | corrected in `social/{linkedin,x,threads,instagram,youtube}.ts`; A4 real-header guard | **FIXED** |
| 33.1-A7#1 | §Addendum A7 | NULL-owner publication rows reach unscoped `getConnectedAccount(platform)` (latent) | `publications.userId` still nullable; no HTTP entrypoint creates NULL owner | **NON-BLOCKING** (latent) |
| 33.1-A7#2 | §Addendum A7 | `/api/publications/dispatch` not owner-scoped (cross-tenant trigger) | dispatch handler ignores caller; per-publication credentials | **NON-BLOCKING** (latent) |
| 33.1-A7#3 | §Addendum A7 | `getUserId(req) ?? 1` in ~25 handlers | removed (SEC-03) | **FIXED** |
| 33.2#1 | `phase-33.2-report.md` | Reject visible on both surfaces | `client/src/components/create/artifact-review-view.tsx`, `agent/artifact-review.tsx` | **FIXED** (verified 33.2) |
| 33.2#2 | §"Verdict table" | Today double-lists unknown-outcome publication as failure + unknown (MEDIUM) | **fixed on this tree:** `client/src/pages/today.tsx:98-105` now partitions by publication id ("renders exactly once as unknown"). commit `fcb743c`. | **FIXED** |
| 33.2#3 | §"Verdict table" | Exactly one top-level `<main>` | `client/src/App.tsx` single `main#main-content` | **FIXED** (verified 33.2) |
| 33.2#4 | §"Verdict table" | Channel icon named/decorative | `client/src/components/ui-shared/channel-icon.tsx` | **FIXED** |
| 33.2#5 | §"Verdict table" | Legacy→canonical consolidation (18 paths, not 20) | `client/src/lib/legacy-route-mapping.ts` (unit test deep-equals 18) | **FIXED** (doc miscount corrected) |
| 33.2#6 | §"Verdict table" | Homeless legacy capabilities integrated | `client/src/pages/create.tsx:33-54` mounts 8 modes | **FIXED** |
| 33.2#7 | §"Verdict table" | `/sources` discoverability for ideas/vault/references | `client/src/pages/sources.tsx` | **FIXED** |
| 33.2#8 | §"Verdict table" | Cross-cutting APIs reused; caveat = no dedupe | fixed by 33.2#2 | **FIXED** |
| 33.3-A | `phase-33.3-report.md` §2 | `/schedule` Radix Tabs with no `<TabsContent>` → dangling `aria-controls` (axe critical) | **fixed on this tree:** `client/src/pages/schedule.tsx:5` imports `TabsContent`, `:47` comment "Each view is a real `TabsContent`". commit `9d1073c`. | **FIXED** |
| 33.3-B | §2 | `/create` heading `h1→h3` skip | **fixed:** `client/src/components/create/create-studio.tsx:432 <h2>Content Setup</h2>`, `:636 <h3>`. commit `fcb743c`. | **FIXED** |
| 33.3-C | §2 | `/schedule` queue `h1→h5` (AlertTitle h5) | **fixed:** `client/src/pages/queue.tsx:488` renders a real `<h2>Publish on your terms</h2>`. commit `9d1073c`. | **FIXED** |
| 33.3-D | §2 | "Dead routes" framing incomplete — 19/49 literals, 17/45 sub-12px ship in live chunks | reproduced: palette `grep` → **49**, sub-12px → **45** (same counts). Cosmetic, no canonical-route contrast failure. | **NON-BLOCKING** (open, corrected) |
| 33.3-E | §2 | "`--primary` as text 3.68:1 light" half wrong; light actually 5.40:1 | correction accepted; only the dark `--primary-text` token remains deferred (P2-1/DEF-02) | **NON-BLOCKING** (doc correction) |
| 33.3-F | §2 | Controls under 24×24 (chips, help links) | not re-measured this pass; source-verified classes present | **NON-BLOCKING** (open, LOW) |
| 33.3-G | §2 | `/create` chunk 647 KB > 500 KB warning | not rebuilt this pass; sizing is source/build-time | **NON-BLOCKING** (open, LOW) |
| 33.5-B1 | `phase-33.5-outcome.md` §2 | `discovery_settings` cross-owner leak CONFIRMED | same as SEC-02 (open) | **BLOCKER** |
| 33.5-B2 | §3 | Three HIGH a11y defects (dialog focus, 12 settings labels, Calendar contrast) — work done but uncommitted/unverified | verified **still open** on this tree: `client/src/components/ui/dialog.tsx` `DialogContent` has no `onCloseAutoFocus`/`DialogTrigger`; `client/src/pages/settings.tsx:565-614,679,688` labels have no `htmlFor`/`id`; `client/src/pages/calendar.tsx:284` still `opacity-40`. | **BLOCKER** |
| 33.5-B3 | §4 | Incomplete verification (audit-completeness, test-integrity) | process finding | **NON-BLOCKING** |
| Settings credential display | `design-security-gate.md`; `final-design-landing-report.md` §2.1; groups M4/P4-1 | "plaintext token in DOM" vs "Tokens are never shown here" | `client/src/lib/secret-display.ts` `maskSecret`; `settings.tsx` renders mask; `client/src/lib/secret-display.test.ts` | **FIXED** |
| `.env.orig-backup` leak | `final-design-landing-report.md` §2.2 | Credential backup committed; purged | `.gitignore:13-19` now `.env`, `.env.*`, `!.env.example`; **executed:** `git ls-files | grep -iE '(^|/)\.env'` → only `.env.example`; `git log --all -- .env.orig-backup` → ∅. commit `4320f47`. | **FIXED** |
| Deploy topology | `deploy-topology-finding.md` §2 | `deploy.yml` triggers `replit`, not `main`; `origin/replit` divergent lineage | **executed:** `.github/workflows/deploy.yml` `branches: [replit]`; `prod-migrate.yml` `branches: [main, master, replit]`. Owner decision pending (33.5 §5 "deploy trigger unchanged"). | **DEFERRED** (owner decision) |
| Final-audit UX MEDIUMs | `final-audit-ux-a11y.md` §4 | `/create` disabled primary w/o reason; hidden scroll strips; `/sources` heading tie + header-action mismatch; `/agent` Capabilities deleted `<lg`; `/insights` one heading | source-verified present (`create-studio.tsx` disabled primary; `no-scrollbar` strips; `agent.tsx` `hidden lg:flex` sidebar; `/insights` single h1) | **NON-BLOCKING** (open, MEDIUM) |
| `analytics.tsx:101` | `final-audit-ux-a11y.md` §4; `final-contentforge-v1-audit.md` §8 | latent raw `text-green-500` + sub-floor class, no runtime repro on empty DB | `client/src/pages/analytics.tsx:101` still `text-[10px] text-green-500` | **NON-BLOCKING** (open, latent) |

---

## 9. Design-programme findings (`docs/design-*.md`, `docs/design-orchestration/*`)

Raw volume: 9 discovery audits produced **78 findings** (`design-coordinator-synthesis.md` §2), merged into
**21 root causes** (groups A–L + register). The merged groups are the canonical rows; the per-audit "Finding #n"
numbering (`docs/design-orchestration/*`) is represented by its group.

**Register O1–O8** (`design-orchestration-baseline.md` §8b):

| ID | Claim | Verification in tree | Class |
|---|---|---|---|
| O1 | `sources/source-card.tsx` focus stripped | group B fix (ring restored) | **FIXED** |
| O2 | `navigation-menu.tsx` focus | 0 importers (dead) | **DEFERRED** (dead code) |
| O3 | status hue/pulse only | spinner/clock glyphs added (group I) | **FIXED** |
| O4 | `CardTitle` default `text-2xl` unused-34-of-41 | **refuted** — 41/41 override | **NOT APPLICABLE** (refuted) |
| O5 | 250 palette literals | **executed:** grep → **49** | **PARTIALLY FIXED** (deferred residual, P3-2) |
| O6 | `learning-view.tsx` nested cards | flattened (group E) | **FIXED** |
| O7 | icon-topper circle cloned | **refuted** — 0 clones | **NOT APPLICABLE** (refuted) |
| O8 | 17 exclamation successes | **executed:** grep → **0** | **FIXED** |

**Coordinator groups** (`design-coordinator-synthesis.md` §3):

| ID | Group | Decision | Class |
|---|---|---|---|
| A1 | Semantic status tokens / 250 literals / identical `--destructive` | ACCEPT | **FIXED** (`--success/--warning/--info` ×2 themes = **12** tokens; `grep -cE -- '--(success\|warning\|info)(-foreground)?:' client/src/index.css`) |
| B1 | Focus visibility on primary paths | ACCEPT | **FIXED** |
| C1 | Motion `overlay-motion`/sheet exit/`.pressable` | ACCEPT | **FIXED** |
| D1 | Failed reads rendered clean (5+ regions) | ACCEPT | **FIXED** |
| E1 | `learning-view.tsx` composition | ACCEPT | **FIXED** |
| F1 | Agent workspace Dismiss lies; raw enums; Approve buried | ACCEPT (d deferred) | **FIXED** (d DEFERRED) |
| G1 | Overlay composition on small viewports | ACCEPT | **FIXED** |
| H1 | Route-level code splitting | MERGE | **FIXED** (**executed:** `grep -c 'lazy(' client/src/App.tsx` → **8**) |
| I1 | Status leans on hue+pulse | ACCEPT (MEDIUM) | **FIXED** |
| J1 | Tab strips in primary-action slot | ACCEPT; `/sources` band DEFERRED | **PARTIALLY FIXED** |
| K1 | Create→Schedule handoff | (b) ACCEPT; (a) DEFER | **PARTIALLY FIXED** (P2-2 deferred) |
| L1 | Hardcoded light-ramp hues | MERGE into A | **FIXED** |
| M1 | `CardTitle` default | REJECT (refuted) | **NOT APPLICABLE** |
| M2 | `navigation-menu` focus | DEFER (dead) | **DEFERRED** |
| M3 | empty-state circle clones | REJECT (refuted) | **NOT APPLICABLE** |
| M4 | settings token plaintext vs "never shown" | ESCALATE → fixed | **FIXED** |
| M5 | `/today` asks "create?" twice | DEFER | **DEFERRED** |
| M6 | "YouTube (deferred)" UI copy | ACCEPT | **FIXED** |
| M7 | 7 pollers at 1.2–1.5s | DEFER | **DEFERRED** |
| M8 | 250-literal sweep | PARTIAL | **PARTIALLY FIXED** |

**Integration-gap register P0–P4** (`design-integration-gap-report.md` §3):

| ID | Claim | Class |
|---|---|---|
| P0 | none | **NOT APPLICABLE** (no defect) |
| P1 | none outstanding on canonical route | **NOT APPLICABLE** (no defect) |
| P2-1 | `--primary` unsafe as text; `--primary-text` deferred | **DEFERRED** |
| P2-2 | `/schedule` never surfaces occurrences | **DEFERRED** (product task) |
| P2-3 | `/sources` third band not collapsed | **DEFERRED** |
| P2-4 | 4 pre-existing spec failures | **DEFERRED** (see §10) |
| P2-5 | polling cadence 1.2–1.5s | **DEFERRED** |
| P2-6 | auth-gate waterfall | **DEFERRED** |
| P3-1 | 45 `text-[Npx]` (observed now **46**) | **DEFERRED** (floored to 12px) |
| P3-2 | 49 palette literals | **DEFERRED** |
| P3-3 | 11 `transition-all` (**executed:** grep → 11) | **DEFERRED** |
| P3-4 | `--accent` vs `--popover` ~1.01:1 | **NON-BLOCKING** (workaround accepted) |
| P3-5 | dead code (`vault.tsx`, `navigation-menu.tsx`) | **DEFERRED** |
| P3-6 | render-blocking font stylesheet | **DEFERRED** |
| P4-1 | settings token contradiction | **FIXED** |

**Deferrals DEF-01…DEF-09** (`phase-34-preaudit-matrix.md` §9): all **DEFERRED** — scheduled-post surfacing,
`--primary-text` token, `/sources` band, sub-12px classes, `transition-all`, dead code, poll cadence, auth-gate
waterfall, font self-hosting. None may be re-opened as defects; the deferral status holds on this tree.

Don't-Build review (`final-contentforge-v1-audit.md` §20; `ux-audit/DONT_BUILD.md` D1–D7): **PASS** —
no second queue/workflow engine/design system; auto-DM/auto-reply, multi-tenant, billing, 30+ networks, Canva-like
editor, link-in-bio, standalone generator not built → **NOT APPLICABLE** (correctly not built).

---

## 10. Test integrity & non-passing tests

| ID | Source | Claim | Verification | Class |
|---|---|---|---|---|
| T1 | `final-parallel-baseline.md` §2; `final-design-landing-report.md` §4.1 | 3 `threads.test.ts` failures | `server/content/threads.test.ts` exists; failure set state-dependent | **NON-BLOCKING** (environment) |
| T2 | `final-design-landing-report.md` §4.2 | `legacyOwnerIsolation.dbtest.ts` throws without `OPENAI_API_KEY` | needs placeholder key | **NON-BLOCKING** (environment) |
| T3 | `design-integration-gap-report.md` P2-4 | `destructive-actions.e2e.spec.ts:9` navigates to `/ideas` | **executed:** `sed -n '9p' e2e/destructive-actions.e2e.spec.ts` = "deleting an idea requires confirmation…" | **DEFERRED** (stale spec) |
| T4 | P2-4 | `error-states.e2e.spec.ts:20` obsolete premise | line 20 = `${surface.name}: forced 500 shows ErrorState…` | **DEFERRED** (stale spec) |
| T5 | P2-4 | `agent-publish.e2e.spec.ts:3` needs live pipeline | line 3 present | **DEFERRED** (environment) |
| T6 | P2-4 | `api.e2e.spec.ts:200` needs real AI creds | line 200 = `POST /api/youtube/generate-post…` | **DEFERRED** (environment) |
| T7 | `final-contentforge-v1-audit.md` §16 | ~14 parallel-only failures (rate-limiter cascade) | parallel not re-run | **NON-BLOCKING** (harness) |
| T8 | §16/§18 | Journey E zero-mutation assertion (test defect) | `e2e/learning-proposals.e2e.spec.ts` | **NON-BLOCKING** (test defect, Q1) |
| T9 | §16 | `visualPublication.dbtest.ts` lease race | dbtest present | **NON-BLOCKING** (flake) |
| T10 | `phase-33.1` §A6 | 6 pre-existing DB failures | **executed (fresh DB):** `autonomy.dbtest.ts` 17/20 — 3 fail: `policy churn …`, `rollback: … re-activates the prior revision`, `repeated autonomous rollbacks … circuit breaker`. The other 3 named in §A6 (artifact immutability, NULL bridge, revise-as-new-row) **passed** this run → the set is state-sensitive. | **NON-BLOCKING** (pre-existing, state-sensitive) |
| **Test-isolation defect** | `final-audit-blocker-auth-gate.md` §6; `final-contentforge-v1-audit.md` §16/§18.5; `phase-33.5-outcome.md` §5 | Shared test DB poisons itself (`Failed to decrypt stored accessToken`); suite is not isolated from DB state | **executed, decisive:** same tree, same command `npm run test:db` → **fresh migrated DB: 344/352 pass, 8 fail**; **reused E2E DB (`contentforge_e2e`): 328/352 pass, 24 fail**. The delta (16 extra failures) is state, not code. | **NON-BLOCKING** (open, MEDIUM — in the 33.5 minimum-to-GO list) |

**Observed suite totals on this tree (executed):** `authGate.test.ts` 10/10 · `ownerIsolation.dbtest.ts` 5/5 ·
`autonomy.dbtest.ts` 17/20 · `test:db` 344/352 (fresh) vs 328/352 (reused). E2E not re-run.

---

## 11. Media/video defects (`docs/STATUS.md` §"Defects D1–D5", Phase 27.x)

| ID | Claim | Class |
|---|---|---|
| D1 | HyperFrames Cloud / HeyGen v3 invented | **DEFERRED** (`processing_ready:false`) |
| D2 | OpenShorts "MCP-as-HTTP" invented | **FIXED** (real REST) |
| D3 | OpenShorts health treated `/health` 200 as ready | **FIXED** |
| D4 | Video-Factory jobs missing `index.html` | **FIXED** |
| D5 | capabilities matrix claimed implemented when ROOT set | **FIXED** |

Recorded for completeness (out of the 29.x–33.x scope but present in-repo).

---

## 12. Identifiers requested but NOT LOCATED

Per the brief's rule, these are recorded as **NOT APPLICABLE — no such identifier** rather than mapped to an
invented finding. Each was confirmed absent by the sweep
`grep -rnoE '\b(QA-02|A11Y-[0-9]+|DES-[0-9]+|DLQ-[0-9]+|PERF-[0-9]+|ENG-[0-9]+|UX-F[0-9]+)\b' docs/`.

| Requested ID | Finding | Class |
|---|---|---|
| `QA-02` | Appears **only** inside `phase-34-preaudit-matrix.md` §1.4 as the record that it does not exist. The QA register has `QA-01`, `QA-03` only (`phase-33.1` §2). The source (`~/Downloads/final-qa-bug-report.md`) is outside the repo. | **NOT APPLICABLE — no such identifier** |
| `A11Y-01` (and all `A11Y-*`) | No literal `A11Y-nn` anywhere. The accessibility programme uses `docs/design-orchestration/accessibility-audit.md` "Finding #1…#11" + register `O1/O2/O3` + group `A1`. | **NOT APPLICABLE — no such identifier** |
| `DES-*` | No literal `DES-nn`. Design-system material is `docs/design-orchestration/design-system-audit.md` Finding #1…#9 + group `A1`. | **NOT APPLICABLE — no such identifier** |
| `DLQ-01` | No literal `DLQ-01`. The real identifier is `DLQ-1` (`phase-31.4` §Tests; `phase-31.3` §8) — registered in §6. | **NOT APPLICABLE — no such identifier** |
| `PERF-01` | No literal `PERF-01`. Performance material is `frontend-performance-audit.md` Finding #1 + `P2-5/P2-6` (DEFERRED) + 33.3-G. | **NOT APPLICABLE — no such identifier** |
| `ENG-01` | No literal `ENG-01`. No engine-labelled finding exists. | **NOT APPLICABLE — no such identifier** |
| `UX-F03` | No literal `UX-F03`. The UX register is `UX-01…UX-41`. | **NOT APPLICABLE — no such identifier** |

---

## 13. Summary

**Findings registered: 199** — the sum of the rows in §1–§11 (192) plus the 7 not-located entries in §12.

Count per classification (by row):

| Classification | Rows | §1 | §2 | §3 | §4 | §5 | §6 | §7 | §8 | §9 | §10 | §11 | §12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **FIXED** | **95** | 2 | 6 | 34 | 6 | 7 | – | – | 19 | 17 | – | 4 | – |
| **NON-BLOCKING** | **50** | 5 | 3 | 1 | 3 | 14 | 7 | – | 9 | 1 | 7 | – | – |
| **DEFERRED** | **29** | – | – | 4 | 3 | – | – | – | 1 | 16 | 4 | 1 | – |
| **PARTIALLY FIXED** | **7** | – | – | 3 | – | – | – | – | – | 4 | – | – | – |
| **NOT APPLICABLE** | **15** | – | – | – | – | – | – | 1 | – | 7 | – | – | 7 |
| **BLOCKER** | **3** | 1 | – | – | – | – | – | – | 2 | – | – | – | – |
| **TOTAL** | **199** | 8 | 9 | 42 | 12 | 21 | 7 | 1 | 31 | 45 | 11 | 5 | 7 |

> The 3 `BLOCKER` rows encode **4 distinct open defects** (the sources cite the tenant defect under two IDs, and
> group the three accessibility defects under one): **SEC-02 / 33.5-B1** `discovery_settings` owner isolation, and
> **33.5-B2** (dialog focus restoration · 12 unlabelled `/settings` controls · Calendar-view contrast). Net distinct
> open blockers: **1 security/tenant + 3 accessibility = 4**.

### BLOCKERS (open on `d4a3760`)

1. **SEC-02 / 33.5-B1 — `discovery_settings` has no owner column.** Live DB confirms 7 columns, no `user_id`; no
   migration adds it. Any authenticated user reads/overwrites every other user's `customKeywords`. This is the sole
   open tenant-isolation blocker (`final-contentforge-v1-audit.md` §21 ground 2).
2. **33.5-B2a — dialog focus not restored to the invoker** (3 dialogs). `ui/dialog.tsx` `DialogContent` has no
   `onCloseAutoFocus`; the dialogs have no `DialogTrigger`. HIGH.
3. **33.5-B2b — 12 form controls on `/settings` have no programmatically associated label** (Brand Profile ×10,
   Connect dialog ×2). `settings.tsx:565-614,679,688` labels carry no `htmlFor`; controls carry no `id`. HIGH.
4. **33.5-B2c — Calendar-view colour contrast.** `client/src/pages/calendar.tsx:284` `opacity-40` on the out-of-month
   cell wrapper collapses the day numeral below AA (audited 1.87:1 light / 2.21:1 dark). HIGH.

> The 33.5 outcome's `FINAL NO-GO` therefore **stands** on this tree: the tenant blocker is confirmed open and the
> three HIGH accessibility defects are confirmed open. The audit-completeness condition (33.5-B3) is a process
> finding, not a code defect.

### Identifiers that could not be located

`QA-02` · `A11Y-01` (all `A11Y-*`) · `DES-*` · `DLQ-01` · `PERF-01` · `ENG-01` · `UX-F03` — all
**NOT APPLICABLE — no such identifier** (§12). Phase **32** has no document anywhere in the tree (§7).

---

## 14. Commands executed in this pass (evidence)

```
git rev-parse HEAD                                                        # d4a3760…
git log --oneline -1                                                      # docs(33.5) … FINAL NO-GO
npx tsx --test server/middleware/authGate.test.ts                          # 10/10 pass
TEST_DATABASE_URL=… npx tsx --test server/content/ownerIsolation.dbtest.ts # 5/5 pass
TEST_DATABASE_URL=… npx tsx --test server/content/autonomy/autonomy.dbtest.ts # 17/20 (3 pre-existing)
npm run test:db   (fresh migrated DB)                                      # 344/352
npm run test:db   (reused contentforge_e2e)                                # 328/352
psql/information_schema: discovery_settings columns                        # no user_id
grep -rn "getUserId(req) ?? 1" server                                      # 0 live (2 comments)
grep -rn "requireOwnerId" server                                           # 104
grep -rn "toLowerCase" server/middleware/authGate.ts server/middleware/rateLimit.ts
sed -n '284p' client/src/pages/calendar.tsx                                # opacity-40
grep -n "htmlFor" client/src/pages/settings.tsx                            # none on Brand Profile
grep -n "onCloseAutoFocus|DialogTrigger" client/src/components/ui/dialog.tsx
grep -n "dangerouslySetInnerHTML" client/src/pages/ingest.tsx              # :587
grep -c "lazy(" client/src/App.tsx                                         # 8
grep -rn "refetchInterval" client/src                                      # 7
grep -roE 'text-\[[0-9]+px\]' client/src | wc -l                           # 46
grep -roE '(bg|text|border)-…-[0-9]{2,3}' client/src | wc -l               # 49
grep -rnoE 'title: *"[^"]*!"' client/src | wc -l                           # 0
git ls-files | grep -iE '(^|/)\.env'                                       # .env.example only
git log --all --oneline -- .env.orig-backup                                # (empty)
grep -rniE "drop table|drop column|truncate|delete from" migrations/*.sql  # 0
sed -n '1,25p' .github/workflows/deploy.yml                                # branches: [replit]
```
