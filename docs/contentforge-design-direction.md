# ContentForge — Design Direction

**Phase:** 3 (Design Strategy)
**Date:** 2026-09-26
**Status:** **Source of truth.** Every implementation agent codes against this file. Where this
file and an agent's own preference disagree, this file wins.
**Register:** Product — an authenticated single-operator instrument.
**Non-negotiable boundary:** `docs/ux-audit/DONT_BUILD.md` **D9 forbids a visual re-skin.**
This document changes tokens, states, semantics and structure. It does not change the visual
direction of the product.

---

## 1. The one sentence

**Make the existing system true to itself.** ContentForge already has a real token layer, a
real motion system, a real type scale, and an honestly-designed state model. The remaining
defects are places where the UI contradicts its own system — a palette literal where a token
belongs, a focus ring removed where the system promises one, a failed read rendered as an
empty state, a motion token defined but never applied.

No new visual language. No new component family. No second system.

---

## 2. Principles, in priority order

1. **Truth before polish.** A state that lies is worse than a state that is ugly. An
   indeterminate result must never render as a clean one. This outranks every other
   principle here.
2. **One concept, one representation.** A status is a token, not a hex. An empty region is
   `EmptyState`, not a hand-rolled card. If the same idea renders two ways, that is a defect
   regardless of which rendering is prettier.
3. **The five-minute budget.** The operator has 5 minutes a day. Every screen is judged by
   *does this get them to a decision faster?* Detail is progressively disclosed, never
   deleted.
4. **Density without clutter.** High information density is a feature here. Clutter is
   competing visual weight, not small type. The remedy for clutter is hierarchy and
   grouping, never hiding information the operator needs.
5. **Calm and quiet.** Restraint is the aesthetic. No decorative motion, no gradient, no
   ornament. When in doubt, remove.
6. **Access is the floor.** Not an axis to trade against. Zero axe violations on all seven
   destinations; 3:1 focus indicators; 44×44 touch targets; `prefers-reduced-motion`
   honoured; never colour alone.

---

## 3. Typography

The scale already exists in `client/src/index.css`. **Do not invent a new one.**

| Role | Token | Value | Use |
|---|---|---|---|
| Page title | `text-lg`/`text-xl` semibold | — | `PageHeader` h1 only |
| Section | `text-base` semibold | — | section h2 |
| Sub-section | `text-sm` medium | — | group labels |
| Body | `text-sm` | 14px | default |
| Dense | `--text-dense` | 13px | table cells, evidence metrics |
| Meta floor | `--text-meta` | 12px | timestamps, labels, badges |

**Rules**
- **12px is the floor.** The existing floor rule (`index.css:230-234`) is now correctly
  placed outside `@layer base` and wins the cascade. Do not add new sub-12px values; do not
  remove the floor rule.
- **Replace the 188 arbitrary `text-[10px]/[11px]/[9px]` classes with scale names** where you
  own the file. They currently resolve to 12px via the floor, so this is a correctness and
  readability migration, not a visual change. It is LOW priority — do not let it block a
  higher-rated finding.
- `--font-mono` stays reserved for timestamps and dense numeric cells.
- Sentence case everywhere. No exclamation points, in any string, ever.
- Labels are never placeholders.
- Hierarchy comes from weight and spacing contrast, not from a wider range of sizes.

---

## 4. Colour — the token contract

### 4.1 The defect

250 raw Tailwind palette literals bypass the token layer, and the consequence is measurable:
`text-green-500` = **2.28:1**, `text-amber-600` = **3.02:1**, `text-blue-500` = **3.42:1** on
light surfaces. All below AA. Additionally `--destructive: 0 84% 42%` is byte-identical in
light (`index.css:37`) and dark (`:139`), so error text lands at **3.04:1** on the dark
surface.

### 4.2 The contract — exact token names (fixed; do not rename)

Add to **both** `:root` and `.dark` in `client/src/index.css`:

```
--success: <hsl triple>;
--success-foreground: <hsl triple>;
--warning: <hsl triple>;
--warning-foreground: <hsl triple>;
--info: <hsl triple>;
--info-foreground: <hsl triple>;
```

Semantics — this is the whole contract, and it is deliberately only two values per role:

| Token | Meaning | Threshold it must clear |
|---|---|---|
| `--{role}` | The role's **text and border** colour when used on a normal surface, and the source for tinted fills and borders via alpha (`bg-success/10`, `border-success/30`). | **≥ 4.5:1** against `--background`, against `--card`, and against itself at 10% alpha composited over both. |
| `--{role}-foreground` | Text placed **on a solid `--{role}` fill**. | **≥ 4.5:1** against `--{role}`. |

Map in `tailwind.config.ts` following the file's existing convention exactly:
`success: "hsl(var(--success) / <alpha-value>)"`, `"success-foreground": …`, and likewise for
`warning` and `info`.

**Also fix** `--destructive` in `.dark` so error text clears 4.5:1 on `0 0% 8%`.

**Delete** `tailwind.config.ts:78-83`'s `status.*` namespace (0 consumers, raw `rgb()`) and
`lib/constants.ts:35`'s `POST_STATUSES` (0 consumers). Two dead status vocabularies is how a
third one gets invented later.

### 4.3 Measured values are required, not optional

The implementing agent must **compute** each value against WCAG relative luminance, alpha-
composited in sRGB, and paste the resulting contrast table into its change report. Required
rows, light and dark: each `--{role}` against `--background`, `--card`, and its own 10% tint
composited over `--background`.

`--warning` is the hard one: amber at 4.5:1 on white requires a very dark amber. If the only
values that clear the threshold look wrong next to the rest of the palette, **report the
tension** rather than silently shipping a value that fails. This product's rule is that
status is never rounded down, and that applies to the token table too.

### 4.4 Migration rule

Replace literals **by semantic intent**, verified per call site:

| Old | New |
|---|---|
| `text-emerald-600 dark:text-emerald-400`, `text-green-500` | `text-success` |
| `bg-emerald-500/10`, `bg-green-500/10` | `bg-success/10` |
| `border-emerald-500/30` | `border-success/30` |
| `bg-emerald-700 hover:bg-emerald-800 text-white` (a solid button) | `bg-success text-success-foreground` |
| `text-amber-600 dark:text-amber-400`, `text-orange-*` | `text-warning` |
| `text-blue-600 dark:text-blue-400`, `text-sky-*` | `text-info` |
| `text-red-*`, `text-rose-*` | `text-destructive` |

**Do not sweep by hue.** Migrate the sites that carry **semantic meaning** — status, success,
failure, warning, informational feedback. Leave **categorical and decorative** uses alone:
chart series (they use `--chart-N`), carousel artwork fills, and `x-post-preview.tsx`'s
platform-brand colours, which are reproducing another product's identity and are correct as
literals. Abstraction for its own sake is excluded.

**Unreachable files are excluded.** `/discover`, `/generate`, `/ideas`, `/canned-responses`
are `LegacyRouteRedirect`s with no live mount (`App.tsx:97-115`). Their literals do not
ship. Do not spend budget there.

**Ownership:** each workstream migrates the literals **in the files it owns** (§7). One file,
one writer. An agent that finds a literal in a file it does not own writes the exact patch
into its change report; it does not edit.

---

## 5. The component system

### 5.1 Status

One component: `components/ui-shared/status-badge.tsx`. One vocabulary. Every status the
product can render is a key in `STATUS_LABEL` / `STATUS_VARIANT` / `STATUS_TONE`.

**Non-colour signal is required.** No state may be distinguished by colour or animation
alone:

| State | Required non-colour signal |
|---|---|
| `generating`, `running` | a spinner glyph |
| `waiting_for_approval` | a clock glyph |
| `queued`, `scheduled` | a clock or dot glyph |
| `approved`, `published`, `completed` | a check glyph |
| `failed`, `blocked`, `rejected` | an alert glyph |
| `completed_with_errors` | an alert glyph, distinct from `failed` |
| `unknown` | a question glyph |

The pulse stays as **reinforcement only**. It must never be the differentiator, because
`prefers-reduced-motion` removes it entirely (`index.css:426-428`) and `generating` and
`running` currently collapse to identical pixels.

`ActorBadge` is the model to follow: three states, each with a distinct icon **and** a
distinct word, pinned by an e2e assertion. Every other badge should look like it.

### 5.2 Empty, error, loading

Three shared components, and they are mandatory:

- `EmptyState` — teaches the space (what belongs here, why it matters, what action fills it).
  Bare labels are not empty states.
- `ErrorState` — names what broke and what to do next, and never frames the operator as the
  cause.
- `Skeleton` — for content regions. Spinners are for actions, not for page loads.

**The rule that matters most in this whole document:**

> **A failed read must never render as an empty or zero state.**
> An absent `isError` branch is indistinguishable from a true empty result. Every `useQuery`
> that renders a list, a count, or an empty state must handle `isError` and say so.

`today.tsx` already does this correctly for its other regions. Copy that pattern; do not
invent a new one.

### 5.3 Cards

Cards are for genuinely card-shaped content: discrete, self-contained, scannable as a unit.

- **Never one card inside another.** Flatten with type, spacing and dividers. Four rounded
  bordered boxes inside a Card is the anti-pattern this direction removes.
- Metrics are **rows or a table**, not a grid of tiles. `learning-view.tsx:1561` already
  contains the correct treatment for the same kind of data; use it.
- Do not add a wrapper that exists only to hold padding.
- `CardTitle`'s `text-2xl` default is a **latent footgun** (all 41 call sites currently
  override it). Reduce the default to `text-base` so the component stops fighting its
  consumers. This is hygiene, not a visual change.

### 5.4 Buttons

Existing hierarchy in `components/ui/button.tsx` is correct: `default` (primary) →
`secondary` → `outline` → `ghost` → `destructive` → `link`.

- **One primary action per surface.** Where a tab strip currently occupies
  `page-header.tsx`'s primary-action slot, separate the two: tabs belong to the page body,
  the slot belongs to the action.
- One verb per button, naming the action. Not OK, Confirm, or Yes.
- A **disabled** primary action must not be the only explanation. If `Approve` is disabled
  because the artifact is unapproved, the reason must be visible.
- Destructive and authoritative actions are visually distinct **without** becoming louder
  than the primary workflow.

### 5.5 Dialogs, sheets, overlays

- Every `DialogContent` / `AlertDialogContent` gets `max-h` + `overflow-y-auto` on its body.
  **An action that can be scrolled out of an un-scrollable overlay is a broken screen.**
- Small-viewport gutters: `w-full max-w-lg` at 390px is exactly `100vw`. Reserve a gutter.
- Entrances and exits use the motion tokens (§6). **Exits are shorter than entrances.**
- Modals trap focus and restore it to the trigger.

---

## 6. Motion

The system exists. **Apply it; do not extend it.**

| Token | Value | Applied by |
|---|---|---|
| `--duration-press` | 100ms | `.pressable` |
| `--duration-fast` | 150ms | hand-triggered state change |
| `--duration-overlay` | 250ms | overlay enter |
| — | 175ms | overlay exit |
| `--duration-layout` | 300ms | `.rise-in` |
| `--duration-loop` | 800ms | `.animate-spin` |

**Rules**
- Motion may say: work is happening, this changed, this failed, this is live now. It may not
  say "look at me". A dashboard does not perform before the operator can work.
- Animate `transform` and `opacity` only.
- Decelerate hard (`--ease-out-quint`). No bounce, no elastic, no spring.
- Every hand-rolled `<button>` gets `.pressable`, same as `<Button>`.
- Remove the dead `.motion-safe-pulse` selector (0 call sites; referenced only by its own
  kill switch).
- Fix the malformed class `shadow-mdoverlay-motion` (`context-menu.tsx:63`).
- Fix `data-[state=open]:overlay-motion`, which makes the designed exit unreachable on 15
  primitive sites. The conditional must not be pinned to `open` when the element is
  `closed`.
- `prefers-reduced-motion: reduce` is required, in two tiers, exactly as `index.css:411-439`
  already implements it. **Do not weaken it.** Functional feedback stays; decorative motion
  goes.
- Loading state must not be carried only by spinning the *same* glyph — the spinner
  disappears under reduce. Pair it with a label change.

---

## 7. File ownership — the mechanism that keeps seven agents from producing seven designs

**One file, one writer.** An agent may not edit a file it does not own, even to fix
something obviously wrong. It writes the exact patch into its change report instead, and the
coordinator routes it.

| Workstream | Owns (exclusive write) | Findings |
|---|---|---|
| **W-A** Tokens | `client/src/index.css`, `tailwind.config.ts`, `client/src/lib/constants.ts` | A1 (token definitions + `--destructive` dark), E1's token prerequisites, M-dead-vocabularies |
| **W-B** UI primitives | `client/src/components/ui/**` (47 files) | B1(b) focus highlight, C1(a)(b) overlay-motion + sheet timing, G1(a)(b) dialog max-h + gutter, M1 `CardTitle` default, M2 nav-menu focus |
| **W-C** Shell + shared | `client/src/App.tsx`, `components/app-sidebar.tsx`, `components/ui-shared/**`, `components/quick-capture.tsx`, `hooks/use-mobile.tsx`, `components/theme-*.tsx` | I1 status non-colour signal, G1(c) touch targets, G1(e) `h-screen`→dvh, H1 lazy/Suspense + shared fallback, route-change focus, `EmptyState` unification |
| **W-D** Insights | `components/insights/**`, `pages/insights.tsx`, `pages/analytics.tsx`, `pages/ai-usage.tsx` | E1 (relayout + flatten + headers + guardrail table + `+`-sign bug), D1 (learning-view `isError`), 45 literals |
| **W-E** Sources + Create | `components/sources/**`, `pages/sources.tsx`, `components/create/**`, `pages/create.tsx` | B1(a) source-card focus, D1 (saved/research/discover tabs), K1(b) handoff URL parsing, M6, 17 literals |
| **W-F** Schedule + Agent + Today | `pages/today.tsx`, `pages/schedule.tsx`, `pages/queue.tsx`, `pages/calendar.tsx`, `pages/agent.tsx`, `components/schedule/**`, `components/agent/**` | F1 (agent dismiss + timeline + disclosure), D1 (publications limit + today attention window), J1 header primary action, G1(d) tab overflow, duplicate query keys, 30 literals |
| **W-G** Remaining pages | `pages/settings.tsx`, `pages/hooks.tsx`, `pages/articles.tsx`, `pages/ingest.tsx`, `pages/imagegen.tsx`, `pages/vault.tsx`, `pages/chat.tsx`, `pages/carousel.tsx`, `pages/auth.tsx`, `components/x-post-preview.tsx` | L1 contrast literals (22+19+6+5+3+3), 17 exclamation toasts, 4 raw `animate-pulse` |

**Not owned by anyone, therefore not changed:** `pages/discover.tsx`, `pages/generate.tsx`,
`pages/ideas.tsx`, `pages/canned-responses.tsx`, `pages/templates.tsx`,
`pages/references.tsx`, `pages/chat.tsx`'s cross-cutting concerns, `server/**`,
`vite.config.ts`, `client/index.html`.

**Explicitly out of scope for every agent:** adding a product feature, changing the seven
canonical destinations, changing a legacy redirect, touching `server/**`, altering autonomy
or scheduler logic, renaming a shared component, introducing a new dependency, or changing
the visual direction.

---

## 8. What "done" means for an implementation agent

1. It read this file and `docs/design-coordinator-synthesis.md` §3 for its own row.
2. It touched only files it owns.
3. It preserved behaviour: same data, same routes, same API calls, same user-facing
   capability. Structural change only.
4. It reused existing shared components rather than adding a variant.
5. It ran `npm run check` clean and the relevant tests.
6. It wrote a change report to
   `<worktree>/docs/design-orchestration/change-report-<workstream>.md` listing: files
   changed, finding IDs addressed, **measured** before/after evidence, anything it could not
   do and why, and any patch it needs the coordinator to route to another owner.
7. It **committed** its work on its own branch so the coordinator can integrate it.

---

## 9. Acceptance bar

- Zero axe violations on all seven canonical destinations.
- Every status distinguishable without colour and without motion.
- Every list/count/empty surface handles `isError`.
- No rounded bordered box nested inside another Card.
- No focus removed without a visible, ≥3:1 replacement.
- Every overlay action reachable at 390×844.
- No new sub-12px text.
- No exclamation point in any user-facing string.
- `npm run check`, `npm run build`, unit tests, and the e2e suite green.
- One design system. If two implementations of one concept survive integration, the
  integration failed.

---

*This file is the canonical direction referenced by every Phase 4 brief. It was written
before any implementation agent started, so that seven parallel agents share one contract
rather than converging on seven.*
