# Change Report — W-F (Schedule + Agent + Today)

**Workstream:** W-F
**Worktree / branch:** `/Users/kishore/git/cf-design/impl-f` · `design/impl-f`
**Baseline:** coordinator snapshot (main repo `87a0601`-era)
**Scope:** `pages/{today,schedule,queue,calendar,agent}.tsx`, `components/schedule/**`, `components/agent/**`
**Constraint:** structural change only — same data, same routes, same API contracts, same capability. No
`server/**`, no `components/ui/**`, no `ui-shared/**`, no autonomy/scheduler logic.

---

## 1. Files changed

| File | Findings |
|---|---|
| `client/src/pages/agent.tsx` | F1(a), F1(c), F1(d), M8, W-E `?prompt=` patch, sub-12px sweep |
| `client/src/components/agent/workspace-cards.tsx` | F1(b), F1(d), `pressable` on the run-card `<button>` |
| `client/src/pages/today.tsx` | D1 (attention window + truncation), D1 dup keys, WT-08 (activity signal/routine), M8, sub-12px |
| `client/src/pages/schedule.tsx` | J1 (tab strip ↔ header action), G1(d) overflow |
| `client/src/pages/queue.tsx` | WT-08 (target + button hierarchy), G1(a) call site, M8, copy, isError |
| `client/src/pages/calendar.tsx` | WT-08 (target), G1(a) call site, M8, isError, `pressable`, sub-12px |
| `client/src/components/schedule/publications-view.tsx` | D1 (truncation disclosure), sub-12px |

`components/agent/{artifact-review,audio-panel,video-panel,research-panel,style-panel,repurpose-panel,media-provider-selector}.tsx`
were read but not changed (no owned finding landed in them; their status/asset copy lives in `workspace-cards.tsx`).

---

## 2. Findings addressed

### F1(a) HIGH — the Dismiss control that lied  → **fixed**

`agent.tsx:713-721` previously ran `setView((prev) => ({ ...prev, waitingForApproval: false }))`, a local
mutation of the exact flag `deriveRunDisplayStatus` (`lib/agent-workspace-state.ts:54`) reads. It removed
"Waiting for approval" without any request and without changing the world.

**Chosen fix:** the affordance is now truthfully scoped rather than deleted. The callout's secondary action
is relabelled **"Hide request"** (`data-testid="button-run-hide-approval"`) and only sets a new local
`approvalHidden` flag — it **never touches `view.waitingForApproval`**. When hidden, a persistent banner
(`data-testid="banner-approval-hidden"`) shows the *unchanged* `waiting_for_approval` `StatusBadge`, states
"This run is still waiting for authorization — nothing was approved.", and offers **"Show request"**
(`data-testid="button-run-show-approval"`), so approval never becomes unreachable.

Why this option and not "route to a real dismiss action": grepping the server (`server/agent/routes.ts`)
shows **no deny/dismiss/cancel endpoint** — only `POST /runs/:id/resume` and `POST /runs/:id/continue`.
Routing Dismiss to the server would have required a new server route (forbidden) or misrepresenting
`resume` (which advances the run) as a dismiss. The audit (`ai-autonomy-ux-audit.md` finding #2) explicitly
accepts "relabel it to disclose ('Hide') and leave the run status untouched"; that is what ships. `selectRun`
resets `approvalHidden`, so switching runs never carries a stale hidden state.

### F1(b) MEDIUM — raw enum statuses in the primary timeline → **fixed**

`workspace-cards.tsx`: `ToolCallCard` (`:32-35`) and `AgentRunCard` (`:76`) no longer render
`{call.status}` / `{run.status}` in ad-hoc `Badge`s. Both use the shared `StatusBadge`
(`components/ui-shared/status-badge.tsx`). `denied`, which is not in the shared vocabulary, is mapped to
`blocked` (destructive variant + alert glyph) by a documented `toolStatus()` helper rather than rendered
verbatim or rounded to `unknown`. `failed` is now `destructive`, visually distinct from `completed`.

### F1(c) MEDIUM — the Approve decision was buried at Section 6 → **fixed**

Primary-column order is now: Composer → Active-run summary → **Approval callout** → **Generated Artifacts &
Review (the ArtifactReviewCard = the Approve decision)** → Repurpose progress → **Execution Timeline**. The
decision (Approve) now sits above the execution detail. The duplicate `StatusBadge` (was rendered in both
the run summary `:635` and the timeline header `:723`) is rendered **once**, in the run summary. The
timeline (technical detail) gains a collapse toggle (`data-testid="button-toggle-execution-steps"`),
defaulting open so behaviour is preserved.

### F1(d) MEDIUM — internal vocabulary in the primary workflow → **fixed**

`workspace-cards.tsx` asset cards: `VisualAsset`→**Image**, `VideoAsset`→**Video**, `AudioAsset`→**Audio**,
`VideoRepurposingJob`→**Video clips**; `OpportunityCard`/trace text `Opportunity`→**Idea** (per
`docs/ui-information-architecture.md:149-158`). Raw `contentHash`, mime, provider id, generation/size
numbers, and the developer notes ("Identity only — no binary…") are moved behind a per-card
`<details>` **"Technical details"** disclosure. The raw `{activeRun.backendId}` was removed from the run
summary and relocated into the Diagnostics sheet as `panel-run-identity` (Run #, Backend, Status, Started).

**Deviation, stated:** the coordinator's wording is "move to the Diagnostics sheet". The asset cards are
shared with `components/agent/artifact-review.tsx`, which has **no** Diagnostics sheet, so a page-level
move would have either dropped the identity from the review surface or forced a new sheet into a file
outside this item's remit. Per direction §2 principle 3 ("Detail is progressively disclosed, never
deleted"), the identity is progressively disclosed on the card instead. Heading copy in `agent.tsx`
("Opportunities") → "Ideas".

### D1 HIGH — failed reads / silent truncation → **fixed**

- `today.tsx` no longer derives failures from a newest-20 window. A dedicated
  `["/api/publications?state=failed&limit=50"]` query uses the `?state=` filter the server already supports
  (`server/content/routes.ts:1192`) — **no server change**. When that window is full
  (`length >= 50`) the attention list discloses *"Showing the 50 most recent failures; older ones may not be
  listed."*
- `today.tsx` schedule section now discloses partial reads: previously only *both* legs erroring surfaced
  anything; now one failing leg (`scheduleSectionErrored`) adds *"Some of today's schedule couldn't be
  checked — this list may be incomplete."* while keeping the surviving rows.
- `publications-view.tsx` discloses truncation: when `length >= 30` it prints *"Showing the 30 most recent
  publications. Older history is not listed here."* (`data-testid="text-publications-truncated"`).
  The `isError` → `ErrorState` branch already existed and is unchanged.

### D1 (dup keys) — **fixed**

- `today.tsx` fetched `/api/artifacts` twice on one mount under two keys
  (`?readiness=in_review&limit=10` and `?limit=5`). Consolidated to **one** key `["/api/artifacts?limit=30"]`;
  the review subset is derived by filtering `readiness === "in_review"`. **Behaviour note:** the review
  window is now "newest 30 artifacts" rather than "all in-review up to 10"; review items are actionable and
  recent, and the window is wider than before (30 > 10 + 5).
- Publications now use **one** key `?limit=30` on both `today.tsx` and `publications-view.tsx` (was `20`
  vs `30`).

### J1 MEDIUM — no primary action on `/schedule` → **fixed**

The Queue/Calendar/Publications `Tabs` moved **out of** `PageHeader`'s `action` slot and into a page-body
band (`data-testid="schedule-view-switcher"`). The header slot now holds a real primary action:
**"Create content"** → `/create` (`data-testid="button-schedule-create"`), mirroring Today's header CTA.
Rationale: `/schedule` has no compose surface of its own; the honest forward action is to create the
content that will then be scheduled. `tabs-schedule-views` and all trigger test-ids are preserved
(`e2e/canonical-ia.e2e.spec.ts:69` still passes by source inspection).

### G1(d) — tab strip overflow → **fixed**

`TabsList` is now `flex w-full max-w-full justify-start gap-1 overflow-x-auto no-scrollbar`, the pattern
`settings.tsx:376` already uses. (Note: `no-scrollbar` is undefined repo-wide per `responsive-audit.md`
finding #9; it is copied from the reference implementation verbatim and is inert, not harmful.)

### G1(a) — overlay actions clipped → **call sites hardened + reported**

The primitive fix (`ui/dialog.tsx` max-h/gutter) is W-B's. I verified my two call sites at source level and
also added `className="max-h-[90vh] overflow-y-auto"` to **my** `DialogContent` call sites so the acceptance
bar ("every overlay action reachable at 390×844") holds independently of W-B:
- `queue.tsx` Schedule dialog (`:586`) — short by construction; now also scrolls.
- `calendar.tsx` Post-details dialog (`:305`) — **the real risk**: it renders `XPostPreview` + one `Card`
  per tweet, so a long thread exceeds 844px; the "Schedule"/"Save New Time" row (`calendar.tsx:371`) was
  the clipped action. With the local cap the whole dialog scrolls and the row is reachable.
- `queue.tsx` Preview dialog already carried `max-h-[90vh] overflow-y-auto`.
Source-level only — no browser was run (see §5).

### WT-08 MEDIUM — Schedule dialogs never named the target → **fixed**

Both Schedule dialogs now render a `Target` row using `PlatformBadge` (ChannelIcon + channel), copying the
"Target" line pattern from `publish-preview.tsx`: `queue.tsx` Schedule dialog (`:597-600`) and
`calendar.tsx` Post-details schedule section (`:337-340`). No new API call — the legacy `Post` model is
single-account-per-platform (WT-08 verification), so naming the channel names the account.

### WT-08 MEDIUM — Queue button hierarchy → **fixed (hierarchy only)**

`Post to X` remains the single `variant="default"` primary per card. `Edit` was demoted `outline`→`ghost`;
`Delete` is pushed right (`ml-auto`) with `text-muted-foreground hover:text-destructive`. No control was
removed. Pagination/filter on the queue (the second half of the finding) is **not** done — it is a feature
change, see §4.

### WT-08 MEDIUM — Recent Activity flat 8-row feed → **fixed**

`today.tsx` tags each activity row `isFailure` (publication `failed`/`unknown`) and renders a `Failures`
group first (warning icon + `text-warning` heading, `data-testid="list-activity-failures"`) then a
`Routine`/`Recent` group (`data-testid="list-activity-routine"`), capped at 8 total, with a
*"Showing the N most recent updates."* disclosure when rows exceeded the cap.

### M8 — palette literals → **fixed (by semantic intent)**

| File | literals before | after |
|---|---|---|
| `agent.tsx` | 14 | 0 |
| `calendar.tsx` | 14 | 0 |
| `queue.tsx` | 2 | 0 |
| `today.tsx` | 2 | 0 |
| `workspace-cards.tsx`, `publications-view.tsx` | 0 | 0 |
| **total** | **32** | **0** |

Migration map (direction §4.4): `text-amber-600/dark:text-amber-400` → `text-warning`;
`bg-amber-*`/`border-amber-*` callout → `bg-warning/10`/`border-warning/30`;
`bg-{blue,amber,green,red}-500/10 text-{…}-500` calendar status → `bg-{info,warning,success,destructive}/10`
+ `text-{info,warning,success,destructive}`; `text-emerald-600` capability "available" → `text-success`.
Categorical pillar colours (`getPillarColor`, `CONTENT_PILLARS` hex) were left alone per §4.4 ("do not sweep
by hue"). Sub-12px classes (`text-[10px]`/`text-[11px]`) in all owned files were replaced with `text-xs`
(direction §3, LOW).

**Cross-owner dependency (important):** `--success`/`--warning`/`--info` do **not** yet exist in this
worktree's `index.css` / `tailwind.config.ts` (W-A owns them). Verified: a production build emits **0**
rules for `text-warning`/`bg-warning`/`text-success` (`grep -c` on `dist/public/assets/*.css` → `0`). The
migrated classes are correct per §4.2 but **render as no colour until W-A lands**. This is the intended
contract ("Every implementation agent codes against this file"); call it out at integration.

### Copy — exclamation → **fixed**

`queue.tsx` publish toast `"Posted to X!"` → `"Posted to X"`. Grep of all owned files for exclamations in
user strings: 0 remaining.

### W-E patch — `?prompt=` → **applied**

`agent.tsx` initial-load effect now parses `?prompt=` (in addition to `?runId=`) and seeds the composer, so
`getAskAgentUrl` (`lib/insights-state.ts:195`) no longer lands on the hardcoded default objective.

### Honest `isError` branches added (acceptance bar)

Beyond the D1 items: `calendar.tsx` best-times list (new `isError` branch + retry,
`data-testid="text-best-times-error"`), `queue.tsx` engagement/usage stats
(`data-testid="text-stats-error"`), `agent.tsx` capabilities panel (`ErrorState` instead of a fabricated
"0/0 Active"). Every `useQuery` in the owned files that renders a list/count/empty region now has an
`isError` path.

### Motion hygiene (owned files only)

`pressable` added to the hand-rolled `<button>`s in `calendar.tsx` (day chips, best-time buttons, platform
toggles, dismiss) and to `AgentRunCard`'s `<button>` in `workspace-cards.tsx`, per direction §6.

---

## 3. Verified

| Check | Result |
|---|---|
| `npm run check` (`tsc`) | clean |
| `npm run build` | succeeds (client 2992 modules, server + migrations) |
| `client/src/lib/today-schedule-state.test.ts` + `agent-workspace-state.test.ts` + `insights-state.test.ts` | 43/43 pass, 0 fail |
| Palette literals in owned files | 0 (was 32) |
| Sub-12px classes in owned files | 0 |
| Exclamation points in owned user strings | 0 |
| Duplicate react-query keys (artifacts ×2 on Today; publications 20 vs 30) | consolidated (1 artifacts key; 1 publications key) |
| Server touched | no |
| Files outside ownership touched | no |

Source-level e2e ids preserved: `tabs-schedule-views`, `alert-queue-x-compliance`,
`panel-auth-callout`, `text-auth-required`, `badge-run-status`, `panel-active-run-summary`,
`panel-agent-activity`, `panel-run-outcome-summary`, `card-tool-call-*`, `badge-run-warnings`,
`button-run-approve`, `text-artifact-empty`.

## 4. Could not do / deferred (not silently skipped)

- **K1(a)** — scheduled canonical occurrences remain invisible on `/schedule` (no consumer of
  `/api/schedule-occurrences` outside `today.tsx`). Still deferred by the coordinator as its own task.
- **Queue pagination/filter** — a feature, outside "structural change only". Recorded, not built.
- **Announcer wiring** (`motion-audit.md` #6) — not in this item's finding list; left to its owner.
- **`runtimeQuery` error UI** on Agent — the backend `Select` simply omits options on failure and
  fabricates no count; no false empty state is rendered, so no branch was added.
- **Browser/e2e not run** — Playwright needs a live server + Postgres; the G1(a) viewport claim is
  source-level (dialog content is per-tweet and has no intrinsic height cap), as is the J1 tab-overflow
  claim.

## 5. Patches needing another owner (routed)

1. **W-A (blocking integration)** — add `--success`/`--warning`/`--info` (+ `-foreground`) to `index.css`
   `.dark` and `:root` and map them in `tailwind.config.ts` per direction §4.2. Until then every migrated
   class in §2/M8 is inert. Confirmed output: built CSS contains none of these utilities.
2. **W-B** — `ui/dialog.tsx` still needs the primitive `max-h-[90vh] overflow-y-auto` +
   `max-w-[calc(100vw-2rem)]` gutter (`responsive-audit.md` #1/#3). My two call sites are hardened locally;
   other dialogs remain at risk.
3. **W-C** — `ui-shared/status-badge.tsx` still scans raw palette literals in `STATUS_TONE`
   (`text-amber-600`, `text-blue-600`, `bg-emerald-500/10`, …). `StatusBadge` is the component F1(b) now
   routes through, so its tones should move to the semantic tokens too.

---

*Report authored in the W-F worktree; commit SHA recorded on the branch `design/impl-f`.*
