# Phase 34 — Pre-Audit Matrix ("34-PRE-AUDIT")

> **NOT FINAL AUDIT — preparation only. This document contains no verdict.**

**Author:** worker `34-PRE-AUDIT` (branch `phase-34-preaudit`)
**Target of the eventual audit:** pushed `main` of `unplugged-kk/ContentForge`
**Method of this document:** every prior conclusion is converted into a re-runnable check. Nothing here is a
finding, a severity, a GO/NO-GO, or a fix. Where a prior report says "FIXED", this document records the command
that must reproduce the fix; where it says "DEFERRED", it records the command that must reproduce the
non-defect. The final auditor must **derive** every result, never carry one over.

This document deliberately contains **no verdict**. If any cell reads as an assertion ("expected: 401"), that is
the *prediction to try to break*, not a conclusion.

---

## 0. Provenance and scope of this preparation

### 0.1 Repository and worktree facts observed while preparing this matrix

| Fact | Value (observed) |
|---|---|
| Worktree | `/Users/kishore/git/cf-design/34pre` (branch `phase-34-preaudit`) |
| HEAD of this worktree's base | `bcf14704bc5beef0e455a971c35f122876718ca5` (`bcf1470`) |
| `main` HEAD while preparing | `bcf14704bc…` |
| `origin/main` recorded by the parallel baseline | `d9db1a7` — **untouched; the finalization had not pushed** (`docs/final-parallel-baseline.md` §1) |
| Canonical routes | `/today /create /sources /agent /schedule /insights /settings` (+ `/youtube`, 20 legacy redirects) |
| Queue | pg-boss only |
| Auth model | Global `authGate` on `/api`; public allowlist = `/api/auth/*`, `/api/csrf-token`, `/api/health`, `/api/ready` |

### 0.2 Documents surveyed to build the register

`docs/` root (43 files) — in particular: `final-contentforge-v1-audit.md`, `phase-33.1-critical-trust-fix-report.md`,
`phase-30-production-readiness-report.md`, `phase-30.1-auth-enforcement-report.md`, `phase-30.2-final-production-regate.md`,
`phase-30.3-post-merge-ux-audit-report.md`, `phase-29.4-deep-audit-report.md`, `phase-29.5-final-ux-audit-report.md`,
`phase-31-durable-autonomous-scheduler.md`, `phase-31.1-scheduler-deep-audit-report.md`,
`phase-31.2-post-scheduler-ux-audit.md`, `phase-31.3-operational-soak-report.md`, `phase-31.4-release-candidate-report.md`,
`full-product-ux-audit.md`, `design-orchestration-baseline.md`, `design-coordinator-synthesis.md`,
`design-integration-gap-report.md`, `design-final-acceptance.md`, `multi-agent-design-final-report.md`,
`final-design-landing-report.md`, `design-security-gate.md`.
Subdirectories: `docs/design-orchestration/*` (9 discovery audits + 8 change reports), `docs/ux-audit/*` (10 files).

**Two sources are NOT in this worktree's `docs/` snapshot and were read from `main`:**
- `docs/final-parallel-baseline.md` — the Phase-0 baseline of the *current* finalization wave. **It is untracked
  in `main`'s working tree** (`git status` → `?? docs/final-parallel-baseline.md`; `git ls-files` does not know it).
  It is the freshest statement of the current test baseline and the deferred list, but it is not committed — the
  auditor must not treat it as part of the pushed artifact.
- `docs/phase-30-production-readiness-report.md` etc. are present in both; only `final-parallel-baseline.md` differs.

### 0.3 Standard verification environment (adapt ports/DB as needed)

From `docs/phase-33.1-critical-trust-fix-report.md` §5:

```text
DATABASE_URL=postgresql://<user>@127.0.0.1:<port>/<disposable-db>
SESSION_SECRET=<any>
ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
OPENAI_API_KEY=sk-local-placeholder
CONTENTFORGE_E2E_SERVER=1
AI_BASE_URL=http://127.0.0.1:9/v1
SEED_DEMO_DATA=
DISABLE_CRON=1
# E2E only:
SESSION_COOKIE_SECURE=0
E2E_PORT=<dedicated-port>
```

Rules carried from the prior audits that the final auditor MUST obey:
- Never point `DATABASE_URL` at the Neon/production database; use a disposable local PostgreSQL.
- Never run `test:db` and E2E against the same database (`docs/phase-30.2` §12.1 state sensitivity).
- Prefer `--workers=1` (serial) E2E as the trustworthy signal; parallel E2E has a documented rate-limiter cascade.
- No real paid provider calls (`CONTENTFORGE_REAL_PUBLISH_E2E`/`*_CERTIFICATION` unset).

---

## 1. Historical findings register

**Every row here is "verify", never "trust".** Format per row:
`ID · source · original claim · what to run/inspect today · expected (prediction to break) · how to falsify`.

### 1.1 Security, auth, tenant isolation, and trust findings

**OWN-01 — Legacy owner isolation** · `docs/phase-33.1-critical-trust-fix-report.md` §2 · Claim: legacy storage
read/wrote without owner predicates; cross-tenant credential fallbacks existed; `getPostUnscoped` removed;
server session owner overrides body `ownerId`.
- **Run today:** `NODE_ENV=test node --import tsx --test server/legacyOwnerIsolation.dbtest.ts` **and**
  `NODE_ENV=test node --import tsx --test server/content/ownerIsolation.dbtest.ts`; then the live HTTP A/B battery in §3 below.
- **Expected:** `legacyOwnerIsolation` 2/2 (incl. the real-`Authorization`-header guard from the 33.1 addendum §A4);
  `ownerIsolation` 5/5 over real HTTP (anon 401, B 404, no-branch, no-lockout, NULL bridge).
- **Falsify:** any test red; or a live request where owner A reads/mutates/drives owner B's row; or a forged body
  `ownerId` stored unchanged; or an outbound provider call made with another owner's stored token.

**OWN-02 — Demo data seeding** · same source §2 · Claim: seeding is opt-in via `SEED_DEMO_DATA=1`; default boots empty.
- **Run today:** fresh migrated DB with `SEED_DEMO_DATA=` boot `dist/index.cjs`; assert `posts=0 analytics=0 pillars=0`
  and the log line `demo data seed disabled`; repeat with `SEED_DEMO_DATA=1` expecting the seed counts + `demo data seed enabled`.
- **Expected:** default: 0 rows; explicit: rows present.
- **Falsify:** a fresh default DB contains demo rows, or the log assertion is absent.

**QA-01 — Provider config classification** · same source §2 · Claim: missing local X/Threads/LinkedIn config ⇒
`providerCalled:false`, `errorClass:policy_human`, durable `failed` Result, zero unknown reconciliation rows.
- **Run today:** `NODE_ENV=test node --import tsx --test server/content/adapters.test.ts` and
  `NODE_ENV=test node --import tsx --test server/content/publicationConfigFailure.test.ts`; drive a missing-config publish.
- **Expected:** adapters 5/5, config-failure 1/1, 0 outbound calls.
- **Falsify:** `providerCalled:true` locally with no request, or a durable `unknown` row created without a provider call.

**QA-03 — Publish Now outcome handling (HTTP 207)** · same source §2 · Claim: `getPublicationFeedback` reads
`outcomes[].status`; only `published` is success; `failed`/`unknown`/mixed/empty handled distinctly.
- **Run today:** `NODE_ENV=test node --import tsx --test client/src/lib/publication-feedback.test.ts`; and inspect
  both surfaces (`client/src/components/create/artifact-review-view.tsx`, `client/src/components/agent/artifact-review.tsx`).
- **Expected:** 7/7; 207 `published`→"Published successfully", `failed`→"Publication failed", `unknown`→"Publication needs
  verification", mixed→"Publication results are mixed", `[]`→"Publication result unavailable".
- **Falsify:** envelope status (200/207) treated as success for a non-`published` outcome, or one of the five strings missing.

**QA-02 — (NOT LOCATED).** Requested by the task brief, but no `QA-02` identifier is defined anywhere in the repo's
audit documentation. `OWN-01`, `OWN-02`, `QA-01`, `QA-03` exist; `QA-02` is a gap. The QA source itself
(`/Users/kishore/Downloads/final-qa-bug-report.md`) is outside the repo and was not readable. **Action for the final
auditor:** treat `QA-02` as unresolvable from in-repo evidence; record it as "no source" rather than inventing a check.

**B1 — No auth/ownership on the legacy API** · `docs/phase-30-production-readiness-report.md` §32 (blocker),
remediated `docs/phase-30.1-auth-enforcement-report.md`, re-gated `docs/phase-30.2` §3 · Claim: a global `authGate`
now 401s every `/api` path except the pinned allowlist; owner identity is session-only; no handler runs pre-auth.
- **Run today:** `NODE_ENV=test node --import tsx --test server/middleware/authGate.test.ts`; then anonymous probes:
  `curl -si http://127.0.0.1:<port>/api/posts`, `/api/accounts`, `POST /api/images/generate`, `POST /api/posts/x/publish`,
  `POST /api/autonomy/run` → expect `401 {"message":"Unauthorized"}` and zero side effects.
- **Expected:** 8/8 gate tests; every anon probe 401; forged `X-Owner-Id`/body `ownerId` ignored.
- **Falsify:** any anonymous request reaching a handler; forged identity authenticating; allowlist looser than the four entries.

**F1 — fail-open SESSION_SECRET** · `phase-30` §28 · Claim: prod boot throws without a real `SESSION_SECRET`.
- **Run:** boot `NODE_ENV=production node dist/index.cjs` with `SESSION_SECRET` unset/dev-default.
- **Expected:** process exits (fail-closed).
- **Falsify:** the server boots and serves with the default secret.

**F2 / F6 — health & readiness** · `phase-30` §28 · Claim: `GET /api/health` (liveness) and `GET /api/ready`
(DB `SELECT 1`, up/down only) exist; Railway/Dockerfile healthcheck points at `/api/ready`.
- **Run:** boot; `curl -s /api/health` → `{"status":"ok",…}`; `curl -s /api/ready` → 200 `ready`; stop the DB and re-probe.
- **Expected:** ready 200 with DB up, 503 with DB down; healthcheck in `railway.toml`/`Dockerfile`.
- **Falsify:** `/api/ready` returns 200 with the DB down, or the healthcheck targets a static config route.

**F3 — secret-shaped fields in the access log** · `phase-30` §28 · Claim: key-name redaction before logging;
audit log stores body SHA-256 only.
- **Run:** issue a request carrying a token field; inspect stdout/access log and `server/httpHardening.ts` `redactForAccessLog`.
- **Expected:** no token value in the log.
- **Falsify:** a secret-shaped value appears verbatim in a log line.

**F4 — logout left the cookie set** · `phase-30` §28 · Claim: logout clears `connect.sid` and always responds success.
- **Run:** authenticate, `POST /api/auth/logout`; inspect `Set-Cookie: connect.sid=; Expires=1970…`; reuse the old cookie.
- **Expected:** cookie cleared; stale cookie ⇒ 401.
- **Falsify:** the cookie survives logout, or a stale cookie still authenticates.

**F5 — raw-fetch SSRF in legacy ingestion** · `phase-30` §28 · Claim: legacy ingestion uses `safeFetch` (SSRF guards).
- **Run:** `NODE_ENV=test node --import tsx --test server/security/legacyFetchDenial.test.ts` and
  `NODE_ENV=test node --import tsx --test server/security/ssrf.test.ts`; live-probe metadata IP / localhost / RFC1918.
- **Expected:** `legacyFetchDenial` 2/2; blocked URLs → 400 with no outbound request.
- **Falsify:** a raw `fetch(` reappears in `server/routes.ts` for a caller URL, or a private URL succeeds.

**G1 — no session regeneration; 30d fixed expiry** · `phase-30` §28 · Claim: documented non-blocking, single-operator.
- **Run:** inspect `server/routes.ts` login/register session handling; test login fixation.
- **Expected:** behaviour is as documented (no rotation) and carries the mitigation.
- **Falsify:** it is claimed fixed when it is not — i.e. the register's "documented" status is mis-scoped.

**G2 — Google OAuth email-linking without verified check** · `phase-30` §28 · Same pattern (documented).
- **Run:** inspect `server/auth.ts` linkage.
- **Expected:** as documented.
- **Falsify:** an unverified email can take over an existing account (would escalate beyond "documented").

**G3 — `aiCall` has no client timeout** · `phase-30` §28 · Claim: bounded by job expiry instead.
- **Run:** inspect `server/ai/chat.ts`; confirm callers set job expiry.
- **Falsify:** an unbounded request path exists outside a job.

**G4 — uploads served without auth** · `phase-30` §28 · Claim: covered by M1 (same class as legacy exposure); static `/uploads`.
- **Run:** `curl -si http://127.0.0.1:<port>/uploads/<known-file>` with no session.
- **Expected:** reachable (documented) — the auditor must decide whether this is still acceptable on the pushed tree.
- **Falsify:** it is now authenticated (documented claim stale) or a secret file is servable.

**G5 — compose ships a weak placeholder SESSION_SECRET** · `phase-30` §28 · `docker-compose.yml:36`.
- **Run:** inspect `docker-compose.yml`.
- **Expected:** placeholder present, local-dev only, marked.
- **Falsify:** the compose default is usable in a shared/prod context without override.

**R1 / R1a / R1b — shared-pool tenant residue** · `phase-30.1` §6, `phase-30.2` §5, narrowed in `phase-33.1`.
- **R1a:** legacy NULL-attributed rows visible to any authenticated user; **R1b:** voices/templates/policies shared-config.
- **Run today:** `NODE_ENV=test node --import tsx --test server/content/ownerIsolation.dbtest.ts` (the NULL-bridge case);
  inspect R1a/R1b triggers in `phase-33.1` §§10/§A7 and `phase-30.2` §5.
- **Expected:** attested rows are own-or-null-or-404; R1a/R1b inert single-tenant with NO-GO triggers (second tenant).
- **Falsify:** a second owner reads an *attributed* row, or the NULL pool exposes something a single tenant should not see.

**M1 / M2 / M3 / D1 / Q1 — operational mitigations** · `phase-30.2` §13 · single-tenant posture (M1, narrowed),
polling alerting (M2), platform RPO/RTO (M3), E2E-gated deploys (D1), Journey-E quarantine (Q1).
- **Run:** confirm none has become a product regression (M2 = no push alert exists; verify a breaker-open is API-visible only).
- **Expected:** as documented.
- **Falsify:** any of these is presented as fixed while the underlying condition remains, or the NO-GO trigger has occurred
  (e.g. a second tenant was onboarded without backfill).

**F-32-01 — Journey E quarantine** · `docs/final-contentforge-v1-audit.md` §18/§20 · Claim: `learning-proposals` Journey E
zero-mutation assertion fails in parallel CI via shared-user pollution; classified TEST DEFECT, quarantined.
- **Run:** `npx playwright test e2e/learning-proposals.e2e.spec.ts --workers=1` then parallel.
- **Expected:** serial green; parallel red attributable to shared-user interference.
- **Falsify:** serial run also red (real defect), or the failure is caused by product code rather than the shared fixture.

**F-32-02 — visualPublication lease flake** · `final-contentforge-v1-audit.md` §16/§20 · Claim: intermittent, both trees, no
production impact; lease arbitrates correctly on clean runs.
- **Run:** `NODE_ENV=test node --import tsx --test server/content/visualPublication.dbtest.ts` repeatedly (fresh DB), and in
  full-suite context.
- **Expected:** passes fresh and in isolation; may flake under suite load on either tree.
- **Falsify:** a duplicate publication is actually delivered (2 published instead of 1 on a clean run).

**A1 / A2 — scheduler test-harness contention** · `phase-31.1` §18 · Claim: non-production harness issues (pending reconcile
jobs starving a later test); fixed by draining + ordering.
- **Run:** `NODE_ENV=test node --import tsx --test server/content/autonomy/scheduler.dbtest.ts`.
- **Expected:** 23/23 (per 31 docs); no production code change involved.
- **Falsify:** the contention now manifests as a *product* duplicate activation.

**29.4 budget-race defect** · `phase-29.4-deep-audit-report.md` §16 · Claim: gate checks were lock-free; fixed with
`SELECT … FOR UPDATE` on `autonomy_configs`; regression test added.
- **Run:** `NODE_ENV=test node --import tsx --test server/content/autonomy/autonomy.dbtest.ts` (20 tests incl. the race test).
- **Expected:** 20/20, exactly one of two concurrent cross-scope activations succeeds past a budget of 1.
- **Falsify:** both concurrent activations commit, or the budget is exceeded under concurrency.

**UX-37 / UX-38 / UX-39** · `phase-29.5-final-ux-audit-report.md` §19 · Claim: raw `targetScope` humanized everywhere;
`not_available` guardrail humanized; human vs autonomous activation badges.
- **Run:** `npx playwright test e2e/experiments.e2e.spec.ts e2e/learning-proposals.e2e.spec.ts`; grep the client for raw scope
  strings (`grep -rn "channel:" client/src`).
- **Expected:** no raw `channel:x;format:y`, no raw `not_available`, distinct "Activated by You"/"Activated Automatically".
- **Falsify:** any raw enum string renders; both actor badges render identically.

**`settings.tsx` credential display** · `docs/design-security-gate.md`, `docs/final-design-landing-report.md` §2.1 ·
Claim originally "plaintext token in DOM"; investigation found a **masked** value (`••••••` + last 4) and two real defects
(false claim; accidental safety) now fixed with `maskSecret` and 11 tests.
- **Run:** `NODE_ENV=test node --import tsx --test client/src/lib/secret-display.test.ts`;
  `npx playwright test e2e/security-secret-exposure.e2e.spec.ts`.
- **Expected:** 6/6 unit + 5/5 browser; the canary is absent from network/DOM/localStorage/sessionStorage/URL/console.
- **Falsify:** the raw token appears on any surface; a ≤4-char secret is revealed; the settings row is not `Token (masked)`.

**.env.orig-backup leak** · `final-design-landing-report.md` §2.2 · Claim: purged from history, never pushed, 0 reachable objects.
- **Run:** `git log --all --oneline -- .env.orig-backup` and `git rev-list --all --objects | grep -i 'env.orig'` (expect empty);
  `git ls-files | grep -iE '(^|/)\.env'` (expect only `.env.example`).
- **Expected:** empty; only `.env.example` tracked.
- **Falsify:** any reachable object or tracked env file containing live values. **Note:** `.gitignore` matches the exact name
  `.env` only — `.env.*` is NOT ignored (§2 row SEC-04).

**33.1 self-inflicted regression: over-broad credential gating** · `phase-33.1` addendum §A2 · Claim: a too-broad owner gate
dropped deployment env credentials for every authenticated request, breaking 28 publication tests; corrected so owner's own
account wins but env credentials remain the fallback.
- **Run:** `NODE_ENV=test node --import tsx --test server/content/linkedin.dbtest.ts` (and the threads/instagram/x sibling db tests).
- **Expected:** owner's own connected account used; env credentials used only when the owner has none; no cross-tenant borrow.
- **Falsify:** a deployment configured only via env vars cannot publish, OR owner A publishes with owner B's stored token.

**33.1 residual risks (A7)** · `phase-33.1` addendum §A7 · (1) NULL-owner publication rows reach the unscoped
`getConnectedAccount(platform)` branch; (2) `/api/publications/dispatch` is not owner-scoped (cross-tenant *trigger*);
(3) `getUserId(req) ?? 1` remains in ~25 canonical handlers (dead while the gate precedes routers).
- **Run:** inspect `server/content/routes.ts` dispatch handler and `publications.userId` nullability;
  `grep -rn "?? 1" server/routes.ts`.
- **Expected:** the three are latent-only on the pushed tree (no reachable HTTP entrypoint creates a NULL-owner row; dispatch
  uses each publication's own owner credentials).
- **Falsify:** a directly-inserted NULL-owner row is dispatched, or dispatch makes outbound calls on another tenant's behalf,
  or a router is mounted outside `authGate` making `?? 1` live.

### 1.2 UX findings — `UX-01` … `UX-41`

Sources: `docs/full-product-ux-audit.md` §6 (UX-01–UX-36), `docs/phase-29.5-final-ux-audit-report.md` §19 (UX-37–UX-41),
reconciliation in `docs/phase-30.3-post-merge-ux-audit-report.md` §22. All UX-01–UX-36 were recorded **FIXED** except
UX-13 (partial), UX-32 (deferred), UX-34 (documented); UX-37/38/39 FIXED; UX-40/41 deferred.

Because the same handful of commands verify many IDs, the rows group the IDs with the shared check, then list per-ID
specifics. The auditor must run the command and then confirm each named ID's specific observable.

| IDs | What to run/inspect today | Expected | Falsify |
|---|---|---|---|
| UX-01 (Quick Capture position) | `npx playwright test e2e/quick-capture.e2e.spec.ts` | Fixed positioning verified at 1440/820/390 | Captured panel is `relative`, drifts on scroll |
| UX-02 (destructive confirm) | `npx playwright test e2e/destructive-actions.e2e.spec.ts`; grep `ConfirmDialog` call sites | All DELETE sites guarded by `ConfirmDialog` | A delete fires with no confirmation |
| UX-03 (failed read ≠ empty) | `npx playwright test e2e/error-states.e2e.spec.ts`; grep `isError\|ErrorState` in the 5 regions (`operator-ux-audit` Finding 1) | Failed reads render `ErrorState` with retry | A forced 500 renders an empty/zero state |
| UX-04 / UX-29 (raw JSON / auth validation) | `npx playwright test e2e/auth-page.e2e.spec.ts`; inspect `toUserMessage` (`client/src/lib/error-messages.ts`) | Human sentences; inline password rule | A toast shows `500: {…}` |
| UX-05 (AI provider hardcoded) | Inspect `AiProviderStatusCard` + `/api/agent/runtime` | Real/neutral status, not a hardcoded "Connected" | Green badge shown while the backend is unreachable |
| UX-06 / UX-07 (schedule/publish confirm) | `npx playwright test e2e/create-workflow.e2e.spec.ts e2e/agent-workspace.e2e.spec.ts` | `SchedulePicker` + `PublishPreview` two-step | Single-click publish; `Date.now()+60s` hardcode |
| UX-08 (resume control) | grep `panel-auth-callout` / `POST /runs/:id/resume` | Approve & continue present | Waiting run has no resume affordance |
| UX-09 (CopilotKit 403) | Load `/agent`; console scan | 0 CSRF 403s; provider unmounted | Un-tokened POST ⇒ 403 |
| UX-10 (run status vs tool failures) | Inspect `deriveRunDisplayStatus`; open a failed-tool run | `completed_with_errors` shown | A failed tool shows "completed" identically |
| UX-11 (nested scroll traps) | `npx playwright test e2e/agent-workspace.e2e.spec.ts` at 390×844 | Single stream; diagnostics in a Sheet | Inner scroller traps content |
| UX-12 (sidebar clipped) | Inspect `app-sidebar.tsx`; check 900px height | 7 canonical destinations, no clip | 21 items / clipped group |
| UX-13 (two content models) | Inspect Schedule Publications tab + `legacy-route-mapping.ts` | Publications tab bridges canonical pipeline (PARTIAL, documented) | Claimed fully unified (would be false) |
| UX-14 / UX-15 / UX-16 (IA entry points/labels) | `npx playwright test e2e/canonical-ia.e2e.spec.ts` | One Sources hub; nav labels == page titles | Duplicate entry points; label/title mismatch |
| UX-17 (domain jargon) | grep `ResearchJob`/`opp_`/`UNTRUSTED` in client | Humanized copy | Raw tokens render |
| UX-18 (compliance banners) | grep the banner component | Consolidated | Multiple hand-rolled banners |
| UX-19 / UX-20 / UX-21 / UX-22 (daily loop / dead-end copy / fake zeros / stale queue) | `npx playwright test e2e/create-workflow.e2e.spec.ts e2e/today-schedule.e2e.spec.ts`; inspect Queue copy + metric rendering | Full Create→Review→Approve→Schedule/Publish; honest `—` metrics; cache invalidation | "coming soon" copy; fake 0 engagement; stale rows |
| UX-23 / UX-24 / UX-25 / UX-26 / UX-27 (a11y shell) | `npx playwright test e2e/accessibility.e2e.spec.ts`; view page source for `<title>`, `nav` landmark, skip link | Titles, `nav aria-label`, skip link, labelled controls, ≥44px | Missing title/label/landmark; `maximum-scale=1` |
| UX-28 (404 dark contrast) | Visit `/nonexistent` in dark mode | Styled, dark-safe, return link | Light bg / dev jargon |
| UX-30 (mobile layout) | `npx playwright test e2e/full-product-audit.e2e.spec.ts` viewport matrix | No overflow at 390/430 | Horizontal clip |
| UX-31 (font families) | Inspect `client/index.html` | Only Open Sans | ~25 families requested |
| UX-32 (command palette) | grep `cmdk` usage | DEFERRED (no live command palette) | Claimed built |
| UX-33 (theme toggle label) | Inspect `theme-toggle.tsx` | Dynamic `aria-label` | Unlabelled |
| UX-34 (profile copy) | Inspect `profileData`/brand copy | DOCUMENTED as intentional | Presented as a defect |
| UX-35 (uneven headers) | grep `<PageHeader` consumers | Unified | Bespoke headers |
| UX-36 (chart label overlap) | Inspect `analytics.tsx` | Responsive viewBox/axis | Overlap |
| UX-37 (scope jargon) | `npx playwright test e2e/experiments.e2e.spec.ts`; grep `humanizeScope`; grep raw `channel:` | Humanized at all display sites | Raw `channel:x;format:y` |
| UX-38 (`not_available`) | grep `not_available` in client | Mapped to "—"/"Not Available" | Raw snake_case |
| UX-39 (actor distinction) | `npx playwright test e2e/experiments.e2e.spec.ts`; inspect `ActorBadge` | Distinct icon+word per actor | Human/auto identical |
| UX-40 (budget-remaining) | Inspect the autonomy status card | DEFERRED — no proactive counter | Claimed built |
| UX-41 (allowlist visibility) | Inspect the autonomy panel | DEFERRED — allowlist not surfaced | Claimed built |

### 1.3 Design-programme findings

**Baseline register O1–O8** · `docs/design-orchestration-baseline.md` §8b · Two already-resolved sets precede these
(§8a) and must NOT be re-reported as defects. The O-set is the coordinator's own pre-agent register.

| ID | Claim | Run/inspect today | Expected | Falsify |
|---|---|---|---|---|
| O1 | `source-card.tsx` focus stripped, no ring (HIGH) | grep `focus:outline-none` in `source-card.tsx`; axe/keyboard on `/sources` | A visible ring on the Explore action | Focus invisible on the primary action |
| O2 | `navigation-menu.tsx` focus (HIGH→dead) | grep importers of `navigation-menu` | 0 importers (unreachable) | It is mounted and unfocusable |
| O3 | status hue/pulse only (MEDIUM) | `prefers-reduced-motion` on a `generating` vs `running` badge | Distinct non-colour glyph survives reduce | Two states identical after motion removed |
| O4 | `CardTitle` default `text-2xl` (MEDIUM; refuted count) | parse `<CardTitle>` call sites for size overrides | 41/41 overridden (0 render at 24px) | Any `CardTitle` renders at 24px |
| O5 | 250 palette literals (MEDIUM) | `grep -roE '(bg\|text\|border)-(emerald\|…)-[0-9]{2,3}' client/src \| wc -l` | ≤49 remain (§deferral DEF-05) | Materially more than 49 in live code |
| O6 | `learning-view.tsx` 1909 lines, nested cards (MEDIUM) | `wc -l` + `grep -c "<Card"` | flattened; no nested card-in-card | Nested card-in-card present |
| O7 | icon-topper circle cloned (MEDIUM; refuted) | `grep -rn 'rounded-full bg-muted' client/src` | 1 real instance, 0 clones | Multiple clones |
| O8 | 17 exclamation-point successes (LOW) | grep `title: *"[^"]*!"` / literal `!` copy in toasts | 0 | Exclamation successes remain |

**Coordinator synthesis groups A1–M8** · `docs/design-coordinator-synthesis.md` §3 · Statuses: A1/B1/C1/D1/E1/F1/G1/H1/I1/J1/K1/L1 ACCEPTED (with K1(a) deferred); M1–M8 are reject/defer/partial.

| ID | Claim | Run/inspect today | Expected | Falsify |
|---|---|---|---|---|
| A1 | No semantic status tokens; 250 literals; `--destructive` byte-identical across themes | grep `--success|--warning|--info` in `index.css`; axe contrast | 12 semantic token definitions; dark `--destructive` divergent | Tokens absent; error text still <4.5:1 dark |
| B1 | Focus removed on `/sources` + ~1.01:1 menu highlight | keyboard on `/sources`; compile CSS for the ring | Ring restored; focus-opt moved to `--ring` | Invisible highlight anywhere |
| C1 | `overlay-motion` exit unreachable; sheet exit > entrance | compile `index.css`; grep `overlay-motion` usage in `sheet.tsx` | 0 unsatisfiable selectors; exit ≤ entrance | `[data-state="open"][data-state="closed"]` compiles |
| D1 | Failed reads rendered as clean states (5+ regions) | grep `isError` across the named regions | Honest error branches | A failed read shows empty/zero |
| E1 | `learning-view.tsx` structure (nested cards, 5 identical headers) | read the file; grep `<Card`/`<h2` | flattened, tiered headers | Same structure |
| F1 | Agent workspace Dismiss lies; raw enum statuses; Approve buried | `npx playwright test e2e/agent-workspace.e2e.spec.ts` | Honest "Hide request"; decision-first order | Dismiss changes derived status without a request |
| G1 | Overlay actions unreachable at 390×844; no `dvh`; tab overflow | `e2e/full-product-audit` viewport matrix; compile CSS | bodies scroll `max-h-[90vh]`; `dvh` via `@supports`; tab `overflow-x-auto` | Submit row unreachable at 390×844 |
| H1 | 1.79 MB single chunk; 0 `React.lazy` | grep `React.lazy`; build and measure entry chunk | 8 lazy route chunks; entry ≈354 KB | single eager chunk remains |
| I1 | In-flight statuses collapse under reduce (MEDIUM) | reduced-motion on the badges | distinct glyphs | collapse |
| J1 | Tab strips occupy the primary-action slot on `/schedule`,`/insights` | grep `action=` in those pages | primary action separated (band consolidation deferred) | tab strip still in the action slot |
| K1 | (a) `/schedule` hides occurrences; (b) handoff params dropped | grep `schedule-occurrences` consumers; inspect `create.tsx`/`agent.tsx` param parsing | (b) fixed — params parsed; (a) DEFERRED | (b) still drops `?topic=/?sourceUrl=/?prompt=` |
| L1 | Hardcoded light-ramp hues as text | axe + grep | migrated to `--info`/semantic | low-contrast literals remain |
| M1 | CardTitle default (rejected) | see O4 | rejected: 41/41 override | — |
| M2 | `navigation-menu` focus (deferred dead code) | grep importers | unreachable | mounted |
| M3 | empty-state circle clones (rejected) | grep | 0 clones | clones |
| M4 | settings token display (escalated) | see §1.1 settings row | fixed via `maskSecret` | raw token rendered |
| M5 | `/today` asks "create?" twice (deferred) | inspect `today.tsx` header + Quick Actions | deferred (may still duplicate) | — (do not reopen as defect) |
| M6 | `create.tsx` "YouTube (deferred)" copy | grep `(deferred)` | removed | roadmap text in UI |
| M7 | 7 pollers at 1.2–1.5s (deferred) | `grep -rn refetchInterval client/src` | 7 sites (deferred) | — (do not reopen) |
| M8 | 250-literal sweep (partial) | see O5 | semantic-only migration; categorical/brand literals left | full sweep claimed |

**Integration gap report P0–P4** · `docs/design-integration-gap-report.md` §3.

| ID | Claim | Run/inspect today | Expected | Falsify |
|---|---|---|---|---|
| P0 | none | — | no data loss / broken canonical route / unreachable action / security regression | any of those present |
| P1 | none outstanding on a canonical route | run the canonical-IA + axe suites | both P1 items fixed | a P1-class defect exists on a canonical route |
| P2-1 | `--primary` unsafe as text; `--primary-text` token deferred | axe on canonical routes; grep `text-primary` as link text | axe passes; the one fixed site uses `--info`; token deferred | axe fails on a `text-primary` link |
| P2-2 | `/schedule` never surfaces occurrences | grep `schedule-occurrences` consumers | DEFERRED (feature) | claimed implemented |
| P2-3 | `/sources` band not collapsed | inspect `sources.tsx` | DEFERRED (nav change) | claimed collapsed |
| P2-4 | 4 pre-existing spec failures | run the named specs serially | the 4 disclosed failures (see §8) | claimed green, or a 5th appears |
| P2-5 | polling cadence 1.2–1.5s | grep `refetchInterval` | DEFERRED | changed silently |
| P2-6 | auth-gate waterfall | inspect `App.tsx` gate + route queries | DEFERRED | changed silently |
| P3-1 | 45 `text-[Npx]` remain (floored) | `grep -ro "text-\[[0-9]\+px\]" client/src \| wc -l` | ~45 (observed 46 incl. dead routes — reconcile) | sub-12px renders below floor |
| P3-2 | 49 palette literals remain | see O5 | accepted | — |
| P3-3 | 11 `transition-all`; `.pressable` sweep deferred | `grep -rn transition-all client/src` | 11 (observed 11) | count materially higher on live surfaces |
| P3-4 | `--accent` vs `--popover` ~1.01:1 | inspect ring workaround | workaround accepted | invisible focus fill |
| P3-5 | dead code (`vault.tsx`, `navigation-menu.tsx`, `calendar.tsx` highlight) | grep importers | unreachable | reachable |
| P3-6 | render-blocking font stylesheet | inspect `client/index.html` | 1 third-party stylesheet (deferred) | claimed self-hosted |
| P4-1 | settings token contradiction | see §1.1 settings row | fixed | raw token/claim contradiction persists |

**Per-discipline discovery audits** · `docs/design-orchestration/*`. Each uses "Finding #n" numbering; the coordinator
merged them into groups A–L. The auditor can re-derive each by the check below.

| Audit | Finding(s) | Run/inspect today | Expected | Falsify |
|---|---|---|---|---|
| `accessibility-audit.md` | #1 (menu highlight ~1:1), #2 (`source-card` focus), #3 (hardcoded hues), #4 (`navigation-menu` focus, dead), #5 (status hue+pulse), #6 (no focus move on nav), #7 (announcer under-wired), #8 (heading skips `/settings`,`/agent`), #9 (touch targets), #10 (`articles/generate` ring-0, dead), #11 (`focus:` vs `focus-visible:`) | `npx playwright test e2e/accessibility.e2e.spec.ts`; grep the named classes | 26/26; no focus removed without a ≥3:1 ring; heading order valid | axe/keyboard fails; invisible focus; skipped heading |
| `frontend-performance-audit.md` | #1 single 1.71 MiB chunk (HIGH), #2 auth waterfall, #3 duplicate query keys, #4 9 GETs on `/insights?view=learning`, #5 poll fan-out, #6 render-blocking font, #7 1909-line component, #8 chart-color probe, #9 37 highlight.js grammars | §6 below | entry ≈354 KB, 8 chunks, dedup keys | single chunk; duplicate fetch on one mount |
| `ia-ux-audit.md` | #1 `/schedule` occurrences (HIGH), #2 handoff params (HIGH), #3 `/sources` bands (HIGH), #4 tab strips in the action slot (HIGH), #5–#15 | see K1/J1 and UX rows; `grep -rn "schedule-occurrences" client/src` | exactly one consumer (`today.tsx`) unless (a) landed | claimed fixed while the grep still returns one consumer |
| `motion-audit.md` | #1 `overlay-motion` unsatisfiable (15 sites), #2 sheet exit>entrance, #3 no in-flight feedback on Approve/Publish, #4 spinner-only pending, #5 `.pressable` 0 on raw buttons, #6 announcer unwired, #7 toast full-height travel, #8 raw `animate-pulse` residue, #9 tokens unconsumed by markup, #10 11 `transition-all` | compile `index.css`; grep the named classes | compiled selector satisfiable; exit ≤ entrance | recompiled CSS still contains `[data-state="open"][data-state="closed"]` |
| `operator-ux-audit.md` | #1 five regions no `isError`, #2 Attention from 20-row window, #3 Publications `?limit=30` no total, #4 unbounded lists, #5 dialogs don't name the target, #6 flat Activity feed, #7 no retry on failed publication, #8 disabled publish no reason, #9 AI-usage 10-row truncation | `grep -rn "limit=20\|limit=30" client/src`; run the region queries with a forced error | error branches present; window disclosed | failure rendered as empty; silent truncation |
| `responsive-audit.md` | #1–#9 (overlay clipping at 390/430, `w-full max-w-lg` gutter, coarse-pointer tier missing, tab `overflow-x-auto`, `h-screen` iOS, etc.) | `npx playwright test e2e/full-product-audit.e2e.spec.ts` viewport matrix | no overflow at the 7 viewports; coarse-pointer tier on 5 shell controls | overlay action unreachable at 390×844 |
| `visual-audit.md` | #1–#9 (hierarchy, type, colour, `CardTitle` default, KPI scale) | read `learning-view.tsx`; §5 matrix | tiered hierarchy; type scale holds | equal-weight bands |
| `design-system-audit.md` | #1 status text contrast 2.95–3.35:1 (HIGH), #2 dark `--destructive` 3.04:1 (HIGH), #3 250 literals, #4 four status vocabularies, #5 empty-state fork, #6 dead `CardTitle` default, #7 page-title scales, #8 green primary actions, #9 dead `status.*` config | grep the literals; compute contrast | semantic tokens; one vocabulary; darkened dark destructive | contrast arithmetic still fails |
| `ai-autonomy-ux-audit.md` | #1 activation `isError` missing (HIGH), #2 Dismiss lies (HIGH), #3 sign/colour of deltas, #4 raw enum statuses, #5 internal nouns/hashes, #6 raw error codes, #7 announcer unwired, #8 in-flight collapse, #9 "Ask/Consult Agent" anthropomorphism | grep the named sites; run `e2e/experiments`/`learning-proposals` | `isError` branch present; Dismiss honest | failed activation read renders Activate button; Dismiss clears status without a request |

### 1.4 Requested identifiers NOT located

The task brief named several identifier families. Only some exist in the repo. Recorded here so the final auditor does
not fabricate checks for them:

| Requested ID | Status |
|---|---|
| `OWN-01`, `OWN-02` | Found (`phase-33.1` §2) — see §1.1 |
| `QA-01`, `QA-03` | Found (`phase-33.1` §2) |
| `QA-02` | **Not found anywhere in the repo's audit docs**; the QA source (`~/Downloads/final-qa-bug-report.md`) is outside the repo |
| `UX-F03` | **Not found** in any repo document (the UX register uses `UX-01…UX-41`) |
| `A11Y-*` | **No literal `A11Y-nn` identifiers exist.** The accessibility programme uses `docs/design-orchestration/accessibility-audit.md` "Finding #1…#11" and the register IDs `O1/O2/O3` + group `A1`. Map the brief's `A11Y-*` to those. |
| `DES-*` | **No literal `DES-nn` identifiers exist.** Map to `docs/design-orchestration/design-system-audit.md` Finding #1…#9 and group `A1` (tokens). |
| `DLQ-01` | No literal `DLQ-01`. The nearest is `phase-31.3-operational-soak-report.md` §8 and `phase-31.4` §"Tests" (`DLQ-1` drill: 3 retries then DLQ-retained). Use that. |
| `PERF-01` | No literal `PERF-01`. Map to `frontend-performance-audit.md` Finding #1 (single chunk) and `P2-5/P2-6`. |
| `ENG-01` | **Not found.** No engine-labelled finding exists; the closest engine material is `server/research/engine.dbtest.ts` + `docs/phase-29-learning-architecture.md` (no per-finding ID). |

---

## 2. Security test matrix

Rows: `ID · what to run/inspect · expected result · how to falsify`.

| ID | Run / inspect | Expected | Falsify |
|---|---|---|---|
| SEC-01 tracked-secret scan | `git grep -nIE '(sk-[A-Za-z0-9_-]{20,}\|ghp_[A-Za-z0-9]{36}\|AIza[0-9A-Za-z_-]{35}\|BEGIN [A-Z ]*PRIVATE KEY\|xox[baprs]-)' -- . ':(exclude)*.example'` and `git log -p -S'BEGIN PRIVATE' --all` | No live secret in tree or history | Any real key/token matched |
| SEC-02 secret-file scan | `git ls-files \| grep -iE '(^|/)\.env\|secret\|credential\|\.pem$\|id_rsa'` | Only `.env.example` (placeholders) | A real `.env`/key/credential file is tracked |
| SEC-03 reachable-git-object scan | `git rev-list --all --objects \| grep -iE 'env\.orig\|\.env$\|secret\|credential'` and `git log --all --oneline -- .env.orig-backup` | 0 objects for `.env.orig-backup`; no env objects | Any reachable object containing a secret |
| SEC-04 `.gitignore` coverage | Read `.gitignore` (currently ignores the exact name `.env` only) | Secret files are ignored | A secret file whose name is NOT exactly `.env` (e.g. `.env.orig-backup`, `.env.local`) is not ignored → a plausible leak vector. **Confirm the rule is exact-name, not `.env.*`.** |
| SEC-05 Settings credential masking | Connect a canary; `curl` `/api/accounts`; load `/settings`; search all six surfaces; run `e2e/security-secret-exposure.e2e.spec.ts` + `client/src/lib/secret-display.test.ts` | Value is `••••••`+last4; canary absent from network/DOM/localStorage/sessionStorage/URL/console; ≤4-char secret never revealed | Raw token anywhere; unmasked connect response; `maskSecret` bypassable |
| SEC-06 anonymous 401 | `curl -si /api/posts /api/accounts /api/ideas /api/posts/<id>/publish /api/images/generate /api/autonomy/run /api/posts` with no cookie | `401 {"message":"Unauthorized"}` on all; handler never runs | Any 200/500; any side effect |
| SEC-07 cross-owner denial | `legacyOwnerIsolation.dbtest.ts` + `ownerIsolation.dbtest.ts`; live A/B/anon battery (see §3) | A→B 404, B→A 404, anon 401, no-lockout | Any foreign row read/written |
| SEC-08 forged identity | send `X-Owner-Id`/`X-User-Id`/body/query `ownerId` | Ignored; session owner used; forged create stored as the session owner | Forged id honoured |
| SEC-09 SSRF guards | `ssrf.test.ts`, `legacyFetchDenial.test.ts`; probe metadata/localhost/RFC1918/odd ports/redirect-to-metadata | Blocked → 400, no outbound request | Any private URL fetched |
| SEC-10 CSRF | POST without token → 403; with token → pass; confirm 401 precedes 403 | Enforced post-auth; 401 before 403 | CSRF disabled or bypassable |
| SEC-11 log redaction | inspect `redactForAccessLog` (`server/httpHardening.ts`), `redactYouTubeSecrets`; drive a request carrying a token | No token in logs; audit log stores body hash | Token in a log line |
| SEC-12 uploads | `curl -si /uploads/<file>` no session | Documented exposure (M1 class) — auditor decides | A secret file is servable |
| SEC-13 paid-side-effect gate | anon + wrong-owner calls to paid endpoints; assert handler/provider count 0 | 401/404 before any provider code | Any provider call pre-auth/wrong-owner |
| SEC-14 error sanitization | force a 5xx; inspect body | Generic message; internals logged server-side only | Stack trace / internals leaked |

---

## 3. Tenant-isolation matrix

| ID | Run / inspect | Expected | Falsify |
|---|---|---|---|
| TEN-01 newer-slice row isolation | `NODE_ENV=test node --import tsx --test server/content/ownerIsolation.dbtest.ts` | 5/5 over real HTTP: anon 401; B 404 across stories/opportunities/jobs/artifacts(+transitions/history/revise/visuals)/schedules/publications/result; no-branch; no-lockout; NULL bridge | Any foreign id addressed row returns non-404 |
| TEN-02 legacy owner isolation | `NODE_ENV=test node --import tsx --test server/legacyOwnerIsolation.dbtest.ts` | 2/2 incl. the real-`Authorization`-header guard (owner A with no account uses env credentials, never B's token) | A publishes with B's stored token |
| TEN-03 research/agent/learning ForOwner | run `server/research/*.dbtest.ts`, `server/agent/agent.dbtest.ts`, `server/content/learning.dbtest.ts`, `server/content/experimentation/experiments.dbtest.ts`, `server/content/policyActivation/policyActivation.dbtest.ts` | owned-job 404; `getRunForOwner`; ForOwner reads | Any foreign read |
| TEN-04 autonomy ownership | `server/content/autonomy/autonomy.dbtest.ts` owner-isolation case | Foreign candidate → `UNKNOWN_STATE`, no leak, journal unaffected | Distinguishing error or cross-owner activation |
| TEN-05 legacy NULL bridge (R1a) | ownerIsolation NULL-bridge case | NULL-attributed rows visible to any authenticated user (documented residue) | Documented residue presented as a defect, or an *attributed* row leaking |
| TEN-06 shared config (R1b) | inspect voices/templates/policies readers | Shared-config by explicit decision; generations pin revisions | R1b readers mutated per-row by a reader |
| TEN-07 cross-owner trigger via dispatch | inspect `/api/publications/dispatch`; attempt to trigger another tenant's due work | Each publication uses its own owner's credentials; cross-tenant *trigger* only (documented A7) | Credential leak or foreign publication executed with the caller's identity |
| TEN-08 forged owner on create | POST a create with `ownerId=<other>` | Stored as session owner | Forged owner stored |
| TEN-09 anonymous path to owner-1 | prove no reachable helper falls back to owner 1 under the gate | `?? 1` exists but is dead pre-gate; static test pins the gate mount order | Any router mounted outside `authGate` with a `?? 1` fallback |

**Manual A/B script (adapt):** register A and B; `A lists → [A's]`, `B lists → [B's]`; `A→A 200`, `A→B 404`, `B→A 404`,
anonymous 401; `A DELETE B → 404`, `A PUT B → 404`; `A forges ownerId=B on create → stored userId = A`; confirm B's rows
intact after every A operation.

---

## 4. Functional capability matrix

Columns: capability · spec/command that exercises it · expected · falsify.

| Capability | Exercise | Expected | Falsify |
|---|---|---|---|
| Authentication | `e2e/auth-page.e2e.spec.ts`, `e2e/api.e2e.spec.ts`; `authGate.test.ts` | register/login/logout; anon 401; forged ignored | any path unauthenticated |
| Research | `server/research/engine.dbtest.ts`, `providers.dbtest.ts`, `verticalSlice.dbtest.ts`; `POST /api/research/jobs`; `e2e/sources-workflow.e2e.spec.ts` | ResearchJob durable; sources/evidence/analysis readable; enqueue never inline | inline execution or missing artifacts |
| Stories | `server/story/story.dbtest.ts`; `POST/GET /api/stories` | `ResearchJob → Story` cheap read | re-runs research |
| Opportunities | `e2e/full-product-audit.e2e.spec.ts` (Journey A/B); `POST /api/opportunities`, `/select`, `/kill`, `/:id/artifacts` | branching/select/kill; owner-scoped | foreign id non-404 |
| Generation | `server/content/createWorkflow.dbtest.ts`, `phase15.dbtest.ts`; `POST /api/generation-jobs`, `/:id/run` | retry re-executes the same frozen policy+key | new lineage on retry |
| Artifacts | `server/content/content.dbtest.ts`; `GET /api/artifacts`, `/:id`, `/:id/history` | immutable revisions; history ordered | in-place mutation of content |
| Revisions | `POST /api/artifacts/:id/revise`; createWorkflow dbtest | new row with `supersedesId`; original untouched | in-place edit |
| Approval | `POST /api/artifacts/:id/{approve}`; `e2e/create-workflow`; `phase-33.2-…spec.ts` | approval transition; readiness changes only | content mutated |
| Rejection | same action loop with reject; `phase-33.2-…spec.ts` | rejected revision state recorded | reject appears as approve |
| Scheduling | `POST /api/schedules`, `GET /api/schedule-occurrences`, `/schedules/:id`; `server/content/today-schedule.dbtest.ts` | overlap-safe idempotent tick | duplicate occurrence |
| Publication | `POST /api/artifacts/:id/publications`, `GET /api/publications`, `/publications/:id/result`; `server/content/{distribution,reconcile}.dbtest.ts` | pinned revision + idempotency + lease | duplicate publish |
| Results | `GET /api/publications/:id/result`; reconcile dbtests | unknown-first parking; bounded reconcile reuses the same row | blind retry of unknown |
| Analytics | `GET /api/analytics/summary`, `/insights`, `/sync/x/:id`; `phase-30` §12 | owner-scoped reads; live analytics only when credentialed | cross-owner sync |
| Learning | `server/content/learning.dbtest.ts`; `GET /api/learning/signals`, `/summary`, `/observations` | signals derived from results; observed denominator | fabricated metrics |
| Experiments | `server/content/experimentation/experiments.dbtest.ts`; `e2e/experiments.e2e.spec.ts`; `POST /api/experiments/:id/{start,pause,complete,assign,evaluate,decide,policy-candidate}` | deterministic scoring; insufficient/observed/directional never qualify | non-repeatable qualifies |
| Policy candidates | `POST /api/experiments/:id/policy-candidate`; `GET /api/policy-candidates` | candidate references evaluation | — |
| Activation | `server/content/policyActivation/policyActivation.dbtest.ts`, `activation.test.ts`; `POST /api/policy-candidates/:id/activate` | idempotent `identityKey=activate:<candidateId>`; one active per key; 409 concurrent | two active per key |
| Rollback | `POST /api/policy-candidates/:id/rollback`; `GET /api/policies/history`, `/active` | append-only re-activation of prior revision | in-place history rewrite |
| Autonomy | `server/content/autonomy/autonomy.dbtest.ts` (20), `controller.test.ts`, `agent/autonomyDenial.test.ts`, `agent/policyActivationDenial.test.ts` | 15 gates; default-deny; breaker; budgets; agent cannot reach the controller | any bypass |
| Scheduler | `server/content/autonomy/scheduler.dbtest.ts`; `phase-31.3` soak evidence | durable job → lease → reread → controller → audit; no HTTP trigger | an activation path that skips the controller |
| Settings | `GET /api/accounts`, `/api/agent/runtime`, `/api/profile/*`; `e2e/canonical-ia.e2e.spec.ts` | truthful status; masked tokens | hardcoded status; raw token |
| Connected accounts | `POST /api/accounts/connect`, `DELETE /:id`, `POST /:id/test`; YouTube OAuth (`youtube.oauth.dbtest.ts`) | encrypted at rest (AES-256-GCM); masked at API; owner-scoped | plaintext at rest/response; cross-owner |

---

## 5. Seven-destination UX + accessibility + responsive matrix

Canonical routes: `/today`, `/create`, `/sources`, `/agent`, `/schedule`, `/insights`, `/settings`.
Viewports (from `full-product-audit.md` §4 / design brief): **1440×900, 1280×800, 1024×768, 820×1180, 768×1024, 430×932, 390×844**.

**Global command:** `npx playwright test e2e/full-product-audit.e2e.spec.ts` (asserts, per route × viewport,
`scrollWidth <= clientWidth + 1` and a visible header) and `npx playwright test e2e/accessibility.e2e.spec.ts` (axe, 26 tests).

Per route, inspect: title (`ContentForge — <Route>`), exactly one visible `<h1>`, one `<main id="main-content">`,
`nav aria-label="Primary"`, working skip link, honest loading/error/empty states, primary action in the header slot,
no console errors/no secret-shaped text.

| Route | Inspect (in addition) | Expected | Falsify |
|---|---|---|---|
| `/today` | Attention/Schedule/Activity honesty; partial-load note | states distinct; "may be incomplete" note when partial | failure rendered as empty; duplicate "create" CTA is deferred (M5) — do not reopen |
| `/create` | Studio ↔ Review; `?artifact=` back nav; mode/handoff params (`?topic=`,`?sourceUrl=`) | context preserved; Generate gated on input | blank studio from a source link (K1(b) regression) |
| `/sources` | two nav rows; active pill on `/ideas`; explore focus ring | all subviews reachable; primary row reflects state; ring visible | no active pill; focus invisible |
| `/agent` | composer → run → timeline → approval; diagnostics sheet; Dismiss honesty | decision-first; honest Dismiss; internal detail in the sheet | Dismiss mutates derived status without a request |
| `/schedule` | Queue/Calendar/Publications; dialogs name the target | target channel/time named before ship; occurrences gap DEFERRED (P2-2) | publish with no target shown |
| `/insights` | Performance/Learning/AI-usage; learning `isError` on activation query; actor badges; scope humanized | honest error branch; distinct actor badges; humanized scope | Activate button on an already-active policy |
| `/settings` | heading order; credential rows; runtime status | h1→h2→h3; `Token (masked)`; truthful runtime | h1→h3 skip; raw/hardcoded credential/status |

Accessibility specifics: 0 axe violations on all 7 + deep links (`/create?artifact=`, `/schedule?tab=publications`,
`/insights?view=performance|learning|ai-usage`); focus never removed without a ≥3:1 ring; every status has a non-colour glyph
that survives `prefers-reduced-motion`; route change moves focus to `#main-content`; Quick Capture labelled.
Responsive specifics: no horizontal overflow at any of the 7 viewports; overlay bodies scroll (`max-h-[90vh]`); dialog gutter
`w-[calc(100vw-2rem)]`; coarse-pointer tier (44px) on the 5 shell controls. **Carried limitation:** Playwright runs Desktop
Chrome only (`playwright.config.ts`), so coarse-pointer/real-iOS-Safari behaviour is *not* observable by the suite — treat as
a gap, not a pass.

---

## 6. Performance measurement list

| ID | Run | Expected | Falsify |
|---|---|---|---|
| PERF-build | `npm run build` then list `dist/public/assets/*.js` sizes | entry chunk ≈354 KB (was 1,792,007 B); 8 lazy route chunks; gzip reported | a single eager chunk of ~1.7 MB |
| PERF-routechunks | `grep -rn "React.lazy\|<Suspense" client/src` | 8 lazy page imports + one shared `<Suspense>` fallback (`App.tsx`) | 0 lazy; eager imports |
| PERF-entry | `node -e "const fs=require('fs');const d='dist/public/assets';console.log(fs.readdirSync(d).filter(f=>f.endsWith('.js')).map(f=>[f,fs.statSync(d+'/'+f).size]))"` | largest JS chunk is a route chunk, not the entry | entry dominates |
| PERF-today | measure `/today` first-paint payload (gzip) | ≈152 KB gzip (from ≈534 KB) | no improvement |
| PERF-dupkeys | `grep -rn "limit=20\|limit=30\|readiness=" client/src` | artifacts fetched once per mount; publications one canonical key | `/api/artifacts` fetched twice on one `/today` mount |
| PERF-polls | `grep -rn refetchInterval client/src` | 7 sites (deferred cadence) — record, do not re-open | count/behaviour differs materially |
| PERF-font | inspect `client/index.html` | 1 render-blocking third-party stylesheet (deferred) | claimed self-hosted |
| PERF-css | `wc -c dist/public/assets/*.css` | ≈115 KB raw / ≈18 KB gzip | runaway growth |

Caveat to carry: no Lighthouse/device trace was ever run; all prior numbers are compile-time/source-level.

---

## 7. Browser journey list

Run against the production build (`npm run build` → `npm run e2e:serve`, `E2E_PORT` set). Serial is the trustworthy signal.
Specs: `e2e/full-product-audit.e2e.spec.ts`, `create-workflow`, `agent-workspace`, `today-schedule`, `insights`,
`learning-proposals`, `experiments`, `sources-workflow`, `quick-capture`, `canonical-ia`, `accessibility`,
`phase-33.2-ia-ux-accessibility`, `security-secret-exposure`.

**Loop 1 — content lifecycle:**
Research → Create → Review → Approve → Reject → Schedule → Publish → Result → Insights → Learning.
Inspect at each hop: the same artifact identity is preserved; approval changes readiness only; rejection is recorded and visible
on both Create and Agent surfaces; scheduling names the target; publication shows `published`/`failed`/`unknown` distinctly;
Result and Insights reflect observed data only; Learning derives from results.
Falsify: any hop loses context; a rejection looks like an approval; unknown looks like success.

**Loop 2 — learning/autonomy:**
Learning → Experiment → Evaluation → Policy Candidate → Activation → Monitoring → Rollback.
Inspect: evidence ladder (observed→directional→repeatable→confirmed) gates activation; human vs autonomous badges;
budget/cooldown/breaker surface honestly; rollback re-activates the prior revision.
Falsify: non-repeatable evidence activates; two active revisions per key; rollback rewrites history.

**Loop 3 — scheduler durability:**
Scheduler → durable job → lease → authoritative state → controller → audit.
Inspect: `pgboss.job` state transitions; restart recovery; kill-switch flip honoured at execution time; DLQ retention;
`autonomy_decisions` journal completeness.
Falsify: duplicate activation; a scheduler path that bypasses the controller; a kill flip ignored after enqueue.

---

## 8. Test-integrity list

**Rule for the final auditor:** every non-passing test must be classified with **test / reproduction / classification /
production impact**, and re-derived on the pushed tree — never carried from a prior report. A test that is "known failing"
must still be reproduced, and the classification re-validated.

### 8.1 Currently-known non-passing candidates (each must be re-classified)

Source of classification: `docs/final-parallel-baseline.md` §2 (untracked in `main`), `docs/final-design-landing-report.md` §4,
`docs/phase-33.1-critical-trust-fix-report.md` §8/§A6, `docs/final-contentforge-v1-audit.md` §16–18.

| # | Test | Claimed class (where recorded) | Reproduce | Production impact to confirm |
|---|---|---|---|---|
| T1 | `server/content/threads.test.ts` ×3 (`creates a TEXT container…`, `classifies a dropped publish…`, `adapter publish + fetchMetrics…`) | pre-existing; Threads Graph HTTP double (landing report §4.1, parallel baseline §2) | `NODE_ENV=test node --import tsx --test server/content/threads.test.ts` | claimed none (`server/` untouched by design wave) — verify |
| T2 | `server/legacyOwnerIsolation.dbtest.ts` throws `Missing OpenAI credentials` at import | environment (no `OPENAI_API_KEY`) — landing §4.2 / 33.1 §5 | provide a key or a placeholder per §0.3 and re-run | claimed none — verify the security-relevant assertions actually run |
| T3 | `e2e/destructive-actions.e2e.spec.ts:9` | stale spec (navigates to `/ideas`, which redirects) | `npx playwright test e2e/destructive-actions.e2e.spec.ts --workers=1` | claimed none |
| T4 | `e2e/error-states.e2e.spec.ts:20` "Discover" | obsolete premise (force-500s an endpoint the tab never calls) | run serially | claimed none |
| T5 | `e2e/agent-publish.e2e.spec.ts:3` | environment (needs the live research pipeline; times out) | run serially / with provider | claimed none |
| T6 | `e2e/api.e2e.spec.ts:200` (YouTube→Post) | environment (needs real AI credentials) | run with credentials | claimed none |
| T7 | ~14 parallel-only failures (Insights/Learning/Quick Capture/routes) | harness contention (`globalLimiter` exhaustion → `/api/auth/me` 429 → sign-in cascade) | run parallel with 7 workers; confirm all pass serially | claimed none — verify no product path fails |
| T8 | Journey E (`learning-proposals`) zero-mutation assertion | TEST DEFECT (shared CI user) — `final-contentforge-v1-audit.md` Q1 | `npx playwright test e2e/learning-proposals.e2e.spec.ts` serial vs parallel | claimed none |
| T9 | `visualPublication.dbtest.ts` lease race | pre-existing timing flake, both trees | run fresh + in-full-suite | confirm a duplicate publication is never actually delivered |
| T10 | 6 pre-existing DB failures at `d9db1a7` (33.1 addendum §A6): artifact content immutability, legacy NULL-attributed bridge, autonomy policy churn, repeated autonomous rollbacks/breaker, revise-as-new-row, rollback re-activates prior revision | pre-existing, out of 33.1 scope | `npm run test:db` and diff the failure set against baseline | confirm no regression/fix silently changed the set |

**Note on which number is current:** the eras disagree (`740/741`, `766/772`, `769/772`, `343/349`, `350/350`, `4/5`).
The final auditor must report the *observed* totals and the *observed* failure set on the pushed tree, not any of these.

### 8.2 Test-integrity rules to apply

- Run `test:unit`, `test:db`, and E2E serial; record exact counts.
- Every failure: (a) the exact test id, (b) the exact reproduction command, (c) a classification
  (test-defect | environment | product), (d) production impact. No failure may be dismissed as "flake" without evidence
  (a flake must be shown to pass on re-run with **zero** state change, and to fail identically on the baseline tree).
- A test's claimed "FIXED" status is not evidence; the assertion must be executed.
- Deleting/weakening an assertion to make a suite green is itself a finding.
- Confirm the shared-database rule: `test:db` and E2E must not share a database (30.2 §12.1).

---

## 9. Known deferrals — must NOT be re-opened as defects

Each is a deliberate, named deferral (`final-parallel-baseline.md` §5; `final-design-landing-report.md` §9;
`design-integration-gap-report.md` §3). The final auditor may *observe* them; they must not be logged as defects, and any
claim that they are "fixed" must be checked against reality.

| ID | Deferral | Why it is not a defect | Falsify (of the deferral status, i.e. only if a claim changes) |
|---|---|---|---|
| DEF-01 | Surfacing scheduled posts on `/schedule` (P2-2) | A feature (adds a surface), one consumer of `/api/schedule-occurrences` today (`today.tsx`); filed as its own task | Someone claims it shipped while the grep still shows one consumer |
| DEF-02 | `--primary-text` role token (P2-1) | `--primary` is unsafe as text (3.04:1 dark / 3.68:1 light); the one confirmed failing site fixed via `--info`; axe passes | axe fails on a `text-primary` link |
| DEF-03 | `/sources` third-band consolidation (P2-3) | A navigation change needing dependency proof | Claimed collapsed while the band remains |
| DEF-04 | 45 sub-12px classes (P3-1) | All now render at 12px via the floor (188→45) | Sub-12px text renders below the floor (reconcile the observed count, ~45–46) |
| DEF-05 | 11 `transition-all` (P3-3) | Cosmetic; 35 raw `<button>`s still lack `.pressable` | A `transition-all` on a layout-affecting property causes visible jank |
| DEF-06 | Dead code (`navigation-menu.tsx`, unreachable `vault.tsx`) | No live impact (0 importers) | It becomes reachable |
| DEF-07 | Polling cadence (P2-5) | Alters perceived freshness; needs its own decision | Changed silently without a decision |
| DEF-08 | Auth-gate waterfall (P2-6) | Needs a loading-order redesign | Changed silently |
| DEF-09 | Font self-hosting (P3-6) | Build-config change with a caching implication | Claimed self-hosted while the stylesheet remains |

---

## 10. Summary of what this document is (and is not)

- **Is:** a complete, executable checklist the final auditor runs against pushed `main`, with every prior conclusion turned
  into a command, an expected result, and a falsifier.
- **Is not:** an audit, a severity, a GO/NO-GO, or a fix. No cell above is a conclusion.
- **Open items the final auditor must resolve that this preparation could not:** the missing `QA-02` / `UX-F03` /
  `A11Y-*` / `DES-*` / `DLQ-01` / `PERF-01` / `ENG-01` identifiers (§1.4); the untracked status of
  `docs/final-parallel-baseline.md`; the divergent test totals across eras; and the observed (not assumed) count of
  sub-12px classes and palette literals.

**NOT FINAL AUDIT — preparation only. This document contains no verdict.**
