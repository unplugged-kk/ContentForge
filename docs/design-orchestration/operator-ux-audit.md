# Operator / Real-Data UX Audit — ContentForge

**Agent:** WORKTREE 8 — OPERATOR / REAL DATA UX (`design/wt-08`)
**Repo under audit:** `/Users/kishore/git/ContentForge` (read-only) · audited at `/Users/kishore/git/cf-design/wt-08`
**Register:** Product — authenticated, single-operator content OS (`.commandcode/design/brief.md:11-19`)
**Mode blend:** `surface` (hardening under real data/states) + `checkup` (urgency read) + `refine/proof`
**Date:** 2026-09-26
**Scope:** the app under real production load and real production failure — long/truncated strings, 500+ row datasets, partial results, retries/DLQ, indeterminate publication state, multi-account/channel identity, noisy activity feeds, empty states, disabled controls.

---

## Verdict

**BLOCK.** Three `HIGH` findings are standing, one of which is the exact class the brief calls its spine: *a read failure rendered as a clean state*. The product's trust model is otherwise unusually strong — the Today page still tells the operator a list "may be incomplete", unknown publications are separable from failed and from published, and the ActorBadge/announcer work from 33.2 holds. But the same honesty is missing on five other data regions, the only publication-history surface silently hides everything past row 30, and the "Attention" list is derived from a 20-row window.

Counts: **3 HIGH · 4 MEDIUM · 2 LOW**.

---

## The truthfulness spine, checked against the code

The brief's rule 5 — *"A read failure is not an empty state"* (`.commandcode/design/brief.md`, Truthfulness §5; UX-03 at `docs/full-product-ux-audit.md:105`) — is the organising principle of this report. The repository enforces it well in some places and not at all in others:

- **Holds:** Today's Attention and Schedule guard on `isError` and say the list "may be incomplete" (`pages/today.tsx:200`, branches at `:150-160` and `:190-200`). Queue (`pages/queue.tsx:518`) and Calendar (`pages/calendar.tsx:249`) both render `ErrorState` with retry. `ErrorState` is a real shared primitive (`components/ui-shared/error-state.tsx:22`, `role="alert"`).
- **Broken:** five data regions consume their query with only `isLoading` and no error branch (Finding 1). In one of them the failure is not merely blanked — it is replaced by copy that tells the operator to change their query.

Rule 3 (never fabricate a zero) and rule 4 (failure ≠ unknown, degraded ≠ clean) are honoured in the new primitive set: `status-badge.tsx` gives `failed`/`rejected`/`blocked` the destructive variant and `unknown` a neutral one, so `Unknown`, `Failed`, and `Published` are three visibly different badges — colour *and* word (Finding "unknown is distinguishable", §Positive confirmations).

---

## Findings

| # | Severity | Discipline | Location (file:line) | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | HIGH | Surface | `client/src/components/sources/saved-tab.tsx:157,223,318` · `client/src/components/sources/research-tab.tsx:59,74,173` · `client/src/components/sources/discover-tab.tsx:112,220,483` · `client/src/components/insights/learning-view.tsx:274,1378` · `client/src/components/insights/automated-optimization-panel.tsx:84,216` | Queries are consumed as `const x = query.data ?? []` with only `isLoading`; the empty branch is reached on error: `Nothing Saved Yet`, `No Research Yet`, `No sources found for this topic.`, `No multi-sample observations yet`, `No autonomous decisions recorded yet.` | Add an `isError` branch to each region that renders `ErrorState` with retry; where partial data exists, keep it and add a "may be incomplete" note (reuse the Today pattern at `pages/today.tsx:170`) | A read failure is presented as a clean empty/zero state — the brief's rule 5. Worst case is Discover: a failed sources read renders **"No sources found for this topic. Try broadening your search query"** (`discover-tab.tsx:483`) while the summary banner reports "0 sources reviewed · 0 key findings", so the operator is blamed and told to change a query that was never the problem. `discover-tab.tsx:112-113` additionally swallows the analysis error (`catch { return null }`), so competing-viewpoint counts silently vanish. |
| 2 | HIGH | Surface | `client/src/pages/today.tsx:67,82` · `server/content/routes.ts:1192` | `useQuery({ queryKey: ["/api/publications?limit=20"] })`, then Attention is derived client-side: `filter((p) => p.state === "failed")` / `p.result?.outcome === "unknown"` from those 20 rows | Request `?state=failed` and a matching unknown query (the endpoint already accepts `state`), or add a dedicated attention endpoint; never derive "what needs attention" from a newest-N window | On a real account the Attention list scans only the newest 20 publications. A `failed`/`unknown` publication older than that is absent from the one surface that promises "what needs your attention right now" — a failure silently rounded down to nothing. |
| 3 | HIGH | Surface | `client/src/components/schedule/publications-view.tsx:21` | `useQuery({ queryKey: ["/api/publications?limit=30"] })`; all rows rendered; no total, no cursor, no "showing 30 of N", no load-more | Surface the true count and paginate ("30 of 412") or virtualise with a paging control; state the window if it is fixed | At 500+ publications the Publications tab shows 30 rows as if that were the whole history. Content is hidden with no signal it exists — a HIGH per `severity.md` ("hides content"). It is the only aggregate publication-history surface in the product. |
| 4 | MEDIUM | Layout | `client/src/pages/queue.tsx:539,548,557,566` · `client/src/components/sources/saved-tab.tsx:223` · `client/src/components/sources/research-tab.tsx:74` · `server/routes.ts:128` | Every row is rendered as a full Card: `drafts.map(renderPost)`, `ready.map(...)`, `filteredItems.map(...)`, `jobs.map(...)`; no pagination, virtualisation, or filter. `GET /api/posts/queue/today` returns **all** drafts, ready and failed posts regardless of date (`routes.ts:131-139`) | Paginate or window the lists; add a state/channel/date filter and a sortable list on Queue; for Sources, cap the three merged endpoints (`/api/vault`, `/api/ideas`, `/api/references` are all unbounded — `routes.ts:2793,246,954`) | 500+ accumulated drafts or saved items become an unbounded DOM and an unsearchable wall. Against a 5-minute daily budget (`PLAN.md:9-13`) the operator cannot find the one row that matters. |
| 5 | MEDIUM | Voice | `client/src/pages/queue.tsx:587,593,~600` · `client/src/pages/calendar.tsx:307,334,~345` | Schedule dialogs prompt "Choose exact date and time for publishing" and render only date + time inputs; the target channel/account is never named (the Queue also shows "Post to X" with no handle) | Show the resolved target row — reuse `PublishPreview`'s "Target" line (`components/ui-shared/publish-preview.tsx:15-16`) which the artifact-review view already uses | The brief's composition table mandates Schedule "make time **and target account** explicit before anything ships." With more than one channel connected the operator commits a publish without knowing where it goes. The product already solved this in review; the shipping surfaces regressed past it. |
| 6 | MEDIUM | Surface | `client/src/pages/today.tsx:100,114,126` | Recent Activity is one flat, time-sorted array `[...artifacts, ...publications].sort(...).slice(0, 8)`, where `artifacts` is `?limit=5`; routine `Generated a x draft` rows are interleaved with failures; no filter, no severity | Separate or filter by kind ("Failures only" / group by type); keep failure rows pinned rather than competing on recency; drop the phrase-level caps in favour of a real count | The scope asks: *is there a way to separate signal from routine?* There is not. Under load the feed is a column of routine generation and a failure an hour old is pushed off the 8-row cap entirely. |
| 7 | MEDIUM | Interaction | `client/src/components/schedule/publications-view.tsx:79-83` | A `failed` or `unknown` publication row offers one control: a `Link` (`:80`) to the review page ("Check status" / "View details" / "View"). No retry or re-dispatch | Offer "Try again" / "Re-publish" on the row (or in review) for retryable failures, with the same confirm-and-preview pattern | `interaction.md`: "Recovery is visible. Retry is available when retry makes sense." Canonical publications are the primary pipeline yet their failures dead-end at a read-only link, unlike the legacy Queue failures which do carry a retry ("Post to X"). |
| 8 | LOW | Interaction | `client/src/components/agent/artifact-review.tsx:328,331` | `<Button … disabled={!approved}>Schedule</Button>` and `<Button … disabled={!approved}>Publish Now</Button>` — no tooltip, no inline reason, no `aria-describedby` | Add an inline "Approve this version to publish" note (or `title`/`aria-describedby`), as the Create review view does with its `banner-publish-incompatible` (`components/create/artifact-review-view.tsx:418`) | A disabled control that hides the thing that must be fixed. The same product explains its disabled publish state one component over. |
| 9 | LOW | Surface | `client/src/pages/analytics.tsx:499` | `stats.recentUsage.slice(0, 10).map(...)` under "AI Token Usage", with no "showing 10 of N" | Render the true total or a "latest 10" label with a link to full usage | More silent client-side truncation; the operator reads 10 rows as the complete usage list. |

---

## Positive confirmations — things that are already right

Stated so restraint is legible from oversight (`severity.md`, "Considered but Rejected" rationale).

- **Unknown vs failed vs published is genuinely distinguishable.** `status-badge.tsx:44-73` gives `failed`/`rejected`/`blocked` the destructive variant, `unknown` a neutral `secondary`, `published` the default. `publications-view.tsx:61-68` overrides the badge to `unknown` when `result.outcome === "unknown"` and swaps the row copy to "We couldn't confirm what happened with the platform." with a "Check status" action. `workspace-cards.tsx:104-114` renders `UNKNOWN` in an outline badge. This clears brief rules 3 and 4.
- **Partial results are disclosed on Today.** `today.tsx:200` renders "Some attention sources couldn't be checked — this list may be incomplete." underneath a populated list. This is the pattern Finding 1 asks the other regions to adopt.
- **Empty states mostly teach the space.** `analytics.tsx:216`, `create.tsx:195`, `today.tsx:163`, `learning-view.tsx:681/1313/1384/1653`, `research-tab.tsx:173`, `saved-tab.tsx:318` each state what belongs there and, except the two noted, carry a next-action button. The empties that merely *name* the space are the ones in Finding 1 — and those are actually failed reads, not empties.
- **The scheduling surfaces validate time honestly.** `queue.tsx:267,271` and `calendar.tsx:358` reject past times and NaN dates with destructive toasts; `SchedulePicker` (`components/ui-shared/schedule-picker.tsx:26`) emits `null` for a past/invalid time so the confirm stays disabled.
- **Human-vs-automatic authority is legible.** `ActorBadge` (`components/ui-shared/actor-badge.tsx`) carries an icon and a distinct word per actor, so the distinction survives greyscale and truncated tables — consistent with `phase-31.2:78-79`.

---

## Considered but rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `client/src/pages/schedule.tsx:41-47` | Schedule tab ordering (Queue → Calendar → Publications) | Operate-first order is correct; the tab strip is not the defect. |
| `client/src/components/ui-shared/status-badge.tsx:44-67` | `generating`/`running`/`waiting_for_approval` distinguished by hue+pulse only | Already reported in `checkup-report.md` #4 and `smell-report.md` #4. Not re-reported here. |
| `client/src/components/sources/source-card.tsx:77` | Title button strips focus (`focus:outline-none` with no ring) | Already reported in `smell-report.md` #1. Not re-reported. |
| `client/src/components/insights/learning-view.tsx` | Unbounded lists / 50-100 row cards | The server caps `/api/learning/proposals|observations|signals` at 50-100 (`server/content/learning/routes.ts:180,245,55`), so this is bounded. Only the missing error branch (Finding 1) is reported. |
| `client/src/components/ui-shared/empty-state.tsx:37` | Icon-topper circle on every empty state | Already reported in `smell-report.md` #9. Not re-reported. |
| `client/src/pages/queue.tsx:442` | "Post to X!" exclamation in the publish toast | Already reported in `smell-report.md` #10. Not re-reported. |

---

## Verification

### Checks run (source-level; no dev server started)

| Check | Method | Observed |
|---|---|---|
| Error-branch audit of every data region | Grepped `isError\|ErrorState\|refetch\|onRetry` across `client/src/**/*.tsx` (114 hits, 20 files) and read each data region in full | 5 regions consume a query with no error branch (Finding 1); Queue/Calendar/Today/Settings/Analytics/Agent handle it. |
| Publication windowing | Read `components/schedule/publications-view.tsx` and `pages/today.tsx` in full; read `server/content/routes.ts:1189-1204` | Client caps at 30 and 20; server supports `state` filter + `limit` the client ignores. |
| Unbounded list endpoints | Read `server/routes.ts:122-152` (queue), `:246` (ideas), `:954` (references), `:2793` (vault); grep for `limit` in those handlers | All return full result sets; none paginate. |
| Multi-account identity | Read `server/routes.ts:1986-2054` and `server/storage.ts:665-683` | `upsertConnectedAccount` dedupes on `(platform, userId)` → one account per platform; the UI's `accounts.find(a => a.platform === …)` pattern (`settings.tsx:172-176`, `artifact-review-view.tsx:302`) can therefore only ever show one. The remaining identity gap is the missing target on the shipping surfaces (Finding 5). |
| Token redaction | Read `server/routes.ts:1974-1984` | `/api/accounts` returns `"••••••" + last4`, so the token row in `settings.tsx` is not a secret leak. Not reported. |
| Truncation affordances | Grepped `truncate\|line-clamp\|slice(0,` across `client/src` | Card/list text is generally `min-w-0 + truncate/line-clamp` with ellipsis. The exceptions are undocumented *counts* (Findings 3, 9), not clipped text. |
| DLQ / dead-letter | Grepped `dead.?letter\|DLQ\|deadLetter` across `client/src` | Zero matches. No DLQ surface exists. |
| Unknown-state separability | Read `status-badge.tsx`, `publications-view.tsx`, `workspace-cards.tsx`, `today-schedule-state.ts` | Confirmed separable (see §Positive confirmations). |

### Not verified (gaps, not findings)

- **Rendered behaviour under a real 500-row dataset.** No dev server was started and no data was seeded; Findings 2-4, 6 are read from source and from the server's unpaginated responses, not measured in a browser. The server behaviour (no `LIMIT`) is source-verified.
- **Dead-letter queue depth / retry exhaustion.** `pg-boss` DLQ tables are documented as operator-only (`phase-31.2:6`) and have no UI; whether a retry-exhausted publication is distinguishable from a first-attempt failure in the API response was not exercised.
- **Multi-account-per-platform in production data.** The schema dedupes on `(platform, userId)`, so the scenario could only arise from rows written outside `upsertConnectedAccount`; not exercised.
- **Screen-reader announcement of the live region** for the paths in Finding 1 (the region exists — `components/ui-shared/announcer.tsx` — but the failed-read regions never call it).

---

## Verdict

**BLOCK** — three `HIGH` findings stand (Findings 1-3), including a read-failure-as-empty-state class that directly contradicts the brief's rule 5 and, in Discover, actively misdirects the operator. Findings 4-7 are `MEDIUM` and systemic to the Schedule/Sources surfaces under load.

**Highest-leverage single action:** fix Finding 1 — add the missing `isError` branch to the five data regions. It is one root cause, it restores the product's central honesty guarantee across Sources, Insights and the autonomy panel, and the pattern already exists on Today to copy.
