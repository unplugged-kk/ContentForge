# ContentForge — Per-Route Information Architecture & Workflow Audit

**Worktree:** `wt-02` (branch `design/wt-02`) · **Repo under audit:** `/Users/kishore/git/ContentForge` (read-only)
**Mode:** per-route IA / workflow-transition audit (report only)
**Register:** Product — authenticated single-operator tool, `Operate` + `Monitor` (`.commandcode/design/brief.md:11-19`)
**Date:** 2026-09-26
**Scope:** page hierarchy, grouping, discoverability, and the research→create→review→schedule→measure→learn transitions on the seven canonical routes (`/today /create /sources /agent /schedule /insights /settings`) and the components each composes.
**Out of scope by instruction:** the seven canonical destinations and the legacy redirect map are settled and were not challenged. Phase 33.2 unlanded work (tokenized chart colors, live-region announcer, `rejected` status, safe-area insets, `ActorBadge`/`ChannelIcon`, legacy route mapping) is treated as present and is not re-reported.

---

## Verdict

**Block** — four `HIGH` findings stand, and two of them are the same class of defect the brief calls the strongest principle in the product: a transition that promises continuity and silently drops it.

The route *set* is right and the sidebar is clean. `CANONICAL_NAV_ITEMS` (`client/src/components/app-sidebar.tsx:25-33`) contains exactly the seven approved destinations and nothing else, `isRouteActive` (`:37-78`) maps every legacy subroute back to its canonical owner, and every route composes the shared `PageHeader`. There is **no duplicate top-level navigation**.

What has not settled is everything *below* the top level. Three of the seven routes build a second navigation row inside the page body; two routes put a tab bar into the header slot the shared component documents as the "primary action" (`client/src/components/ui-shared/page-header.tsx:14`) and therefore have no primary action at all; and the load-bearing handoff — the artifact you just scheduled — has no surface on the page named after it.

Counts: **4 HIGH · 9 MEDIUM · 2 LOW**.

---

## The six questions, answered with evidence

### 1. Is the primary action unambiguous on each of the 7 routes?

| Route | Primary action | Where | Unambiguous? |
|---|---|---|---|
| `/today` | "Create content" | `today.tsx:137-142` (header) | **No** — a second, competing four-tile "Quick Actions" grid asks the same question at `today.tsx:295-305` |
| `/create` | "Generate Content" | `create-studio.tsx:627` (form footer) | **Mostly** — the only unimpeachable one; but the `Mode:` bar above it (`create.tsx:155-189`) presents a second row of mode pills before the form starts |
| `/sources` | Search + "Start Research" | `discover-tab.tsx:255-264` | **No** — the shared header's action slot holds a *different* primary action, "Quick Capture" (`sources.tsx:74-85`). Two candidates, two owners, one page |
| `/agent` | "Start run" | `agent.tsx:553-570` | **Yes** |
| `/schedule` | *(none)* | header slot is a tab bar (`schedule.tsx:34-50`) | **No primary action exists.** The header the other routes use for their CTA is occupied by Queue/Calendar/Publications |
| `/insights` | *(none)* | header slot is a tab bar (`insights.tsx:54-80`) | **No primary action exists.** Same cause |
| `/settings` | *(none page-level)* | per-tab actions | **Acceptable** — Configure is a grouped surface, not an Operate surface |

Five of seven are resolved only by scanning the page. Two have no primary action at all, and the cause is mechanical: the action slot is being used for view switching.

### 2. Where does the operator scroll past information to reach the action that page exists for?

- **`/agent`** — the decision is the artifact review. It is Section 6 of 6, at `agent.tsx:798-801`, below the composer, the active-run summary, the authorization callout, the execution timeline and the repurposing plan. The operator scrolls the entire run narrative to reach the one thing they must act on.
- **`/schedule` → Queue** — the queue is below a compliance `Alert` (`queue.tsx:480-501`), an X-budget warning (`:503`), and a "Refresh stats" row (`:504-508`), inside a `p-4 border-b` block. On a 390px viewport the first post starts after roughly six lines of chrome.
- **`/create`** — "Generate Content" sits at `create-studio.tsx:627`, after seven fieldsets plus the generation-summary card. The summary immediately above the button is the right pattern; the form is the input, so this is acceptable rather than wrong.
- **`/insights` → Learning** — `Optimization Proposals` (the action queue) is at `learning-view.tsx:642-647`; `Policy Candidates` (also actionable) is at `:1616-1621`. Nothing links them across the ~975 lines between.
- **`/sources`** — the research form is first in `DiscoverTab` (`discover-tab.tsx:239-243`), which is correct. But the provider-limitations notice (`discover-tab.tsx:229-236`) is rendered above it whenever any provider is unavailable.

### 3. Where do two independent sections compete for the same visual weight?

- **`/today`** — `Today's Schedule` (`today.tsx:208`) and `Recent Activity` (`:267`) are siblings in one `grid grid-cols-1 lg:grid-cols-2` (`:206`). One is a work queue with per-row actions; the other is a passive log. They are the same size on every desktop viewport.
- **`/insights` → Learning** — five `<h2 className="text-lg font-semibold">` bands, each with a coloured icon and a tier badge: `:647`, `:864`, `:1274`, `:1440`, `:1621`. Two are action queues, one is measurement, one is inference. The page returns five equal-weight scarps.
- **`/agent`** — the composer `Card`, the active-run summary `div`, the execution-timeline `Card` and the generated-artifacts `section` all use the same `rounded-lg border bg-card` treatment (`agent.tsx:530`, `:614`, `:716`, `:799`). Nothing leads.
- **`/schedule` → Queue** — each post card renders seven peer controls in one `flex flex-wrap gap-2` row (`queue.tsx:369-457`): `Hide`, `Edit`, `Preview`, `Mark Ready`, `Schedule`, `Post to X`, `Delete`. One carries `variant="default"`; the rest are `outline`/`ghost` at the same size.

### 4. Is there any remaining duplicate navigation or competing nav system?

The top level is clean. Inside three routes it is not:

- **`/sources` has two navigation rows** — a primary row `Discover / Saved / Research` under a `View:` label (`sources.tsx:108-160`), and a second row `Ideas / Vault / References / Ingest` separated by a hard `border-l pl-3` rule (`:162-235`). The second row's own comment calls it what it is: `{/* Compatibility Views for Legacy Tests & Direct Navigation */}` (`:162`). Its pills are `text-[11px]` against the first row's `text-xs`, so the same class of destination is rendered at two weights.
- **The two rows can be active at once, and neither can express the other's state** — `Discover` is active only at `sources.tsx:119`; `Saved` only when `activeView === "saved" && savedFilter === "all"` (`:137`); `Ideas` only when `activeView === "saved" && savedFilter === "ideas"` (`:173`). Landing on `/ideas` therefore shows **no** active pill in the primary row and an active pill in the compatibility row.
- **`/sources?view=ingest` adds a third row** — `IngestPage` renders its own four-tab set (`ingest.tsx:271-276`) inside the Sources body (`sources.tsx:240`). Three stacked navigation bands on one route.
- **`/create` has a mode bar and an in-page mode selector** — the `Mode:` row of nine pills plus a "YouTube (deferred)" chip (`create.tsx:155-189`), and, ~90px below it, `CreateStudio`'s own `What are you creating?` row of format pills (`create-studio.tsx:243-286`). Both are horizontally-scrolling pill rows answering "what am I making".
- **`/today` duplicates its own entry point** — `Create content` in the header (`today.tsx:137-142`) and `Create` in the Quick Actions grid (`:300-305`), which is itself a mirror of the sidebar.

### 5. Does the create→review→schedule handoff preserve context, or does the operator re-find the artifact?

Three of four hops are broken.

| Hop | Carrier | Destination reads it? | Result |
|---|---|---|---|
| Create → Review | `?artifact=<id>`, pushed at `create.tsx:126-131` | Yes — `create.tsx:78` | **Preserved.** Review opens in place, back button restores Create (`:134-140`) |
| Review → Schedule | `POST /api/schedules` from a dialog inside the review (`artifact-review-view.tsx:228-241`) | n/a — inline dialog | **Preserved at the moment of action.** Lost immediately after: see below |
| Review/Queue → `/schedule` | `getCanonicalReviewUrl` → `/create?artifact=<id>` (`agent-workspace-state.ts:168-170`) | Yes | **Works** — the row-level link back to Review is correct |
| **Scheduled artifact → `/schedule`** | **nothing** | **nothing queries it** | **Broken.** `grep` for `/api/schedule-occurrences` across `client/src` returns exactly one consumer: `today.tsx:72`. `/schedule`'s three views are Queue (`/api/posts/queue/today`), Calendar (`/api/posts`) and Publications (`/api/publications?limit=30`, `publications-view.tsx:21`). A canonical occurrence scheduled from Create or Agent is **invisible on the page named Schedule** until it has already become a publication |
| Sources → Create | `getCreateFromSourceUrl` → `/create?topic=…&sourceUrl=…` (`sources-research-state.ts:356-361`) | **No** — `create.tsx:75-103` parses only `mode`, `artifact`/`artifactId`, `type`, `storyId`, `ideaId`, `empty` | **Broken.** "Create Content" from a source (`discover-tab.tsx:475`, `:519`; `saved-tab.tsx:303`) lands on a blank studio. The topic and URL are dropped |
| Insights → Agent | `getAskAgentUrl(prompt)` → `/agent?prompt=…` (`agent-workspace-state.ts:172-177`) | **No** — `agent.tsx:162-171` parses only `runId` | **Broken.** The Learning view's "Ask Agent" card (`learning-view.tsx:1870`) lands on the Agent composer pre-filled with the hardcoded default at `agent.tsx:334`, not the observation the operator clicked |

---

## Findings

| # | Severity | Discipline | Location (file:line) | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | HIGH | Interaction | `client/src/pages/schedule.tsx:34-66`; `client/src/components/schedule/publications-view.tsx:21`; `client/src/pages/today.tsx:72`; `client/src/components/create/artifact-review-view.tsx:228-241` | `/schedule` renders Queue + Calendar + Publications. Publications queries only `/api/publications?limit=30`. The only consumer of `/api/schedule-occurrences` in the entire client is `today.tsx:72` | Add a **Scheduled** view to `/schedule` (a fourth tab, or a `state` column on Publications) reading `/api/schedule-occurrences?from=&to=`, with each row linking to `getCanonicalReviewUrl(artifactId)` | The operator schedules from Create or Agent, navigates to the page called Schedule, and the thing they scheduled is not there. The `schedule` step of the loop has no surface of its own; the handoff is a dead end until publication, which may be days later |
| 2 | HIGH | Interaction | `client/src/lib/sources-research-state.ts:356-361` + `client/src/pages/create.tsx:75-103`; `client/src/lib/agent-workspace-state.ts:172-177` + `client/src/pages/agent.tsx:162-171` | `getCreateFromSourceUrl` emits `/create?topic=&sourceUrl=`; `getAskAgentUrl` emits `/agent?prompt=`. `create.tsx` parses `mode`, `artifact`, `artifactId`, `type`, `storyId`, `ideaId`, `empty` only. `agent.tsx` parses `runId` only | Parse `topic` and `sourceUrl` in `create.tsx:75-103` and seed `CreateStudio`'s `concept` and source; parse `prompt` in `agent.tsx:162-171` and seed `composer`. If continuity is not intended, delete the params so the link stops implying it | Two transitions carry the operator's context in the URL and the destination silently discards it. "Create Content" from a source opens a blank studio (`concept` unset, `initialStoryId`/`initialIdeaId` undefined). "Ask Agent" opens on the unrelated default objective at `agent.tsx:334`. The operator re-finds the artifact by hand at exactly the two points the 5-minute budget cannot afford |
| 3 | HIGH | Layout | `client/src/pages/sources.tsx:105-235` (second row at `:162-235`); `client/src/pages/sources.tsx:240` + `client/src/pages/ingest.tsx:271-276` | Two stacked nav rows: a `View:` row (`Discover / Saved / Research`, `text-xs`) and a `border-l pl-3` "Compatibility Views" row (`Ideas / Vault / References / Ingest`, `text-[11px]`). `/sources?view=ingest` adds a third tab row from `IngestPage` | Promote `Ideas`, `Vault`, `References` and `Ingest` into the `Saved` filter vocabulary at one weight, in one row with `Discover / Saved / Research`; fold Ingest in as a `Saved` mode or a `Discover` action rather than a stacked page | Two nav systems for the same destination set. The compatibility row carries the canonical subviews the IA doc assigns to Sources yet renders them at a lower weight and a smaller size, and its pills are the only ones that can be active while the primary row shows nothing selected (`sources.tsx:137` vs `:173`). Ingest then stacks a third band. Discoverability of four real subviews is being traded for a code comment's convenience |
| 4 | HIGH | Interaction | `client/src/pages/schedule.tsx:34-50`; `client/src/pages/insights.tsx:54-80`; `client/src/components/ui-shared/page-header.tsx:7,14` | `PageHeader`'s `action` prop is documented as "primary action". On `/schedule` it holds the Queue/Calendar/Publications `TabsList`; on `/insights` it holds the Performance/Learning/AI Usage `TabsList`. Neither route renders any primary action anywhere on the page | Move view switching to a sub-header band below the `PageHeader` (as `/sources` already does) and use the `action` slot for the route's real CTA: `Schedule` → "Schedule content"; `Insights` → no action, or "Export". If a route genuinely has no action, pass nothing and let the slot collapse | The one component that is supposed to make the primary action consistent across all seven destinations is being used for a different job on two of them. The slot's meaning now depends on the route, and the two routes where the operator is most likely to want to *do* something are the two with no button |
| 5 | MEDIUM | Layout | `client/src/pages/today.tsx:137-142` vs `:295-305` | `Create content` in the sticky header, and a four-tile `Quick Actions` grid (`Create` / `Research` / `Ask Agent` / `Capture a link`) as the final section | Keep the header CTA. Reduce Quick Actions to the one entry the header does not already offer (`Capture a link` → the existing `contentforge:open-quick-capture` event at `:311-313`), or drop the section | Today asks "do you want to create?" twice, and the second ask is a four-way replica of the sidebar. The section also sits below Attention, Schedule and Activity, so the duplicate is the least visible thing on the page while the header CTA already answered it |
| 6 | MEDIUM | Layout | `client/src/pages/today.tsx:206-268` | `Today's Schedule` and `Recent Activity` are siblings inside `grid grid-cols-1 lg:grid-cols-2 gap-6` | Keep the vertical order (the brief prescribes attention → due → happened) but break the grid: full-width Schedule, then a narrower or lower-contrast Activity band with a quieter heading | A work queue with per-row actions and a passive log are given identical area. Equal weight on unequal jobs flattens the page's hierarchy exactly where the brief asks for a triage order |
| 7 | MEDIUM | Layout | `client/src/pages/agent.tsx:798-801`; duplicated status at `:635` and `:723` | "Generated Artifacts & Results" is Section 6 of 6, below the composer (`:530`), the active-run summary (`:614`), the authorization callout, the execution timeline (`:716`) and the repurposing plan. `StatusBadge status={displayStatus}` renders in the run summary at `:635` and again in the timeline card header at `:723` | Move the artifact review to the top of the primary column once `selectedArtifactId` is set, with the timeline collapsed behind a "Show execution steps" disclosure. Render the run status once | The Inspect-and-steer surface buries the Approve decision under the run's own narrative. The same status string appears twice in one column, so neither instance reads as the authoritative one |
| 8 | MEDIUM | Layout | `client/src/pages/queue.tsx:480-508`; action row at `:369-457` | A `p-4 border-b` block holds the compliance `Alert` (`:480`), an X-budget warning (`:503`) and a "Refresh stats" row (`:504`) before the queue list begins. Each post card renders seven peer buttons in one row | Move the compliance `Alert` to the bottom of the view (or behind a "How publishing works" disclosure) and keep the queue list as the first element; group the card's controls into one primary action plus a `⋯` overflow menu | Standing policy copy is repeated on every visit to the daily surface, and it is placed above the only content the operator came for. Seven equally-sized buttons per card means the destructive control sits one 40px step from "Post to X" |
| 9 | MEDIUM | Layout | `client/src/components/insights/learning-view.tsx:642-647`, `859-864`, `1271-1274`, `1437-1440`, `1616-1621` | Five identical `<h2 className="text-lg font-semibold">` sections, each opening with a coloured tier icon and a badge. Two are action queues (`Optimization Proposals`, `Policy Candidates`); `Measured Production Signals` is measurement; `Inferred Patterns & Voice` is inference | Split the actionable tiers from the measurement tiers into two labelled regions with different heading weight (action queue: `text-base` + count; measurement: `text-xs uppercase tracking-wider`), and add a jump strip at the top | Insights is a Compare surface (`brief.md`, Composition table). Five equal-weight bands is not a scanning lane, and the two sections that need a decision are separated by ~975 lines of observation the operator must not have to read first |
| 10 | MEDIUM | Writing | `client/src/pages/create.tsx:155-189`; `client/src/components/create/create-studio.tsx:243-286` | A `Mode:` bar of nine pills plus a chip labelled `YouTube (deferred)` with `aria-label="YouTube, legacy capability with canonical placement deferred"` (`:181-182`). ~90px below, `CreateStudio` renders `What are you creating?` with its own format pills | Remove the `(deferred)` chip from the UI (keep `/youtube` live but un-listed). Either make the `Mode:` bar the single mode chooser and strip the in-studio format row, or vice versa | The UI tells the operator that a roadmap decision is pending inside the product they are using. And two horizontally-scrolling pill rows on one screen both answer "what am I making", so neither is the selector |
| 11 | MEDIUM | Layout | `client/src/pages/ingest.tsx:251-253`, `271-276`; rendered from `client/src/pages/sources.tsx:240` | `IngestPage` renders its own page block with `<h1 className="text-2xl font-bold">Ingest Content</h1>` and its own four-tab `TabsList`, inside the Sources shell that already renders the `PageHeader`'s `<h1 className="text-lg">` | Render Ingest as a Sources view body: drop the inner `<h1>` (or demote it to `h2` at the shell's section weight) and keep only the tab row | Two page-level `<h1>`s on one route, and the nested one is visually larger than the shell's title. The composition says "you have navigated to a different product" when the operator has only switched a view |
| 12 | MEDIUM | Voice | `client/src/pages/settings.tsx:312` vs `client/src/pages/settings.tsx:506` | The X / Threads / LinkedIn account card renders `{account.accessToken}` in a `font-mono` span labelled `Token` (`:312`); the YouTube card on the same tab states "Tokens are never shown here." | Never render a credential. Replace `:312` with a masked, non-reversible status (`Configured` / `Not set`) matching the YouTube card's `refreshCredentialPresent` pattern | One surface in Settings leaks a secret in plaintext while another states in writing that it does not. This is the Truthfulness rule applied to settings: a claim the UI itself contradicts |
| 13 | MEDIUM | Interaction | `client/src/pages/agent.tsx:420-436`; the drawer it duplicates at `:437-489` | The agent backend `Select` is permanently in the `PageHeader` action slot, next to the page title. The `Diagnostics` sheet already exists on the same header for exactly this class of control and holds `ResearchPanel`, `VideoPanel`, `AudioPanel`, `RepurposePanel`, `StyleIntelligencePanel` | Move the backend `Select` inside the Diagnostics sheet, beside the panels that expose the same subsystem | A technical engine selector competes with the route title on every visit, while the drawer built to hold this class of control sits unused next to it. Advanced capability should be disclosed, not co-resident with the primary workflow |
| 14 | LOW | Writing | `client/src/pages/queue.tsx:476`, `:528`; `client/src/pages/ingest.tsx:611` | Queue copy reads "Drafts from **Discover** → edit → mark ready → post to X" (:476) and "Go to **Discover** and click Create Draft on any idea" (:528). Ingest's footer action navigates to `"/calendar"` (`:611`) | Say "Sources" (the canonical destination) in both strings, and navigate to `/schedule?tab=calendar` | Discover is a subview, not a destination, so the copy names a place that is not in the sidebar. `/calendar` still resolves via the legacy redirect (`legacy-route-mapping.ts:16`) but routes new navigation through a compatibility path |
| 15 | LOW | Layout | `client/src/pages/sources.tsx:110` vs `client/src/pages/create.tsx:158` | `View:` (`text-[11px] font-semibold uppercase tracking-wider`) and `Mode:` (`text-[11px] font-medium`) prefix two different pill bars in two different shapes | Pick one label treatment for "this row switches the view" and apply it on both routes — or drop the labels and let `aria-current` carry it | Both rows do the same job with a different eyebrow, so an operator who has learned one route's nav does not recognise the other's |

---

## Considered but rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `client/src/pages/today.tsx:148-205` | Attention list is a stack of `Card`s with `rise-in` stagger | Correct as written and already adjudicated in `checkup-report.md` ("Cards are correct here"). These are discrete, action-bearing, priority-sorted units. Not re-reported |
| `client/src/components/ui-shared/page-header.tsx:30` | Sticky header with `backdrop-blur` | Earned. A sticky header over scrolling content needs the `supports-[backdrop-filter]` fallback surface it already carries |
| `client/src/components/insights/learning-view.tsx:1827-1874` | Three-card "bridge" row of next-steps at the foot of Learning | Has a work reason: three canonical exits out of a dead end, correctly rendered as mode switches (smell-report, "Considered but rejected"). Not an IA defect |
| `client/src/lib/insights-state.ts` | `getExploreTopicUrl` → `/sources?query=` | The builder exists but has no caller in `client/src`. A dead helper is a cleanup item, not an operator-visible finding |
| `client/src/pages/queue.tsx:145-157` and `:191-194` | Two X-analytics sync `useEffect`s with different throttles (one 4-hour cooldown, one unconditional on mount) | A behavioural defect, not an information-architecture one. It belongs to a state/effects audit, not this pass |
| `client/src/pages/agent.tsx:437-489` | Diagnostics sheet holding five technical panels | Correct progressive disclosure. The panels are already off the primary surface; this is the pattern finding 13 asks the backend selector to follow |
| `client/src/components/agent/artifact-review.tsx:175` | Agent's own `POST /api/schedules` call sits beside `ArtifactReviewCard` | Investigated as a second scheduling entry point and rejected: it feeds the same `/api/schedules` contract as `artifact-review-view.tsx:232`, so it is one behaviour with two call sites, not two competing flows. It is folded into finding 1 instead |

---

## Verification

**Ran in this pass**

| Check | Method | Observed |
|---|---|---|
| Canonical nav is exactly seven and has no duplications | Read `client/src/components/app-sidebar.tsx` in full | `CANONICAL_NAV_ITEMS` holds Today/Create/Sources/Agent/Schedule/Insights/Settings only (`:25-33`). No second top-level nav exists |
| Legacy routes still resolve | Read `client/src/App.tsx:84-118` and `client/src/lib/legacy-route-mapping.ts` in full | Every legacy route renders `LegacyRouteRedirect`; `/youtube` remains a live component, not a redirect (`App.tsx:111`) |
| Canonical occurrences have no Schedule surface | `grep -rn "schedule-occurrences" client/src` | Exactly one hit, `client/src/pages/today.tsx:72`. `grep -rn "occurrence" client/src/components/schedule client/src/pages/schedule.tsx` returns nothing. **Finding 1 confirmed** |
| Handoff params are not read by destinations | `grep -n "params.get" ` on `create.tsx`, `sources.tsx`, `agent.tsx`; cross-referenced against every non-lib caller of the URL builders | `create.tsx` parses 6 params, none of them `topic`/`sourceUrl`. `agent.tsx:162-171` parses `runId` only. `sources.tsx:30-60` parses `view` only. **Finding 2 confirmed** |
| Sources renders two nav rows | Read `client/src/pages/sources.tsx` in full; grep for `activeView ===` | Second row at `:162-235`; `Saved` active only at `filter === "all"` (`:137`); `Ideas` active at `filter === "ideas"` (`:173`) with no active pill in the primary row. **Finding 3 confirmed** |
| Header action slot usage across routes | Grep for `action={` in all seven page files | `today.tsx:137` button; `create.tsx:106` conditional button; `sources.tsx:74` button; `agent.tsx:415` control cluster; `schedule.tsx:34` TabsList; `insights.tsx:54` TabsList; `settings.tsx` none. **Finding 4 confirmed** |
| Queue action density | Read `client/src/pages/queue.tsx` in full | Seven buttons per card at `:369-457`, one `variant="default"`. **Finding 8 confirmed** |
| Learning section weights | Grep for `<h2` in `learning-view.tsx` | Five `text-lg font-semibold` headings at `:647, :864, :1274, :1440, :1621`. **Finding 9 confirmed** |
| Ingest renders a second `h1` | Read `client/src/pages/ingest.tsx:245-280`; grep for `IngestPage` in `sources.tsx` | `<h1 className="text-2xl">` at `:253`, rendered from `sources.tsx:240`. **Finding 11 confirmed** |
| Token exposure vs the page's own claim | Grep `accessToken\|Tokens are never shown` in `settings.tsx` | `:312` renders the token; `:506` claims tokens are never shown. **Finding 12 confirmed** |
| Internal vocabulary leaks | Grep `fixture\|deferred\|configuredId` across `client/src` | `settings.tsx:41` and `agent.tsx:305` use "fixture"; `create.tsx:187` renders "(deferred)". Only the user-visible one is reported (finding 10); `fixture` appears inside explanatory prose rather than as a label |
| Phase 33.2 work is present and not re-reported | Grep for the announcer, `ActorBadge`, `ChannelIcon`, `rejected`, `env(safe-area` | `ui-shared/announcer.tsx`, `actor-badge.tsx`, `channel-icon.tsx` all present; `quick-capture.tsx:65` uses `env(safe-area-inset-bottom)`. No row below re-reports them |

**Not verified (verification gaps, not findings)**

- **Rendered behaviour.** No dev server was started, per the hard rules. Every finding is read from source. Finding 6 (equal column weight) and finding 8 (banner height on mobile) are geometry claims read from class names, not from pixels.
- **Viewport matrix.** The brief's 49-execution 1440→390 gate was not re-run. Whether the `Mode:` bar plus `CreateStudio`'s format row overflow together at 390px is unknown.
- **Runtime active-state resolution in `Sources`.** The claim that no primary-row pill is active on `/ideas` is read from the conditional class logic in `sources.tsx`; it was not observed in a browser.
- **`/api/schedule-occurrences` payload shape.** The endpoint is documented in `docs/today-schedule-ux.md`; the client contract was read from `today.tsx:40-50` only. Finding 1's "After" assumes the same shape is reusable on `/schedule`.

---

## Next modes

Findings 1 and 2 are the loop's structural breaks and should be fixed before any visual work; both are route-and-param changes with no visual surface.

- **`/design relayout`** scoped to `pages/sources.tsx` (finding 3), `pages/schedule.tsx` + `pages/insights.tsx` headers (finding 4), and `pages/agent.tsx` section order (finding 7). These are the four structural moves.
- **`/design writing`** for findings 10 and 14 (roadmap state in the UI, "Discover" as a destination name).
- **`/design relayout`** scoped to `components/insights/learning-view.tsx` (finding 9) and `pages/queue.tsx` (finding 8), both of which the prior `smell-report.md` already flagged at the same locations.
- Findings 1, 2 and 12 are not design work: they are a missing query, two missing param reads, and a secret rendered to screen.
