# Phase 33.2 — IA / High-Value UX / Accessibility — Independent Verification

**Worker:** 33.2 verifier (read-only against `main`).
**Verified revision:** `bcf1470` (main; worktree branch `phase-33.2-ia-ux-a11y` is at the same commit).
**Environment:** production bundle built from source in the worktree, served by `dist/index.cjs` on `E2E_PORT=4201`, `DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e`.
**Date:** 2026-09-26

## Method

1. Read the phase-33.2 acceptance spec (`e2e/phase-33.2-ia-ux-accessibility.e2e.spec.ts`) and every file named in the brief.
2. Re-ran the in-repo phase-33.2 e2e spec on port 4201 → **10/10 passed** (setup + chromium).
3. Wrote an **independent** Playwright script (own auth, own route mocks) exercising all **7** canonical routes, all **18** legacy paths, all **8** Create modes, the **reject** flow on both surfaces, and a runtime channel-icon scan. Raw output captured to the session scratchpad.
4. Ran the three relevant unit suites (`legacy-route-mapping`, `today-schedule-state`, `channel-icon`) → **24/24 passed**.

The in-repo spec is treated as one input, not as proof: the two items where my independent run diverges from it are called out below.

---

## Verdict table

| # | Item | Verdict | Evidence | Severity | Fix |
|---|------|---------|----------|----------|-----|
| 1 | Visible Reject on both Artifact Review surfaces | **VERIFIED** | Source: `client/src/components/create/artifact-review-view.tsx:566-577` (`button-review-reject`, label "Reject", outline + `text-destructive`) and `client/src/components/agent/artifact-review.tsx:315-327` (same). Both gate on `in_review` and open `ConfirmDialog` (`:700-709` / `:377-386`). Server: `server/content/artifact.ts:283-297` `rejectArtifact` enforces `in_review → rejected`. Browser: reject button visible, text `"Reject"`; confirm dialog title "Reject this revision?"; after confirm status badge = `"Rejected"`, `text-rejected-immutable` present, approve button count 0, `POST /reject` fired exactly once. Agent view identical. | — | — |
| 2 | Today setup gap vs failure vs unknown | **GAP** | Three states *are* distinguished (`client/src/lib/today-schedule-state.ts:98-113,119-205`; `client/src/pages/today.tsx:98-111,211-231`): `setup_required_publication`→"X setup required"/"Connect account", `failed_publication`→"Publication failed"/"View details", `unknown_publication`→"Publication needs verification"/"Check status", each carrying `data-attention-kind` and distinct wording (non-colour). **However**, an unknown-outcome publication is also listed as a hard failure. The server stores unknown-outcome rows with `state:"failed"` + `result.outcome:"unknown"` (`server/content/publication.ts:190-215, 284-311`), and the state filter is on the publication state only (`server/content/storage.ts:1621-1630`), so `?state=failed` returns them. `today.tsx:100` builds `publicationFailures` from that set without excluding unknown rows, while `:101` builds `unknownPublications` from the *same* rows. Browser repro: one publication produced **both** `card-attention-failed-3` ("Publication failed") and `card-attention-unknown-3` ("Publication needs verification"). | **MEDIUM** | `client/src/pages/today.tsx:98-101` — exclude unknown rows from the failure set, e.g. `const publicationFailures = failedPublications.filter((p) => !isSetupRequiredPublication(p) && p.result?.outcome !== "unknown");` (or dedupe `attentionItems` by publication id). Add a unit case asserting an unknown row yields exactly one item. |
| 3 | Exactly one top-level `<main>` per route | **VERIFIED** | Single shell landmark at `client/src/App.tsx:254` (`<main id="main-content" tabIndex={-1}>`). Browser, all seven routes: `totalMain=1`, `main#main-content=1`, other `<main>=0`, `[role=main]` duplicates=0, nested `<main>`=0. Per-route table below. | — | — |
| 4 | Channel icon accessible name or decorative | **VERIFIED** | Component `client/src/components/ui-shared/channel-icon.tsx`: decorative path sets `aria-hidden="true"` (`:70-81`); named path sets `role="img"` + `aria-label` (`:83-93`); inner glyph always `aria-hidden` (`:43`). All **14** call sites pass `decorative` with an adjacent visible channel label (see appendix) — e.g. `today.tsx:49`+`{platform}`, `settings.tsx:272`+`<h2>{label}</h2>`, `create-studio.tsx:447`+`{ch}`, `calendar.tsx:197-204`+`X`/`Threads`. Runtime scan over 7 routes: 0 unnamed/0 svg-unnamed channel icons (5 icons observed on `/create` and `/settings`; other routes render none without data). | — | — |
| 5 | Legacy → canonical consolidation | **VERIFIED** | `client/src/lib/legacy-route-mapping.ts:12-31` + `App.tsx:158-176`. Browser: all **18** mapped paths redirect to the correct canonical destination preserving `?bookmark=kept&filter=ready` **and** `#section-7`, none 404. Matrix below. Note: the file contains **18** entries, not the 20 stated in the brief — 18 is correct (`legacy-route-mapping.test.ts:11-30` deep-equals all 18). `/youtube` remains a live route by design (`App.tsx:172`). | — | — |
| 6 | Homeless legacy capability integration | **VERIFIED** | `client/src/pages/create.tsx:33-54` mounts each capability inside `/create`: `hooks, carousel, images, articles, templates, formatter, canned-responses, chat-post` (`:230-233`). Browser: all 8 modes render a distinct `create-mode-<mode>` container with the mode pill `aria-current="page"`; `/hooks`→`/create?mode=hooks` renders `text-hooks-title`, `/carousel`→`/create?mode=carousel` renders `text-carousel-title`. No capability left without a canonical home. | — | — |
| 7 | Discoverability on `/sources` for `/ideas`,`/vault`,`/references` | **VERIFIED** | `sources.tsx:29-70` maps each legacy view to `activeView="saved"` + the matching `savedFilter`; the primary band renders **Saved** active (`sources.tsx:126-142`) and the secondary band renders the specific pill active (`:167-219`). Browser: for all three views the primary row contains an active pill (`tab-sources-view-saved`) — no blank row. | — | — |
| 8 | Cross-cutting | **VERIFIED** (see note) | Seven canonical destinations intact (`App.tsx:148-155`). Current APIs reused, not changed: reject uses the pre-existing `/api/artifacts/:id/reject` (`routes.ts:961-983`); Today's `?state=failed` is pre-existing (`routes.ts:1188-1204`). Safety boundaries intact: reject is `in_review`-only and rejected revisions are unschedulable (`artifact.ts:283-297`). Legacy compatibility preserved (item 5). Shared components reused, not duplicated: `ConfirmDialog`, `ChannelIcon`, `StatusBadge`, `SchedulePicker`, `PublishPreview`, `ErrorState`/`EmptyState`. Caveat: the shared attention composer does not dedupe (item 2). | LOW | Fix item 2. |

---

## Per-route `<main>` landmark count (browser-measured)

| Route | `<main>` total | `main#main-content` | other `<main>` | nested `<main>` | `[role=main]` extras |
|---|---|---|---|---|---|
| `/today` | 1 | 1 | 0 | 0 | 0 |
| `/create` | 1 | 1 | 0 | 0 | 0 |
| `/sources` | 1 | 1 | 0 | 0 | 0 |
| `/agent` | 1 | 1 | 0 | 0 | 0 |
| `/schedule` | 1 | 1 | 0 | 0 | 0 |
| `/insights` | 1 | 1 | 0 | 0 | 0 |
| `/settings` | 1 | 1 | 0 | 0 | 0 |

All seven destinations carry exactly one top-level `<main>`; no route nests or duplicates the landmark.

---

## Legacy-redirect matrix (exercised in the browser)

Each row loaded as `<legacy>?bookmark=kept&filter=ready#section-7`.

| Legacy path | Canonical destination (observed) | `bookmark` | `filter` | hash | mapped selector param | 404? |
|---|---|---|---|---|---|---|
| `/generate` | `/create` | kept | ready | `#section-7` | — | no |
| `/queue` | `/schedule` | kept | ready | `#section-7` | `tab=queue` | no |
| `/calendar` | `/schedule` | kept | ready | `#section-7` | `tab=calendar` | no |
| `/analytics` | `/insights` | kept | ready | `#section-7` | `view=performance` | no |
| `/ai-usage` | `/insights` | kept | ready | `#section-7` | `view=ai-usage` | no |
| `/discover` | `/sources` | kept | ready | `#section-7` | `view=discover` | no |
| `/ingest` | `/sources` | kept | ready | `#section-7` | `view=ingest` | no |
| `/ideas` | `/sources` | kept | ready | `#section-7` | `view=ideas` | no |
| `/vault` | `/sources` | kept | ready | `#section-7` | `view=vault` | no |
| `/references` | `/sources` | kept | ready | `#section-7` | `view=references` | no |
| `/hooks` | `/create` | kept | ready | `#section-7` | `mode=hooks` | no |
| `/carousel` | `/create` | kept | ready | `#section-7` | `mode=carousel` | no |
| `/images` | `/create` | kept | ready | `#section-7` | `mode=images` | no |
| `/articles` | `/create` | kept | ready | `#section-7` | `mode=articles` | no |
| `/templates` | `/create` | kept | ready | `#section-7` | `mode=templates` | no |
| `/formatter` | `/create` | kept | ready | `#section-7` | `mode=formatter` | no |
| `/canned-responses` | `/create` | kept | ready | `#section-7` | `mode=canned-responses` | no |
| `/chat` | `/create` | kept | ready | `#section-7` | `mode=chat-post` | no |
| `/youtube` (live, unmapped) | `/youtube` | kept | — | — | — | no |

18/18 mapped paths redirect correctly with query + hash preserved; `/youtube` stays live as designed.

---

## Not verified / could not verify

- **A 20th legacy path.** The brief says 20 legacy paths live in `legacy-route-mapping.ts`; the file contains **18** (confirmed by grep and by the unit test's `deepEqual`). I verified all 18 plus the one live legacy route (`/youtube`). I could not find a 20-path list anywhere, so the "20" appears to be a miscount in the brief, not a missing implementation. Treated as a LOW-severity documentation discrepancy.
- **Channel icons on data-bearing surfaces I could not populate.** The runtime scan found icons only on `/create` (1) and `/settings` (4) because the fresh E2E account has no artifacts/accounts. The remaining call sites (`queue`, `calendar`, `generate`, `youtube`, `chat`, `today`) were confirmed by source inspection (every call site is `decorative` with adjacent visible text) but not all observed rendered with live data.
- **`role="img"` (named) branch of `ChannelIcon` in a real page.** No production call site uses the non-decorative form; it is covered only by `client/src/lib/channel-icon.test.ts`.
- **Axe run on all seven routes.** The in-repo axe check covers `/today`, `/sources`, `/agent`, `/create?mode=hooks`; I did not re-run axe on `/schedule`, `/insights`, `/settings`. The landmark question was instead answered directly by DOM measurement (table above).

---

## Appendix — command + artifacts

- Build: `npx tsx script/build.ts` (worktree, `DATABASE_URL=…:5433/…`).
- In-repo spec: `E2E_PORT=4201 npx playwright test e2e/phase-33.2-ia-ux-accessibility.e2e.spec.ts --project=setup --project=chromium` → 10 passed.
- Independent script + raw JSON: session scratchpad (`verify-332.mjs`, `verify-modes.mjs`, `verify-out.json`).
- Unit tests: `npx tsx --test client/src/lib/legacy-route-mapping.test.ts client/src/lib/today-schedule-state.test.ts client/src/lib/channel-icon.test.ts` → 24 passed.
- All 14 `ChannelIcon` call sites (all `decorative`): `youtube.tsx:46`, `chat.tsx:31`, `calendar.tsx:34,197,204`, `queue.tsx:35`, `today.tsx:49`, `generate.tsx:32`, `settings.tsx:272,448`, `create/artifact-review-view.tsx:375,483`, `create/create-studio.tsx:447`, `agent/artifact-review.tsx:241`.
