# HANDOVER — ContentForge

**Written:** 2026-11-11. **Branch:** `feat/auth0-migration`. **Head:** see
`git log -1` — this document is updated by the same commit that carries these
words, so the hash is in the log, not here.
**Supersedes:** the 2026-10-04 handover (written against `main @ 67985c3`).

Read this file, then follow §1. If you read only one more thing, read **§9 —
the exact next task**.

---

## 0. Onboarding sequence for the next agent

Do these in order. Each step is cheap and the whole sequence is under ten minutes.

```bash
make orient                 # repo map (graft) + the doc index, one call
cat docs/README.md          # which doc is CURRENT and which is HISTORICAL
```

1. **This file** — state, debt, next task.
2. [`../CURRENT_ARCHITECTURE.md`](../CURRENT_ARCHITECTURE.md) — how it is built,
   "as built, not as documented". Note its §3/§9 are historical.
3. [`../JEV_DECISION_MAP.md`](../JEV_DECISION_MAP.md) — the decision layer.
4. [`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md) — what exists, with evidence.
5. [`ROADMAP.md`](ROADMAP.md) — ordered backlog and the top tickets.
6. `docs/architecture/` — the diagrams (specs are committed; HTML is generated).

**Use the graph before grepping.** `graft ask "<question>" --source`,
`graft skeleton <file>`, `graft callers <symbol>`. Filenames here are ambiguous
(14 `index.ts`, 13 `routes.ts`, 6 `storage.ts`): always use repo-relative paths.

---

## 1. What ContentForge is

ContentForge is a **single-operator, AI-native content intelligence and growth
system**. It finds research, turns it into evidence-backed stories, produces
content through a gated pipeline, publishes it to real platforms, and measures
what happened. It is domain-agnostic: the vertical is configuration, not
identity. X and Threads are output channels, not the conceptual centre.

The intended operating cycle:

```
Discover → Research → Understand → Identify opportunities → Create
        → Repurpose → Approve → Distribute → Measure → Learn
```

Three rules shape every part of it:

- **Truthful status vocabulary.** Never write implemented / verified / published
  / healthy unless the behaviour was observed. Use IMPLEMENTED / PARTIALLY
  IMPLEMENTED / VERIFIED LIVE / NOT VERIFIED / DEFERRED / BLOCKED.
- **Intelligence ≠ decision ≠ execution.** Signals are produced
  deterministically; Jev turns signals into a typed, versioned, logged decision;
  execution re-runs its own hard validators and is never authorised by Jev.
- **Approval is a human gate.** Publishing is never an uncontrolled side effect.

## 2. What was changed by the Craft Anything run, and what was recovered

One Craft Anything run (2026-11-04 → 11) worked in this checkout and left a large
working directory at the repository root. This pass separated the product
deliverable from the workspace noise.

> **The Craft Anything process overlapped this pass, then exited.** It committed
> and pushed `d2331a1` at 15:40 IST, kept editing `site/*.ts` and rebuilding
> `dist/`, and stopped at ~16:20 IST. Its final iteration was verified and
> committed as `05d70e2`.
>
> Consequence for anyone reading history: `d2331a1` is a mid-run checkpoint, not
> the finished site. `05d70e2` is the last word, and it still reports **47%
> visual match against a 90% target** — the marketing pages are improved but
> explicitly unfinished. The gap is mostly imagery (the reference uses
> illustrations and product screenshots; these are CSS mockups), brand wording,
> and the DM font.
>
> Its commit also added a root `HANDOVER.md` and `server/site.test.ts`. That root
> handover defers capability status to `docs/CAPABILITY_MATRIX.md` and
> `docs/ROADMAP.md`, so there is no competing source of truth — but note that two
> files named HANDOVER exist, and the `docs/` one is authoritative.

**Before running E2E or committing the site**, check for a live writer:

```bash
pgrep -fl "craft-anything|claude -p --output-format stream-json" || echo "quiet"
```

**Recovered and committed (product code):**

| Change | Files |
|---|---|
| Public marketing site, served by the app and emitted as static files | `site/{render,home,agent,layout,icons,styles,script}.ts`, `server/site.ts`, `script/build.ts`, `tsconfig.json`, `server/index.ts` |
| Site layout/content second pass (47% visual match, target 90%) | `site/{agent,home,icons,layout,styles}.ts`, root `HANDOVER.md` |
| Test hermeticity (`server/testing/hermeticEnv.ts`) + script wiring | `package.json`, `server/testing/hermeticEnv.ts` |

**Recovered and committed (documentation):**

- `docs/CAPABILITY_MATRIX.md` and `docs/ROADMAP.md` — rebuilt from the run's
  `CONTENTFORGE_*.md`, with the stale claims corrected against the code (§7).
- `docs/archive/ux-intelligence-2026-09/` — the run's UX discovery package
  (`Claude outputs/`), preserved as HISTORICAL evidence.
- This handover, `docs/README.md`, `docs/STATUS.md` index updates.

**Deliberately not committed, preserved on disk and gitignored** (see the
"Craft Anything" block in `.gitignore`):

- `src/` — a **different product** ("Artha", a personal-finance site) with
  Next.js `app/` files and two `probe.ts` stubs. Nothing imports it.
- `site/postiz-*.ts` (5 files) — an earlier, flatter variant of the marketing
  site that is no longer mounted. The status note in the craft run already said
  it can be deleted; it was left on disk rather than destroyed.
- `checks/`, `capture/`, `investigation.cany/`, `craft.json`, `feed.json`,
  `agent-session.jsonl`, the ad-hoc `*.json` response dumps.
- **`local.txt` is a libcurl cookie jar containing a live `connect.sid`.** It is
  gitignored specifically so it cannot be committed.
- `.agents/`, `.audit/`, `.commandcode/`, and the other agent dot-directories —
  machine-local tooling, not version-controlled project tooling.

## 3. The canonical lifecycle, and where it actually stops

```
Provider/Agent Reach → ResearchJob → Evidence/Story → Opportunity
  → GenerationPolicy → GenerationJob → Immutable Artifact → Approval
  → Schedule/Occurrence → Publication → Result → performance_signals
```

| Stage | State | Where it is enforced |
|---|---|---|
| Research fan-out, dedupe, window, evidence, validation | IMPLEMENTED | `server/research/engine.ts` |
| Story from a completed ResearchJob | IMPLEMENTED | `story/service.ts` |
| Opportunity (format × channel validated) | IMPLEMENTED | `content/opportunity.ts` |
| Generation policy → job → **copy only** | IMPLEMENTED | `content/generation.ts` |
| Immutable artifact revisions | IMPLEMENTED | `content/artifact.ts`, DB trigger |
| Approval `draft → in_review → approved/rejected` | IMPLEMENTED, human | `content/artifact.ts` |
| Schedule → occurrence → publication, leases | IMPLEMENTED | `content/scheduling.ts`, `publication.ts` |
| Channel adapters (X, Threads, Instagram, LinkedIn, YouTube) | IMPLEMENTED | `content/adapters.ts` |
| Results → performance signals → observations/proposals | IMPLEMENTED | `learning/*` |
| Per-topic / per-hook learning; predicted vs actual | **ABSENT** | — |

**Where the loop breaks today:** nothing is disconnected, but the last mile is
thin. The feedback reaches generation only as bounded counts; per-topic and
per-hook aggregation do not exist, and `viral_scores.predicted_engagement` is
never joined to `performance_signals.actual`. The lifecycle *runs*; it does not
yet *learn* at the granularity the vision asks for.

**Proof the slice runs:** `server/research/verticalSlice.dbtest.ts` drives
research → story → opportunity against the real schema; `server/content/
visualPublication.dbtest.ts` drives artifact → approval → schedule →
publication → result against a **local fixture** channel, including duplicate
delivery. Neither makes a real external post. A real post has **not** been made
from this pass and should not be without explicit authorisation.

## 4. Jev — the centralised decision layer

Jev is one engine (`server/decision/`), not a set of scattered heuristics:

- `decide({ type, state, refs })` → `DecisionResult { decision, confidence,
  reasons, signals, policyId, policyVersion, fallback }`.
- Ten registered decision types. **Seven sit at lifecycle boundaries**:
  `research_triage`, `research_depth`, `opportunity_score`, `content_strategy`,
  `quality_gate`, `publish_gate`, `format_select`. **Three run in shadow** over
  legacy paths: `viral_score`, `discover_rank`, `agent_route`.
- Every decision is attributable (policy id + version), hashed for
  reproducibility (`input_state_hash`), and written to the `jev_decisions`
  ledger. Three ports initially recorded `user_id NULL`; all pass the owner now.
- Fallback classes are declared per decision, never ad hoc. Publishing-class
  decisions fail **closed**; research and framing fail **open**.
- Hard constraints are code-owned and re-checked by the caller. Jev can never
  schedule or publish an unapproved artifact — an assertion test covers this
  with every Jev flag on.

**Current state:** the decision layer is built and tested. Which boundaries are
*enabled* is deployment configuration, not code state. Read
`JEV_DECISION_MAP.md` §"As-built status" for the authoritative table; do not
infer enablement from the code.

**Gap:** the three legacy shadows cannot be cut over because no labelled golden
set exists to measure agreement against. That is a "who produces the labels"
decision, not a coding gap.

## 5. What was verified in this pass (2026-11-11)

Everything below was executed on this machine against the ephemeral
`docker-compose.e2e.yml` Postgres. Commands are reproducible from a clean clone.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, no diagnostics |
| `npm run test:unit` | **1072 passed, 0 failed, 0 skipped** (includes `server/site.test.ts`) |
| `npm run test:db` | **388 passed, 0 failed** on a freshly created database |
| `npm run build` | exit 0; `dist/index.cjs` 4.3 MB; marketing pages + `_site/` emitted to `dist/` |
| Marketing site, production bundle | `/`, `/chatgpt`, `/dots`, `/claude`, `/claude-cowork`, `/_site/site.css` → 200; `/api/health` → 200 JSON; `/today` falls through to the SPA |
| `npx playwright test` | **276 passed, 2 skipped, 0 failed, exit 0** (see §5.1) |
| Real external publish | **not performed and not authorised** |

### 5.1 Playwright

The suite needs `npx playwright install chromium` on a fresh machine; without it
every browser spec fails at launch with `Executable doesn't exist`, which reads
like a product failure and is not one.

Recorded result on a quiet tree, after the two spec defects below were fixed:

- **276 passed, 2 skipped, 0 failed, exit 0** (3.2 min, `CI=true` so retries were
  available; none were needed).
- The first full run, before the spec fixes, was 270 passed / 2 skipped /
  7 failed. Six of those seven were load flake (they passed serially and on
  retry); the seventh was a real expired-date defect.

### 5.1b One caveat on `test:db`

On a **reused** database the full DB suite can report two failures in the
queue-timing suites — `content/autonomy/scheduler.dbtest.ts` ("10 simultaneous
same-owner same-scope triggers…") and `jobs/researchRuntime.dbtest.ts` ("retries a
transient research failure…"). Both pass in isolation (29/29) and the whole suite
is green on a freshly created database. The cause is accumulated pg-boss state
from earlier runs, not the code. A CI service container is fresh on every run, so
P0-1 will not see it; when running locally, recreate the database first.

### 5.2 Defects found and fixed in this pass

1. **Tests could publish to the real X provider.** The shell (or an agent
   harness that exported `.env`) hands the suite live `XQUIK_*` / `X_*`
   credentials, so `adapters.test.ts` believed X was configured and hit the live
   API — it received "X refused this exact text in the last 24 hours", meaning a
   real write was attempted. Fixed with `server/testing/hermeticEnv.ts`, loaded
   before any test module, which strips distribution credentials, model keys,
   research-provider keys and Jev flags. This is now an invariant: **a test
   process cannot reach a provider, spend money, or inherit a production flag.**
2. **The DB suite could not run on a clean environment.** It needs only a
   placeholder AI key to construct routers; `test:db` did not set
   `CONTENTFORGE_E2E_SERVER=1`, so it threw at import. Aligned with `test:unit`.
3. **An expired fixture.** `research/engine.dbtest.ts` pinned sources to
   2026-09-01, which silently fell outside a `last_30d` window once the date
   moved on. Fixtures are now relative (`daysAgo()`). If you add a dated fixture,
   make it relative.
4. **Two idempotency tests raced a window boundary.** `alignToSingletonWindow`
   waited for the first *half* of the pg-boss singleton bucket; under a loaded
   full-suite run the two enqueues could straddle the boundary. It now waits for
   the first quarter.
5. **A duplicate-delivery assertion over-specified the contract.** A delivery
   that arrives after the first finished returns `status:"published", reused:true`
   — an idempotent replay, not a second publish. The test counted it as one. It
   now counts actual publishes (`reused === false`) and still asserts exactly one
   `Result` row, which is the invariant that matters.
6. **The no-auth spec encoded the old landing behaviour.** It asserted that an
   anonymous visitor to `/` sees the sign-in form. `/` is now a public marketing
   page by design, so the spec asserts the public site at `/` and the auth gate
   at an app route (`/today`).
7. **A scheduling spec used an expired date.** It filled `2026-10-15`, which
   `SchedulePicker` correctly rejects because it is in the past, leaving the
   confirm button disabled. The date is now computed relative to today.
8. **The unit suite was order-dependent.** The Threads HTTP tests read the global
   `connected_accounts` store. A row written by an earlier E2E run against the
   same database — encrypted with that run's key — made three tests fail with
   "Failed to decrypt stored accessToken". `test:db` already ran a preflight
   purge; `test:unit` did not. Both now run `script/test-db-guard.ts` first, so
   the suite result no longer depends on what ran before it.

## 6. Integrations: working vs incomplete

**Working:** auth (password, Google, Auth0 Universal Login and bearer tokens),
owner scoping + CSRF, research providers, generation and immutable artifacts,
approval, scheduling with durable occurrences, publication adapters with
single-flight leases and reconcile, results → performance signals → observations
and proposals, experiments and human-gated policy activation, autonomy
controller, 29 agent tools, public marketing site.

**Incomplete:** MCP server (client only — the public site promises it), Agent
Reach (inert record; never dispatched), per-topic/per-hook learning, predicted
vs actual, one-click campaign, competitor intelligence, Facebook/newsletter/blog
adapters, multiple brands (deferred), quote cards/infographics/asset library.

## 7. Documentation drift corrected in this pass

The Craft Anything docs were written from a six-week-old audit, so three claims
were already false. They were corrected in `docs/CAPABILITY_MATRIX.md`:

| Stale claim | Reality |
|---|---|
| "`composeOpportunityScore` has no production caller" | It backs the `opportunity_score` decision via `content/opportunityScoring.ts` → `decision/decisions/opportunity.ts`. It is flag-gated, not dead. |
| "`selectForResearch` is all-or-nothing" | That duplicate policy was removed. There is one keep-set policy in the registry, env-tunable via `JEV_TRIAGE_KEEP` (default `pursue+watch`), and every triage is ledgered. |
| "Content quality / personal expertise do not exist as modules" | `server/intelligence/{quality,expertise,reach}/` exist and are wired into decisions. |

Also fixed: `JEV_DECISION_MAP.md` said "seven decision types" above a table of
ten (it is ten — seven boundaries, three shadows).

## 8. Technical debt and known blockers

| ID | Debt | Impact |
|---|---|---|
| D8 | `drizzle-kit generate` is broken by a snapshot-id collision; migrations are hand-written | Every schema change is unguarded by the diff tool. **P0-2.** |
| — | `test:unit` and `test:db` are not in any CI workflow | 1,457 tests exist and gate nothing. **P0-1.** |
| — | Legacy decision surface is split between the canonical chain and the monolith | Jev covers both, but only 3 legacy paths are shadowed. |
| — | Feedback is bounded counts only | No per-topic/per-hook learning. |
| — | Agent Reach is an inert record | Either build the ingest seam or close it; do not leave it advertised. |
| — | `site/postiz-*.ts` is dead code on disk | Never mounted; delete when convenient. |

## 9. The exact next task

**P0-1: make the existing test suites run in CI.**

Why this and nothing else: 1,069 unit tests and 388 DB tests pass locally and are
executed by no workflow. Every claim in this repository about correctness rests
on tests that a merge cannot fail. The suites are hermetic as of this pass, so
this is now a small, low-risk workflow change.

Concretely:

1. In `.github/workflows/e2e.yml`, add a job that starts the Postgres service,
   runs `npm run db:migrate`, then `npm run test:unit` and `npm run test:db`
   against that service URL.
2. Confirm the run is green on the commit that lands it.
3. Break one assertion deliberately, confirm the job goes red, revert.
4. Link the successful run in this file and in `docs/CAPABILITY_MATRIX.md`.

Do **not** start P0-2 (migration generation) in the same change — it must be
isolated from feature work.

## 10. Running things

```bash
# Local stack (needs .env — gitignored)
make up                       # http://localhost:3000
make db                       # just Postgres on 5432

# Verification without CI
docker compose -f docker-compose.e2e.yml up -d --wait
export DATABASE_URL=postgresql://e2e:e2e@127.0.0.1:5433/contentforge_e2e
export TEST_DATABASE_URL=$DATABASE_URL
npm run db:migrate
npm run test:unit
npm run test:db
npm run build
npx playwright install chromium   # once per machine
npx playwright test

# Live harness (durable state, local fixture channel, no real posts)
make e2e-live
```

### Environment traps (each one has cost real time)

- **Your shell may already export production credentials.** This is what made
  the suite publish to X. `test:unit` / `test:db` now strip them, but if you run
  `node --test` directly, you bypass that. Use the npm scripts.
- **`test:unit` and `test:db` both purge `connected_accounts` on a local/test
  database.** That is what makes them repeatable, but it means you must never
  point them at a database whose channel connections you want to keep. The guard
  refuses to purge a database that is neither local nor named like a test one.
- **`.env` points at a Neon pooler**, not the compose database. Pool-dependent
  tests misbehave there; set `TEST_DATABASE_URL` to a direct connection.
- **One app process runs web + workers + schedulers.** Never add a second worker
  container — it would double-run schedulers and queue consumers.
- **Deployment is from `main`**, every port bound to `127.0.0.1`, Cloudflare
  Tunnel is the only ingress. No Railway.
- **Paid media** is gated by `CONTENTFORGE_ALLOW_PAID_MEDIA` and deliberately
  off on the VPS.

## 11. Git state

At the start of this pass the branch was level with its upstream (`0 0` against
`origin/feat/auth0-migration`) and the risk was entirely in 1,825 untracked
files. Those were classified (§2), the product deliverable was committed, and the
rest was gitignored rather than deleted, so nothing on disk was lost.

**`d2331a1` was authored and pushed by the Craft Anything process, not by this
pass.** It carries `site/`, `server/site.ts`, the build wiring, `server/site.test.ts`
and a root `HANDOVER.md`. Its later, final site iteration is `05d70e2` (committed
here after that process exited). This pass commits on top of that — test
hermeticity, test fixes, and the documentation reconciliation — and does not
rewrite any of it.

There is one stash, `stash@{0}: On phase-33.7-discovery-ownership: phase-33.7
wip`, which predates this pass and was **not** touched. Inspect it before
dropping it.
