# ContentForge roadmap

**Reconciled:** 2026-11-11, branch `feat/auth0-migration`.

Locked context: the canonical lifecycle and the hard constraints in
[`../CURRENT_ARCHITECTURE.md`](../CURRENT_ARCHITECTURE.md), Jev as the single
decision layer ([`../JEV_DECISION_MAP.md`](../JEV_DECISION_MAP.md)), and the
verification state in [`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md).

Out of scope for this roadmap: Video Factory implementation (separate
repository), Mission Control, billing. X and Threads are channels, not the
centre of the product.

Priority meanings:

- **P0** — data integrity, security, broken execution, or a missing gate that
  makes every other claim unverifiable.
- **P1** — core product foundations and incomplete vertical slices.
- **P2** — important capabilities that build on a working foundation.
- **P3** — advanced functionality and optimisation.

## What changed since the previous roadmap

- The previous roadmap's phase A ("run the DB and live suites, promote matrix
  rows") is **partly done**: both Node suites now run hermetically and are green.
  See the verification table in [`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md).
- Two defects that the old capability matrix carried forward are **no longer
  true** and were removed: `selectForResearch` no longer discards `watch`
  candidates (one registry policy now), and `composeOpportunityScore` is no
  longer dead (it backs the `opportunity_score` decision).
- Quality, expertise and reach are no longer "nonexistent" modules: they exist
  under `server/intelligence/` and are flag-gated.
- The MCP server is still missing, and the public agent pages still promise it.

## Ordered backlog

| ID | Priority | Slice | Why now | Depends on |
|---|---|---|---|---|
| **P0-1** | P0 | Run `test:unit` and `test:db` in CI | 1,069 unit tests and 388 DB tests exist and are never executed by any workflow. The only automated gate is Playwright. | — |
| **P0-2** | P0 | Repair `drizzle-kit generate` (debt D8) | Migrations are hand-written because a snapshot-id collision breaks generation. Every schema change is unguarded by the diff tool. | — |
| **P1-1** | P1 | Turn on the verified decision boundaries | `opportunity_score`, `content_strategy` and `quality_gate` are implemented and tested but off. Turning them on is a policy decision plus a smoke run, not new code. | P0-1 |
| **P1-2** | P1 | Golden set for the three legacy cut-overs | JC-01/02/03 run in shadow. Cut-over is blocked on labelled data, not code. | a human labelling decision |
| **P1-3** | P1 | MCP server over the existing 29 tools | The public site says it is planned; the tool registry already exists. Owner-scoped, same approval gate. | P0-1 |
| **P2-1** | P2 | Opportunity Radar: demand, novelty, competition, interest | Highest-value gap in discovery. | P1-1 |
| **P2-2** | P2 | Second brain as a real subsystem; voice learning from accepted *and rejected* revisions | Personalization is count-only today. | — |
| **P2-3** | P2 | One-click campaign: story → reviewed, batch-scheduled package | Repurposing differentiator. | P2-1 |
| **P2-4** | P2 | Competitor intelligence provider and content-gap view | New research surface. | P2-1 |
| **P3-1** | P3 | Visual: quote cards, infographics, asset library, quality checks | — | P2-3 |
| **P3-2** | P3 | More channels: Facebook, then newsletter/blog adapters | Uses the existing adapter port. | P0-1 |
| **P3-3** | P3 | Performance memory: per-topic/per-hook aggregation, predicted vs actual | Making the loop actually learn. | — |
| **P3-4** | P3 | Autonomous editorial calendar proposing a weekly plan for approval | Needs the loop above to be trustworthy. | P3-3 |

---

## P0-1 — The test suites must actually run in CI

**Objective.** Every automated suite that exists runs on every push, and a red
suite blocks a merge.

**Existing implementation context.** `.github/workflows/e2e.yml` runs
`npm run check`, `npm run build` and `npx playwright test`. It never runs
`npm run test:unit` or `npm run test:db`; neither appears in any workflow. The
suites are hermetic as of this pass (`server/testing/hermeticEnv.ts`), so they are
now safe to run on a clean runner.

**Relevant files.** `.github/workflows/e2e.yml`, `package.json`,
`server/testing/hermeticEnv.ts`, `script/test-db-guard.ts`.

**Dependencies.** None.

**Acceptance criteria.**
1. A workflow job migrates an ephemeral Postgres and runs `npm run test:unit`.
2. A second job (or a later step) runs `npm run test:db` against the same service.
3. Both jobs are green on the merge commit.
4. A deliberately broken test fails the job — verified once, then reverted.

**Test requirements.** This *is* the test gate; acceptance is the CI run itself.

**Definition of done.** The workflow run is linked from `docs/HANDOVER.md`, and
branch protection requires the new checks.

## P0-2 — Repair migration generation (debt D8)

**Objective.** `npm run db:generate` produces a correct migration again, so schema
changes are generated and reviewed instead of hand-written.

**Existing implementation context.** `migrations/meta/` holds duplicate snapshot
ids (`0016`–`0019` share one id) while `_journal.json` runs ahead of the snapshot
list. `db:migrate` applies cleanly — that half is healthy — but generation cannot
be trusted, which is why every migration since has been written by hand.

**Relevant files.** `drizzle.config.ts`, `migrations/meta/_journal.json`,
`migrations/meta/*_snapshot.json`, `shared/schema.ts`,
`script/` migration verification helpers, `.github/workflows/migration-guard.yml`.

**Dependencies.** None, but it must be done in isolation from feature work.

**Acceptance criteria.**
1. `npm run db:generate` on an unchanged schema produces an empty diff.
2. A trivial schema addition generates exactly one new migration.
3. `npm run db:migrate` on a fresh database still applies every migration in
   order, including the generated one.
4. `migration-guard.yml` passes.

**Test requirements.** A DB test asserting the applied migration count equals the
journal length (one already exists — keep it), plus a manual generate/apply cycle
on a scratch database.

**Definition of done.** The D8 note is removed from
`CURRENT_ARCHITECTURE.md` §7 and `docs/HANDOVER.md`.

## P1-3 — MCP server over the existing tools

**Objective.** Outside assistants can call ContentForge's domain tools under the
same ownership, approval and rate-limit rules as the in-app agent.

**Existing implementation context.** 29 domain tools are registered in
`server/agent/tools.ts` behind `server/agent/*`; an MCP **client** already exists
in `agent/external.ts` for calling out. The public agent pages describe the
connector as planned, and its URL is currently a placeholder.

**Relevant files.** `server/agent/tools.ts`, `server/agent/routes.ts`,
`server/agent/external.ts`, `server/middleware/*`, `site/agent.ts` (copy to
update when it ships).

**Dependencies.** P0-1 (so the new surface is covered by the same gate).

**Acceptance criteria.**
1. Tools are exposed over MCP with OAuth or an owner-scoped token; no anonymous
   tool calls.
2. Publish-shaped tools still require an approved Artifact; the gate is not
   re-implemented, it is reused.
3. Rate limits apply per owner.
4. Every tool call is attributable in the audit log.

**Test requirements.** Protocol-level test for auth rejection, one tool round
trip, and an assertion that an unapproved Artifact cannot be published through
MCP while every Jev flag is on.

**Definition of done.** The placeholder URL and "planned" copy are replaced with
the real endpoint documentation.
