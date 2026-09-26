# Phase Fix — `/today` duplicate publication & `/create` heading skip

**Branch:** `phase-fix-today-create` (cut from `main` @ `4320f47`)
**Scope:** two targeted defects. No server changes. No redesign. All test-ids, the seven
canonical destinations, and legacy redirects are unchanged.

**Files changed (owned):**
- `client/src/pages/today.tsx`
- `client/src/components/create/create-studio.tsx`

**Files added:**
- `e2e/phase-fix-today-create.e2e.spec.ts` (browser regression proof)
- `docs/phase-fix-today-create-report.md` (this report)

---

## Defect 1 — MEDIUM / truthfulness: `/today` double-listed one publication

### Mechanism (confirmed by reading the code, then reproduced in a browser)
1. When the server cannot confirm an external publish, it parks the publication as
   `state: "failed"` **and** a `Result` with `outcome: "unknown"` —
   `server/content/publication.ts:190-208` (`updatePublication({ state: "failed", ... })`
   then `insertResult({ outcome: "unknown", errorClass: "unknown", ... })`).
2. The `?state=` filter is a filter on **state only** — it never looks at the joined Result
   outcome: `server/content/storage.ts:1617-1632` (`listPublicationsByOwner`, line 1623
   `if (options.state) conditions.push(eq(publications.state, options.state))`). The route
   passes it straight through at `server/content/routes.ts:1189-1197`.
3. `client/src/pages/today.tsx` therefore built the failure list from
   `/api/publications?state=failed&limit=50` **without excluding rows whose outcome is
   `unknown`**, while separately collecting unknown outcomes from
   `/api/publications?limit=30`. The same publication produced a `failed-<id>` item **and**
   an `unknown-<id>` item, rendered as `card-attention-failed-3` +
   `card-attention-unknown-3`.

### Fix
Partition the two lists by publication id so every publication lands in exactly one bucket
(`client/src/pages/today.tsx:98-117`). Unknown-outcome rows are collected from **both**
reads (union by id) and their ids are removed from the failure list. This is the same
partition pattern already used for setup gaps via `isSetupRequiredPublication`, and it
keeps both states truthful:
- a row that is unknown still renders as unknown (never silently dropped — including an
  unknown row that only the wide `?state=failed&limit=50` read returned, past the `limit=30`
  window);
- a row that is unknown is never also rendered as a failure.

`isSetupRequiredPublication` and all card id/testid shapes (`setup-<id>`, `failed-<id>`,
`unknown-<id>`, `card-attention-<id>`) are unchanged; the shared helper module was not
edited.

### Before / after evidence (real browser, Chromium, mocked reads)
Test: `e2e/phase-fix-today-create.e2e.spec.ts` — mocks `/api/publications?limit=30` **and**
`/api/publications?state=failed&limit=50` to both return ONE publication
`{ id: 3, state: "failed", providerCalled: true, result: { outcome: "unknown", ... } }`,
loads `/today`, and asserts the publication renders exactly once, as the unknown outcome.

| | Before (fix stashed) | After (fix applied) |
|---|---|---|
| `card-attention-failed-3` | **rendered (count = 1)** | count = 0 |
| `card-attention-unknown-3` | rendered, "Publication needs verification" | rendered, "Publication needs verification" |
| total `[data-testid^="card-attention-"]` | **2** | **1** |
| spec result | ✘ `expect(getByTestId('card-attention-failed-3')).toHaveCount(0)` — Received: 1 (`24 × locator resolved to 1 element`) | ✓ passed (583 ms) |

The before run also proves both canonical reads were exercised (`state=failed` and
`limit=30` request URLs were both observed).

---

## Defect 2 — LOW: skipped heading level on `/create`

### Mechanism
`/create` renders the page `<h1>` from `PageHeader` (`ui-shared/page-header.tsx:37`). Inside
`CreateStudio`, the "Content Setup" section used `<h3>` (`create-studio.tsx:432`) — an
`h1 → h3` skip with no intervening `h2`. Dumping the real outline before the fix:
`[h1 "Create", h3 "Content Setup", h4 "Generation Summary"]`.

### Fix
Correct the heading level for each heading's position so the outline is contiguous:
- `create-studio.tsx:432` — `Content Setup`: `h3 → h2` (it is the first top-level section of
  the studio, directly under the page `h1`).
- `create-studio.tsx:636` — `Generation Summary`: `h4 → h3`.

Note on the second change: promoting only line 432 to `h2` would leave the outline as
`h1 → h2 → h4`, i.e. it would merely move the skip from `h1→h3` to `h2→h4`. The `h4` is a
direct sibling of the Content Setup block in the same studio flow and its sub-label styling
(`text-xs uppercase`) is a subsection, so demoting it to `h3` yields the minimal-change,
canonical `h1 → h2 → h3` outline. No heading was deleted; no shared `ui/` primitive was
touched (the call site was fixed; `PageHeader`'s `h1` is correct).

### Before / after evidence
Outline dumped from the live DOM (`console.log("CREATE_HEADING_OUTLINE", ...)` in the spec):

| | Before | After |
|---|---|---|
| outline | `h1 "Create" → h3 "Content Setup" → h4 "Generation Summary"` | `h1 "Create" → h2 "Content Setup" → h3 "Generation Summary"` |
| spec result | ✘ `heading level skip from h1 to h3 ("Content Setup")` | ✓ passed (685 ms) — no level jump > 1 anywhere |

---

## Verification performed

Environment: `E2E_PORT=4212`,
`DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e` (isolated Postgres, 68 public
tables, migrated), `SESSION_SECRET` set (production boot is fail-closed since Phase 30).
`npm run build` run before each test invocation (production bundle served by `npm start`).

1. `npm run check` — clean.
2. `npm run build` — clean (client + server).
3. New browser regression spec — **3 passed** (`e2e/phase-fix-today-create.e2e.spec.ts`):
   the duplicate proof (before: 2 cards / after: 1 card, as unknown), and the no-skip outline
   proof.
4. Existing specs that touch these surfaces — **26 passed**:
   - `e2e/today-schedule.e2e.spec.ts`
   - `e2e/phase-33.2-ia-ux-accessibility.e2e.spec.ts` (incl. "Today distinguishes server-recorded
     setup gaps from real failures and unknown outcomes": `setup-1` + `failed-2` + `unknown-3`
     still render; the previously-unasserted stray `failed-3` is now gone)
   - `e2e/create-workflow.e2e.spec.ts` (incl. Journey I: 0 Axe violations on Studio/Review)

## Unverified / caveats
- The heading fix chooses `Generation Summary` = `h3` (subsection) rather than a peer `h2`.
  Both give a skip-free outline; `h3` was chosen for minimal change and because the card is a
  labeled summary of the setup. If a reviewer prefers the two studio sections as peers, change
  line 636 to `h2` — still no skip.
- Only the two owned source files were edited; no shared `ui/` primitive required a change, so
  no cross-file patch is outstanding. The server was not modified.
- No changes to the seven canonical destinations or legacy redirects (asserted unchanged by the
  passing `phase-33.2` redirect/canonical tests).
