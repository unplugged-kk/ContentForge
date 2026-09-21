# Evidence Ledger

Part of the ContentForge UX intelligence package. Discovery only: no production code was modified, nothing was redesigned, and no scores, personas, analytics or requirements were invented.

This file is the audit trail. Every finding in the other documents traces to a row here.

## 1. Confidence labels

| Label | Meaning |
|---|---|
| HIGH | Observed directly in the running app, measured by a tool, or read verbatim in code, and reproducible. |
| MEDIUM | Read in code but not exercised at runtime, or observed only under a sandbox condition, or a vendor's own statement. |
| LOW | Seen once or not systematically checked. |
| HYPOTHESIS | An inference about user impact or benefit. Not evidence. Needs validation with the owner or usage data. |

Severity (High / Medium / Low) in the findings is the auditor's judgement of impact on the operator's stated goal. It is a label, not a computed score.

## 2. How the evidence was gathered

| Item | Detail |
|---|---|
| Repo | `/Users/kishore/git/ContentForge` (React 18 + TypeScript + Vite 7 + Tailwind 3.4 + shadcn/ui; Express 5 + Drizzle + PostgreSQL + pg-boss). Read-only. A working copy was run in a cloud sandbox. |
| Running app | Local dev server with a fresh PostgreSQL database and one newly registered account ("Audit User"). The app's own placeholder flag `CONTENTFORGE_E2E_SERVER=1` was used, with the AI base URL pointed at a dead local port so that no real AI, X or other external calls were made. |
| Browser | Playwright with Chromium. 22 routes (21 sidebar destinations plus the 404 page) at 1440x900 dark, 1440x900 light, 820x1180 dark and 390x844 dark. That is 88 page runs. |
| Automated a11y | axe-core on all 88 runs. |
| Behaviour probes | Scripted flows: login errors, register validation, Generate error, Quick Capture invalid URL, Queue delete, keyboard tab order, mobile Agent Workspace reachability, fixture agent run (2/6/12/25 s), Calendar post detail, Settings tabs, forced 500 on GET requests, slowed Queue response. |
| Code reads | App shell, sidebar, Generate, Queue, Calendar, Settings, Auth, Agent Workspace and its components, query client, CSRF client, theme, quick capture, CSS tokens, Tailwind config, `index.html`, server route files for hidden capabilities. |
| Repo docs | Product spec and handoff notes for intent, scope and planned-but-unbuilt screens. |
| Web research | Vendor product pages and standards pages listed in section 7. Re-fetched during the final pass so URLs are exact. |

## 3. Limits of this evidence

These matter when weighing any finding.

1. **Sandbox network.** Google Fonts and CopilotKit's `announcements.json` requests failed with tunnel errors. The roughly 2.2 s page loads and the console error on every page come from this and are **not reported as app findings**. The 25-family font request is reported only as a code-level finding (UX-31).
2. **AI backend unreachable by design.** Generation success paths (variations, viral score, optimize, hooks, carousel, images) were not observed. Only their error paths were.
3. **Research fetch failed in the sandbox.** The fixture agent run ended with "ResearchJob 1 is failed". The misleading status wording is real UI behaviour (UX-10). The failure itself is an environment effect.
4. **No real data.** One empty account. No real posts, analytics, usage history or the operator's actual queue. Layout at realistic data volume is unverified.
5. **Dev mode only.** The CopilotKit "Runtime error - Open Inspector" pill and the "Lit is in dev mode" warning may not appear in a production build. The 403 itself is a server response and does not depend on dev mode.
6. **No publishing.** Nothing was posted to X or any platform. Publish, schedule-fire and failed-publish recovery were read in code, not exercised end to end.
7. **No usage evidence.** There are no analytics on which pages the operator actually opens. Every IA recommendation is therefore a hypothesis until that is known.
8. **Single viewport per breakpoint, one browser engine.** No Safari or Firefox. No real touch device (touch emulation only).
9. **Not evaluated:** performance timing, screen-reader speech output, colour-blind simulation, print, i18n, and spacing/typography scale conformance beyond what is noted in the design-system audit.

## 4. Findings ledger

36 findings: 11 High, 15 Medium, 10 Low.

| ID | Evidence (facts observed or read) | Heuristic / standard | Confidence |
|---|---|---|---|
| **UX-01** Quick Capture button is mispositioned on every breakpoint | Measured: computed position is `relative`, not `fixed` (rect x=216 at 1440px, x=-24 at 390px). Cause: `.hover-elevate { position: relative }` at client/src/index.css:248-253 overrides `.fixed` set at quick-capture.tsx:55. Screenshot: generate-desktop-dark.png. | Consistency & standards | HIGH |
| **UX-02** Destructive actions have no confirmation and no undo | 13 `"DELETE"` call sites in 13 pages (articles, calendar, canned-responses, carousel, discover, ideas, imagegen, ingest, queue, references, settings, vault, youtube). `components/ui/alert-dialog.tsx` exists but is imported by 0 files. Verified live: Queue delete showed 0 dialogs and removed the card (flow-queue-after-delete.png). Settings 'disconnect account' is one click (settings.tsx:163-279). | User control & freedom; Error prevention | HIGH |
| **UX-03** Failed reads look like empty data | No page handles a query error (0 `isError` matches in client/src). With GETs forced to 500: Queue 'Nothing here yet', Ideas 'No ideas yet', Analytics zeros, Calendar empty, Discover '0 ideas', Settings shows 'Connect' for X/Threads/LinkedIn (state-*-error.png). queryClient.ts:85-90 sets retry:false. | Visibility of system status; Recover from errors | HIGH |
| **UX-04** Error toasts show raw status + JSON | queryClient.ts:7 throws `${res.status}: ${text}`. Observed toasts: `500: {"message":"Failed to generate content. Please try again."}`, `400: {"message":"Could not fetch URL: ... Try pasting the content instead."}`, `401: {"message":"Invalid email or password"}`. | Help users recognize, diagnose, recover from errors | HIGH |
| **UX-05** Settings > AI Provider shows hardcoded 'Connected / Active' status | settings.tsx:446-465 hardcodes 'Powered by Replit AI Integrations', a green 'Connected' badge, 'OpenAI (via Replit)', 'gpt-4o-mini', and 'billed to your Replit credits'. Observed while the AI backend was intentionally unreachable: the tab still said Connected. | Visibility of system status | HIGH |
| **UX-06** Agent Workspace 'Schedule' is fixed to now + 60 seconds | artifact-review.tsx:137 `const startAt = new Date(Date.now() + 60_000).toISOString();` - no date/time input. Calendar's dialog (calendar.tsx) already has a real picker, so two different scheduling behaviours coexist. | Consistency & standards; User control | HIGH |
| **UX-07** Approve and 'Publish Now' sit side by side with no confirm and no target preview | artifact-review.tsx buttons: Edit, Regenerate, Submit for review, Approve, Schedule, Publish Now (line ~249). Publish targets `artifact.channel` (line 152) without showing account or rendered post. Success gives no toast. | Error prevention; Visibility of system status | HIGH |
| **UX-08** Run-level 'waiting for approval' has no approve/deny control | agent.tsx renders 'Privileged action requires explicit user authorization.' when `view.waitingForApproval`; backend has POST /runs/:id/resume (server/agent/routes.ts:248) but the client never calls it. Code-level finding: this state was not reached in the live fixture run. | Visibility of system status; User control | MEDIUM |
| **UX-09** CopilotKit provider fires an un-tokened POST (403) on every Agent Workspace load | copilot-provider.tsx:24 mounts `<CopilotKit runtimeUrl="/api/agent/agui">`; its POST carries no `X-CSRF-Token`, so middleware/csrf.ts returns 403 `Invalid or missing CSRF token`. In dev the 'Runtime error - Open Inspector' pill overlaps the header (flow-agent-run-25s.png, top right). No `useCopilot*`/`CopilotChat` usage exists anywhere in client/src, so the provider has no visible function. | Visibility of system status | HIGH (403) / MEDIUM (overlay in production) |
| **UX-10** Agent run status contradicts its own tool calls | Fixture run in a sandbox where research sources could not be fetched: run badge 'completed' while 'create story' shows 'completed' with an error body, 'repurpose story' 'failed: storyId Required', and a red validation_error line (flow-agent-run-25s.png). Environment triggered the failure; the misleading status semantics are real UX behaviour. | Visibility of system status | MEDIUM |
| **UX-11** Agent Workspace collapses into cramped nested scroll panes on tablet/mobile | agent.tsx uses `lg:grid-cols-[18rem_1fr_24rem]` inside `h-full overflow-hidden`. At 390px: inner scrollers aside sh=334/ch=232 and sh=1502/ch=232; document itself does not scroll; 'Artifact review' is the last of 6 stacked right-rail panels (agent-mobile-dark.png). | Flexibility & efficiency | HIGH |
| **UX-12** 21-item flat sidebar; bottom group clipped at 900px height | app-sidebar.tsx: Create 11, Research 5, Manage 5. At 1440x900 the Manage group is cut off after 'Calendar' (generate-desktop-dark.png). 22 tab stops (21 links + logout) precede page content. | Recognition rather than recall; Aesthetic & minimalist | HIGH |
| **UX-13** Two parallel content models surface in different places | Legacy posts/tweets drive Generate, Queue, Calendar, Analytics, Discover, Ingest. The canonical pipeline (ResearchJob > Story > Opportunity > Artifact > Schedule > Publication > Result > LearningSignal) is reachable only in Agent Workspace. Inferred from the separate data sources (not tested end to end): a post saved from Generate does not appear in Artifact review, and an artifact does not appear in Queue. | Consistency & standards; Match with real world | HIGH |
| **UX-14** Five overlapping entry points for bringing external content in | Ingest, References (H1 'Source Analysis'), Quick Capture, YouTube > Post, and Vault URL extraction all accept a URL or text. Quick Capture posts to /api/ingest and has no paste-text option although the server error says 'Try pasting the content instead'. | Consistency & standards | HIGH |
| **UX-15** Ideas and Discover overlap | Ideas Bank (manual) and Idea Discovery (scanned) both hold ideas that turn into drafts; discover.tsx has its own idea > dialog > create draft > publish/schedule flow. Whether the operator treats them as one list is unverified (needs usage data). | Match between system and real world | MEDIUM |
| **UX-16** Nav labels differ from page titles | References > 'Source Analysis'; Articles > 'X Articles'; Discover > 'Idea Discovery'; Ingest > 'Ingest Content'; Generate > 'Generate Content'; YouTube > Post > 'YouTube > X Post'. | Consistency & standards | HIGH |
| **UX-17** Domain jargon leaks into the interface | Visible strings: 'Artifact 12', 'Revision 1 #5', 'ResearchJob 1', 'Source Content UNTRUSTED', 'Retry continue', backend select 'fixture', subtitle 'CopilotKit + AG-UI over ContentForge Agent Runtime'. | Match between system and real world | HIGH |
| **UX-18** Four near-identical compliance banners | Queue, Discover, Ingest and References each carry a similar 'official API / no scraping / you approve' banner, hand-built per page. | Aesthetic & minimalist | HIGH |
| **UX-19** The core daily path detours through the Queue | Generate offers only 'Save as Draft' (POST /api/posts) plus a toast with no link. To schedule: navigate to Queue and open its Schedule dialog (queue.tsx:415 offers Schedule on drafts, so Mark Ready is optional). Generate has no Schedule or Post action. | Flexibility & efficiency; Visibility of system status | HIGH |
| **UX-20** Dead-end copy: 'Threads publishing coming soon' | queue.tsx shows the copy for Threads posts while Generate offers Threads and X + Threads as first-class platform choices. | Match between system and real world | HIGH |
| **UX-21** Draft cards show 0 likes / retweets / views | Queue draft cards render engagement counters that cannot yet exist (queue-desktop-dark.png). | Aesthetic & minimalist | HIGH |
| **UX-22** No auto-refresh while a background scheduler publishes | queryClient.ts:85-86 `staleTime: Infinity`, `refetchOnWindowFocus: false`; Queue overrides to 5 minutes. Server scheduler runs every minute. Fact: HIGH. Effect on the operator's trust in status: HYPOTHESIS (not observed with a live publish). | Visibility of system status | MEDIUM |
| **UX-23** No document title; browser zoom disabled | axe on 88 page runs: `document-title` 88/88, `meta-viewport` 88/88. client/index.html:5 `maximum-scale=1`; no <title>. WCAG 2.4.2 and 1.4.4. | WCAG 2.4.2, 1.4.4 | HIGH |
| **UX-24** Icon-only controls without accessible names | axe `button-name` (critical) on 88/88 runs, 272 nodes: theme toggle and Quick Capture on every page; delete buttons (ideas, queue), calendar prev/next, chat send, Generate viral-score and regenerate icons. | WCAG 4.1.2 | HIGH |
| **UX-25** No navigation landmark or skip link | `nav` count 0 on every page; axe `region` 66/88 runs, 1782 nodes; no skip link; 22 tab stops before content. WCAG 2.4.1 Bypass Blocks. | WCAG 2.4.1 | HIGH |
| **UX-26** Agent composer textarea has no label | axe `label` (critical) on the Agent page in 4 of 4 runs. | WCAG 1.3.1 / 3.3.2 | HIGH |
| **UX-27** Many controls are under 44px; some under 24px | Per page, 25-50 visible interactive elements are under 44x44 CSS px. Under 24px (WCAG 2.5.8 floor, before exceptions): Agent 4, Calendar 4, Settings 3, Ingest/Discover/References/Queue 1 each. Spacing exceptions were not evaluated. | WCAG 2.5.8 | HIGH |
| **UX-28** 404 page: light background, near-invisible heading in dark mode, developer copy | not-found.tsx:6-15 `bg-gray-50`, `text-gray-900`, 'Did you forget to add the page to the router?'. axe `color-contrast` flags it (notfound-desktop-dark.png). | Match with real world; Consistency | HIGH |
| **UX-29** Auth form: silent disabled submit, hidden password rule, raw error toast | Login submit is disabled with no title/aria-describedby (auth-flow.json). Register: the >=6 character rule is revealed only by a server 400 toast. Wrong credentials toast: `401: {"message":"Invalid email or password"}`. | Error prevention; Recover from errors | HIGH |
| **UX-30** Mobile layout defects on Generate, Calendar and Settings | At 390px: Generate 4-button platform row clips; Calendar title wraps into the controls and chips truncate ('3 y...'); Settings tab list is cut off ('Conten...'). (generate-mobile-dark.png, calendar-mobile-dark.png, settings-mobile-dark.png). No document-level horizontal overflow measured. | Consistency & standards | HIGH |
| **UX-31** ~25 Google Font families requested; only Open Sans is used | client/index.html:9 requests ~25 families; index.css sets `--font-sans: Open Sans`. Load time could not be measured (sandbox blocks Google Fonts). | Aesthetic & minimalist | HIGH (code) / HYPOTHESIS (perf impact) |
| **UX-32** No command palette; one global shortcut | `components/ui/command.tsx` (cmdk) exists but is imported nowhere. The only shortcut is Cmd/Ctrl+Shift+I (quick-capture.tsx:36). Typefully lists keyboard shortcuts as a feature. | Flexibility & efficiency | HIGH |
| **UX-33** Theme: dark by default, no system preference, unlabeled toggle | theme-provider.tsx defaults to dark and stores 'theme' in localStorage; toggle is light/dark only; theme-toggle.tsx has no aria-label. | Flexibility & efficiency | HIGH |
| **UX-34** Personal copy and pillars hardcoded in code | Sidebar footer fallback 'Infra Engineering Lead'/'Kishore Kumar'; content pillars in client/src/lib/constants.ts; Settings > Content Pillars is read-only. Consistent with the single-operator scope; noted, not a defect today. | - | HIGH |
| **UX-35** Design tokens: zero-alpha shadows, uneven page headers, reused icon | `--shadow-*` tokens are effectively transparent; page headers vary (icon vs none, text size); the Bot icon represents both Agent Workspace and AI Usage. | Consistency & standards | HIGH |
| **UX-36** Analytics chart: overlapping y-axis labels | Seen once in analytics-desktop-dark.png; not systematically checked across data sizes. | Aesthetic & minimalist | LOW |

## 5. Measurements

### 5.1 Counts read from code

| Measurement | Value | How |
|---|---|---|
| Client routes | 21 plus a catch-all 404 | `client/src/App.tsx` lines 38-59 |
| Sidebar destinations | 21 (Create 11, Research 5, Manage 5) | `app-sidebar.tsx` |
| Distinct client API paths | 127 | grep of `"/api/..."` string and template literals in `client/src` |
| Server route registrations | about 270 | grep of `router.<verb>(` and `app.<verb>(` in `server/` |
| `"DELETE"` call sites in the client | 13, one in each of 13 pages | grep |
| Pages importing `alert-dialog` | 0 | grep |
| Pages handling a query error state (`isError`) | 0 | grep |
| shadcn primitives in `components/ui` | 47, of which 17 are imported outside `ui/` | grep |
| Files that use `useCopilot*`, `CopilotChat`, `CopilotSidebar` | 0 | grep |
| Global keyboard shortcuts | 1 (Cmd/Ctrl+Shift+I) | `quick-capture.tsx:36` |

### 5.2 axe-core (88 runs, 22 routes x 4 viewport/theme combinations)

| Rule | Impact (axe) | Runs affected | Nodes | Note |
|---|---|---|---|---|
| button-name | critical | 88 / 88 | 272 | Theme toggle and Quick Capture on every page, plus delete, prev/next, send and icon actions |
| document-title | serious | 88 / 88 | 88 | No `<title>` |
| meta-viewport | moderate | 88 / 88 | 88 | `maximum-scale=1` |
| color-contrast | serious | 70 / 88 | 100 | 66 of the 70 runs are one element: the sidebar avatar initials (`bg-primary/20`). Others: one calendar out-of-month cell, one `1:1` label, one 11px link. **Contrast is not a systemic problem.** The 404 heading is the one large failure. |
| region | moderate | 66 / 88 | 1782 | No `nav` landmark; content outside landmarks |
| heading-order | moderate | 36 / 88 | 36 | h5 banners; h3 before h2 on Templates |
| svg-img-alt | serious | 20 / 88 | 84 | react-icons X/Threads logos with `role="img"` and no title |
| scrollable-region-focusable | serious | 8 / 88 | 8 | Templates, AI Usage scroll containers |
| label | critical | 4 / 88 | 4 | Agent composer textarea |
| landmark-unique | moderate | 4 / 88 | 4 | Agent left aside |
| empty-table-header | minor | 4 / 88 | 4 | AI Usage table |

Positive results: every route has exactly one `<h1>`; `<html lang="en">` is set; `main` landmark present; both themes were captured and checked with axe.

### 5.3 Interactive element size (custom probe, desktop dark 1440px)

Between 25 and 50 visible interactive elements per page are under 44x44 CSS px. Elements under 24x24 (the WCAG 2.5.8 floor before its spacing exceptions): Agent 4, Calendar 4, Settings 3, and 1 each on Ingest, Discover, References and Queue. Spacing exceptions were not evaluated, so these are candidates, not confirmed failures. Chart: `visuals/02-accessibility-measurements.png`.

### 5.4 Quick Capture position (custom probe)

| Viewport | Computed `position` | Bounding rect x |
|---|---|---|
| 1440 px | relative | 216 (under the sidebar edge) |
| 820 px | relative | 216 |
| 390 px | relative | -24 (partly off-screen) |

Cause: `client/src/index.css:248-253` gives `.hover-elevate` `position: relative`, which overrides the `fixed` utility in `quick-capture.tsx:55`.

## 6. Screenshot index

All files are in `evidence-screenshots/`.

| File | Shows | Supports |
|---|---|---|
| 01-generate-desktop-fab-and-clipped-nav | Generate page: Quick Capture half under the sidebar, nav cut off after Calendar | UX-01, UX-12 |
| 02-agent-workspace-run-status-and-copilot-pill | Agent run after 25 s: "completed" badge with failed tool calls, CopilotKit pill top right | UX-09, UX-10, UX-17 |
| 03-agent-workspace-mobile | Agent Workspace at 390 px | UX-11 |
| 04-queue-desktop | Queue with zero-metric draft cards | UX-21 |
| 05-queue-api-failure-looks-empty | Queue when GET returns 500 | UX-03 |
| 06-settings-api-failure-looks-disconnected | Settings when accounts GET returns 500 | UX-03 |
| 07-settings-ai-provider-hardcoded-status | AI Provider tab with static "Connected" | UX-05 |
| 08-404-dark-mode | 404 page in dark mode | UX-28 |
| 09-queue-after-delete-no-confirm | Queue immediately after one click on delete | UX-02 |
| 10-generate-mobile | Generate at 390 px, platform row clipped | UX-30 |
| 11-calendar-mobile | Calendar at 390 px | UX-30 |
| 12-settings-mobile | Settings tab list cut off | UX-30 |
| 13-login-raw-error-toast | Wrong-credentials toast with status and JSON | UX-04, UX-29 |
| 14-quick-capture-raw-error | Quick Capture invalid URL error | UX-04, UX-14 |
| 15-calendar-post-detail-good-pattern | Calendar post dialog with preview and date/time picker | Positive reference for UX-06 |

The full set of 124 captures (22 routes x 4 combinations plus flows and states) remains in the audit workspace.

## 7. Web sources

Fetched in the final pass. Vendor pages are the vendors' own descriptions of their products. Nothing was trialled hands-on, so competitive statements are MEDIUM confidence at most.

- Typefully: https://typefully.com
- Postiz: https://postiz.com
- Buffer: https://buffer.com
- Hypefury: https://hypefury.com
- Taplio: https://taplio.com
- Publer: https://publer.com
- CopilotKit documentation: https://docs.copilotkit.ai
- Claude Code permissions: https://code.claude.com/docs/en/permissions
- Nielsen Norman Group, 10 usability heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/
- WCAG 2.2 SC 2.5.8 Target Size (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- WCAG 2.2 SC 2.4.1 Bypass Blocks: https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html

Two further sources were tried and returned nothing usable (Microsoft HAX guidelines, Google PAIR). They are not cited.

## 8. Claims deliberately not made

- No claim about which pages the operator uses most.
- No claim that any competitor feature would improve the operator's revenue-share outcome.
- No independent claim about X platform-policy compliance of any automation. The app's own stated stance (Queue banner) and the repo's compliance document (`docs/X_API_COMPLIANCE_AND_RISK.md`) are cited as the owner's position, not as verified X policy.
- No estimate of effort, time or cost for any recommendation.
