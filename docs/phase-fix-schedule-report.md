# Phase fix — Schedule surface (defects: dangling `aria-controls`, skipped heading level)

Branch: `phase-fix-schedule-surface` (cut from `main` @ `4320f47`)
Files changed (exactly two, both owned):

- `client/src/pages/schedule.tsx`
- `client/src/pages/queue.tsx`

Nothing else was modified. The shared `client/src/components/ui/alert.tsx` was **not** touched.

---

## Defect 1 — HIGH / axe `critical`: dangling `aria-controls` on `/schedule`

### What was wrong

`schedule.tsx` rendered a Radix `Tabs`/`TabsList`/`TabsTrigger` strip but **no `<TabsContent>`**.
Every trigger therefore carried an `aria-controls` pointing at a panel id that did not exist
(`radix-:ra:-content-queue`, `…-calendar`, `…-publications`). The panels themselves were rendered
by a sibling ternary below the `Tabs` root, i.e. outside Radix's tab context:

```tsx
<Tabs … ><TabsList>…</TabsList></Tabs>
{activeTab === "queue" ? <QueuePage …/> : activeTab === "calendar" ? <CalendarPage …/> : …}
```

axe: `aria-valid-attr-value`, **impact: critical**, on `/schedule` in both themes.

### Fix chosen

Wrapped each existing panel in a real `<TabsContent value="…">` that matches its trigger, exactly as
`pages/insights.tsx` and `pages/settings.tsx` already do, and moved the content block **inside** the
`<Tabs>` root so Radix's context reaches it (the root became the flex-column that now owns the
switcher strip and the panel area):

```tsx
<Tabs value={activeTab} onValueChange={…} className="flex flex-col flex-1 min-h-0 overflow-hidden">
  <div className="px-4 pt-3" data-testid="schedule-view-switcher"><TabsList>…</TabsList></div>
  <div className="flex-1 overflow-hidden">
    <TabsContent value="queue"        className="h-full m-0 p-0 overflow-hidden data-[state=inactive]:hidden"><QueuePage hideHeader /></TabsContent>
    <TabsContent value="calendar"     className="h-full m-0 p-0 overflow-hidden data-[state=inactive]:hidden"><CalendarPage hideHeader /></TabsContent>
    <TabsContent value="publications" className="h-full m-0 p-0 overflow-hidden data-[state=inactive]:hidden"><div className="h-full overflow-y-auto" data-testid="container-publications"><PublicationsView /></div></TabsContent>
  </div>
</Tabs>
```

**Rationale for this option over "stop emitting `aria-controls`":** Radix `TabsContent` is rendered
only while its tab is active (no `forceMount`), so the mount/unmount behaviour is byte-for-byte the
same as the previous conditional rendering — the tabs still swap panels, only the active panel is
mounted, and no view is pre-fetched. It also makes the markup *honest*: each trigger now controls a
real `role="tabpanel"` region. Removing `aria-controls` instead would have been a workaround that
kept the fake-tabs markup. The panel content, `data-testids` (`container-publications`,
`tabs-schedule-views`, `tab-trigger-*`, `page-schedule`), and the `px-4 pt-3` switcher padding are
all unchanged; the two wrapper divs that already existed are reused.

### axe before / after (FULL rule set, both themes)

Method: Playwright + `@axe-core/playwright` `new AxeBuilder({ page }).analyze()` (default = all
rules) against `/schedule` at `E2E_PORT=4211`, theme forced via `localStorage.theme` then reload.

**BEFORE** (identical in light and dark) — 2 violations:

```json
[
  { "id": "aria-valid-attr-value", "impact": "critical", "help": "ARIA attributes must conform to valid values",
    "nodes": [ { "target": ["#radix-:ra:-trigger-queue"],
                 "html": "<button type=\"button\" role=\"tab\" aria-selected=\"true\" aria-controls=\"radix-:ra:-content-queue\" … data-testid=\"tab-trigger-queue\">",
                 "failureSummary": "Fix all of the following:\n  Invalid ARIA attribute value: aria-controls=\"radix-:ra:-content-queue\"" } ] },
  { "id": "heading-order", "impact": "moderate", "help": "Heading levels should only increase by one",
    "nodes": [ { "target": ["h5"], "html": "<h5 class=\"mb-1 font-medium tracking-tight text-sm\">Publish on your terms</h5>",
                 "failureSummary": "Fix any of the following:\n  Heading order invalid" } ] }
]
```

**AFTER** (identical in light and dark):

```json
[]
```

0 violations from the full axe rule set (not just `aria-valid-attr-value` — `heading-order` is gone
too). The three triggers' `aria-controls` now resolve:

```
tab-trigger-queue        aria-controls="radix-:ra:-content-queue"        data-state=active
tab-trigger-calendar     aria-controls="radix-:ra:-content-calendar"     data-state=inactive
tab-trigger-publications aria-controls="radix-:ra:-content-publications" data-state=inactive
```

### Why the repo's own spec missed it

`e2e/full-product-audit.e2e.spec.ts:198` and `e2e/accessibility.e2e.spec.ts` both call
`.withRules(["document-title", "meta-viewport", "button-name", "label"])` — a four-rule subset that
excludes `aria-valid-attr-value`. No change to those specs is in scope here (other files), but the
subset is the reason this shipped.

---

## Defect 2 — LOW: skipped heading level on `/schedule` (`h1 → h5`)

### What was wrong

`queue.tsx:483` rendered `<AlertTitle>Publish on your terms</AlertTitle>`, and shadcn's
`AlertTitle` is a hard-coded `<h5>` (`components/ui/alert.tsx:39`). On `/schedule`, `QueuePage` is
rendered with `hideHeader`, so the only higher heading is the page `<h1>Schedule</h1>`:

- outline before: `h1 "Schedule"` → `h5 "Publish on your terms"` (skips h2/h3/h4)
- axe: `heading-order`, impact moderate.

### Fix chosen (call site)

Replaced the `<AlertTitle>` call site with the heading at the correct level — `<h2>`, the same level
the queue's own section headings (`Drafts`, `Ready to Post`, …) use — carrying `AlertTitle`'s exact
classes so it renders identically:

```tsx
<Alert className="mt-3 max-w-3xl" data-testid="alert-queue-x-compliance">
  <ShieldCheck className="h-4 w-4" />
  <h2 className="mb-1 text-sm font-medium leading-none tracking-tight">Publish on your terms</h2>
  <AlertDescription …>…</AlertDescription>
</Alert>
```

`AlertTitle` was removed from the `@/components/ui/alert` import (it is used nowhere else in the
file). The `Alert` box, its `<ShieldCheck>` icon, the description text/link, and the
`data-testid="alert-queue-x-compliance"` are unchanged; `Alert`'s `[&>svg~*]:pl-7` sibling rule still
applies to the heading exactly as it did to the `<h5>`.

### Heading outline before / after (`h1..h6` in DOM order, `/schedule`)

```
BEFORE:  h1 "Schedule"  →  h5 "Publish on your terms"          (skip)
AFTER:   h1 "Schedule"  →  h2 "Publish on your terms"          (no skip)
```

### Recommendation for `alert.tsx` (not applied — file not owned)

The systemic fix is to let `AlertTitle` be polymorphic, e.g. accept an `as`/`asChild` prop
(defaulting to the current `<h5>`) so call sites can pick the level for their outline. That would be
a shared-component change with callers other than this page, so it is left as a recommendation; the
call-site fix above is self-contained and removes the violation.

---

## Verification performed

Environment: `E2E_PORT=4211`, `DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e`
(ephemeral Postgres, already migrated · `[db] database migrations applied` on boot). Production
bundle built with `npm run build`, served with `NODE_ENV=production PORT=4211 DISABLE_CRON=1
SESSION_COOKIE_SECURE=0 CONTENTFORGE_E2E_SERVER=1` (+ `SESSION_SECRET`, required in production).

1. **`npm run check` (tsc): clean. `npm run build`: clean** (client + server bundle).
2. **Full-rule axe on `/schedule`, light + dark: before = 2 violations (incl. `aria-valid-attr-value`/critical),
   after = `[]` (0).** Both themes verified. See output above.
3. **Heading outline:** `h1 → h2`, no skipped level (was `h1 → h5`).
4. **Schedule surface still works:** default Queue panel renders
   (`alert-queue-x-compliance` visible), Calendar ⇄ Queue ⇄ Publications switching works
   (`button-best-times`, `container-publications` appear), and the active queue panel's rendered text
   is byte-identical before and after:
   `"Schedule Plan, queue, and monitor scheduled publications Create content Queue Calendar Publications
   Publish on your terms Only you (or your schedule) sends to X … Nothing here yet. Go to Discover and
   click Create Draft on any idea."`
5. **Existing specs re-run:**
   - `e2e/today-schedule.e2e.spec.ts`, `e2e/canonical-ia.e2e.spec.ts`, `e2e/accessibility.e2e.spec.ts`,
     `e2e/routes.e2e.spec.ts` → **72 passed / 0 failed** (includes "Schedule view switcher toggles
     between Queue and Calendar", "Journey G: Schedule has 3 tabs…", "Journey I: mobile Schedule…",
     axe `/schedule` + `/schedule?tab=publications`, and all legacy-route redirects incl. `/queue`).
   - `e2e/phase-33.2-ia-ux-accessibility.e2e.spec.ts`, `e2e/error-states.e2e.spec.ts`,
     `e2e/create-workflow.e2e.spec.ts`, `e2e/full-product-audit.e2e.spec.ts` → **96 passed / 1 failed**.
     The single failure is `error-states.e2e.spec.ts:20 "Discover: forced 500 shows ErrorState…"`,
     which is **pre-existing**: it fails identically on pristine `main` (verified by `git stash` +
     rebuild + rerun of this same group) and is unrelated to the Schedule surface.

### Flakiness observed (recorded for honesty)

The first post-change run of the second spec group above reported 8 failures (artifact-review reject
flows, Agent Workspace review, legacy redirects, Create deep links, Today attention, theme toggle).
A clean re-run of the identical command against the identical bundle reported only the pre-existing
`error-states` failure; those 7 are nondeterministic under parallel load and none touch the Schedule
surface or the two files changed here. Baseline (`main`, no changes) confirmed the same pre-existing
`error-states` failure.

## Not verified / caveats

- Full `npx playwright test` suite was **not** run (focused runs only, per scope).
- axe reported the dangling `aria-controls` on one node (the active `Queue` trigger) even though all
  three triggers had dangling references (confirmed via an `aria-controls` dump). After the fix the
  full rule set reports zero, so all three now resolve; the node-count asymmetry in the "before"
  output is axe's, not a gap in the fix.
- The shared `alert.tsx` `AlertTitle` still hard-codes `<h5>`; other call sites outside this scope may
  still produce heading-order skips (recommendation above).
