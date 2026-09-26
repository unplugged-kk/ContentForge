# W-B (UI Primitives) — Change Report

**Workstream:** W-B — owner of `client/src/components/ui/**` (47 files), exclusive write.
**Worktree:** `/Users/kishore/git/cf-design/impl-b` (branch `design/impl-b`), based on baseline `87a0601`.
**Date:** 2026-09-26
**Verification run in this worktree:** `npm run check` → clean (`tsc`, no output). `npm run build` → success,
`dist/public/assets/index-D0uPVhbr.css` 114.34 kB (gzip 18.10 kB), `index-D6lj8Vld.js` 1,792.02 kB (gzip 515.64 kB).
Plus a real Tailwind compile (`npx tailwindcss -i client/src/index.css`) before and after, used as the
selector proof below. Playwright e2e was **not** run (needs the e2e DB + server); no e2e spec references any
class name changed here (grep of `e2e/**` for `max-w-lg`, `max-h-[9`, `overlay-motion`, `w-full max-w`,
`text-2xl`, `shadow-mdoverlay` → 0 hits).

Nothing outside `client/src/components/ui/**` was written. No dependency added. `button.tsx` untouched.

---

## 1. Files changed (12) and finding IDs

| File | Finding | Change |
|---|---|---|
| `select.tsx` | C1(a), B1(b) | bare `overlay-motion`; `SelectItem` gets inset `--ring` indicator |
| `sheet.tsx` | C1(a), C1(b) | bare `overlay-motion` ×2; deleted `duration-300` / `duration-500` |
| `alert-dialog.tsx` | C1(a), G1(a), G1(b) | bare `overlay-motion` ×2; `max-h-[90vh] overflow-y-auto`; `w-[calc(100vw-2rem)]` |
| `dialog.tsx` | G1(a), G1(b) | `max-h-[90vh] overflow-y-auto`; `w-[calc(100vw-2rem)]` |
| `toast.tsx` | C1(a), token migration | bare `overlay-motion`; 4 palette literals → destructive family |
| `dropdown-menu.tsx` | C1(a), B1(b) | bare `overlay-motion` ×2; ring on SubTrigger + Item + Checkbox + Radio |
| `context-menu.tsx` | C1(a), C1(d), B1(b) | bare `overlay-motion`; `shadow-mdoverlay-motion` → `shadow-md overlay-motion`; ring on 4 items |
| `menubar.tsx` | C1(a), B1(b) | bare `overlay-motion` ×2; ring on Trigger, SubTrigger, Item, Checkbox, Radio |
| `navigation-menu.tsx` | C1(a), B1(b2) | bare `overlay-motion` ×3; `focus:outline-none` → `focus-visible:outline-none` + `focus-visible:ring-2 …ring-ring …ring-offset-background` |
| `hover-card.tsx` | C1(a) | bare `overlay-motion` |
| `command.tsx` | B1(b) | `CommandItem` gets a `data-[selected=true]` inset `--ring` indicator |
| `card.tsx` | M1 | `CardTitle` default `text-2xl` → `text-base` |

Diff size: 35 insertions, 35 deletions.

### Reach of the files touched (honest, because it changes how much each fix matters)

Measured importer counts (`grep -rn "ui/<name>" client/src --include=*.tsx`):
`select` 19 files · `dialog` 18 · `sheet` 2 · `tooltip` 2 · `alert-dialog` 1 file (+18 `ConfirmDialog` sites
inside it) · `popover` 1 · **`dropdown-menu` 0 · `command` 0 · `context-menu` 0 · `menubar` 0 ·
`navigation-menu` 0 · `hover-card` 0.**

So the only **live** instance of B1(b) today is `select.tsx:121` (19 importing files, 32 `<Select>` sites).
The DropdownMenu / ContextMenu / Menubar / Command / HoverCard / NavigationMenu fixes are consistency fixes on
currently-unreachable primitives — done in the same pass because the class string is shared, one file has one
writer, and the day anyone imports them the defect would otherwise go live. C1(a) and G1(a)/(b) are fully live
(Dialog 18 files, Sheet 2).

---

## 2. B1(b) — the invisible focus highlight. Measured.

**Root cause confirmed by computation, not by eye.** `--accent` and `--popover` are the same lightness in both
themes, so the fill is literally the surface:

| Theme | `--accent` (rgb) | `--popover` (rgb) | highlight fill vs panel |
|---|---|---|---|
| light | `210 8% 94%` → rgb(238,240,241) | `0 0% 94%` → rgb(240,240,240) | **1.00:1** |
| dark | `210 8% 16%` → rgb(38,41,44) | `0 0% 14%` → rgb(36,36,36) | **1.06:1** |

(The accessibility audit's ≈1.01:1 / ≈1.07:1 figures differ only by hsl→sRGB rounding.)

**Why the tint cannot be fixed by darkening `--accent` (measured, to close that option):**

| Candidate fill | vs `--popover` |
|---|---|
| audit's suggested `--accent: 210 10% 88%` light | 1.16:1 |
| audit's suggested `--accent: 210 10% 22%` dark | 1.31:1 |
| fill that would actually clear 3:1, light — `hsl(210 8% 55%)` ≈ `#8B8B8B` | 3.00:1 |
| fill that would actually clear 3:1, dark — `hsl(210 8% 43%)` ≈ `#6D6D6D` | 2.99:1 |

There is no near-`--popover` tint that clears 3:1 in either theme. A tint that clears it is a mid-grey band
(55% in light, 43% in dark) — that is a **re-skin of the highlight**, which `DONT_BUILD.md` D9 forbids. This is
also why the fix could not be an `alpha` tint of `--primary`: an alpha composite over `--popover` lands at
1.24:1 light and 1.29:1 dark at `/30`, because compositing lightens a 14%-lightness surface by almost nothing.

**What I did.** Kept the designed tint (`focus:bg-accent`) as the fill and added the indicator the system
already reserves for focus — `--ring` — as an inset ring, exactly what `accessibility-audit.md` Finding #1
recommends (`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`). I used the plain `focus:`
variant rather than `focus-visible:` so the ring also shows when Radix moves DOM focus onto an item from a
pointer interaction (menu highlight follows the pointer) — the existing `focus:bg-accent` uses `focus:` too.

Added to every listbox/menu item: `focus:ring-2 focus:ring-inset focus:ring-ring`.
`CommandItem` uses cmdk's `aria-activedescendant` model (the item is never DOM-focused), so it gets
`data-[selected=true]:ring-2 data-[selected=true]:ring-inset data-[selected=true]:ring-ring` instead.

**Measured result — the indicator colour against the panel it is drawn on:**

| Theme | Indicator | vs `--popover` | vs `--background` |
|---|---|---|---|
| light | `--ring` `217 91% 38%` → rgb(9,76,185) | **6.71:1** | 7.65:1 |
| dark | `--ring` `217 91% 72%` → rgb(119,168,249) | **6.47:1** | 7.68:1 |

≈2× the 3:1 bar in both themes, and it is the token the token-layer comment already documents as tuned against
its own offset for exactly this job. Contrast computed with the WCAG 2.x relative-luminance formula
(script: `scratchpad/contrast-wb.mjs`). The shipped bundle confirms the ring pipeline resolves:
`.focus\:ring-2:focus` (box-shadow), `.focus\:ring-inset:focus`, `.focus\:ring-ring:focus` all present in
`dist/public/assets/index-D0uPVhbr.css`.

### B1(b2) — `navigation-menu.tsx:44`

`focus:outline-none` → `focus-visible:outline-none`, and added
`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`
(the same pattern `button.tsx` / `input.tsx` use). The ~1:1 `focus:bg-accent` fill is kept as the surface cue
but is no longer the whole indicator. Unreachable today (0 importers), fixed opportunistically as instructed.

### Verification (grep-proven)

- `grep -rn 'focus:outline-none' client/src/components/ui/ | grep -v ring` → **0** lines. Every
  `focus:outline-none` in `ui/**` now has a replacement ring (they all already did except `navigation-menu.tsx`).
- `grep -rnoE '(bg|text|border|ring|ring-offset|fill)-(emerald|green|blue|…|cyan)-[0-9]{2,3}' client/src/components/ui/` → **0**.
- 14 new `focus:ring-2 focus:ring-inset focus:ring-ring` sites + 1 cmdk `data-[selected=true]:ring-*` group.

---

## 3. C1(a) — the designed overlay exit is now reachable. Compiled proof.

**Before** (my own compile of the baseline working tree, `scratchpad/tw-before.css`):

```
4253: .overlay-motion[data-state="closed"].animate-out                ← the designed 175 ms exit
5847: .data-\[state\=open\]\:overlay-motion[data-state="open"][data-state="closed"].animate-out   ← unsatisfiable
```

An element cannot be `data-state="open"` and `data-state="closed"` at once, and an element that writes
`data-[state=open]:overlay-motion` never carries the literal class `overlay-motion` while closed. So rule 4253
could not match at the 16 prefixed sites, and the exit fell back to the plugin's 150 ms (or the sheet's 300 ms).

**Fix:** dropped the `data-[state=open]:` prefix so the element carries bare `overlay-motion`
(the form `dialog.tsx:24,41`, `popover.tsx:20`, `tooltip.tsx:22` already used and that the audit confirms works).

**Sites fixed (16 prefixed + 1 malformed):** `select.tsx:78`; `sheet.tsx:24,34`; `alert-dialog.tsx:19,37`;
`toast.tsx:26`; `dropdown-menu.tsx:48,66`; `context-menu.tsx:47` (+ `:63` typo);
`menubar.tsx:97,120`; `navigation-menu.tsx:72,89,107`; `hover-card.tsx:21`.

**After** (`scratchpad/tw-after.css`):

```
4257: .overlay-motion[data-state="closed"].animate-out              { animation-duration: 175ms; … }
5818: .data-\[state\=closed\]\:animate-out[data-state="closed"].overlay-motion[data-state="closed"] { animation-duration: 175ms }
grep -c 'data-state="open"\]\[data-state="closed"\]'  →  0
```

Selectors that require the element to *be* closed while carrying `overlay-motion` — i.e. exactly the elements
that fixed sites render — now exist, and the unsatisfiable form is gone. The shipped, minified bundle contains
`overlay-motion[data-state=closed].animate-out{animation-duration:175ms;animation-timing-function:var(--ease-out-quart)}`
and 0 occurrences of the unsatisfiable selector. Enter = 250 ms (`.overlay-motion.animate-in`), exit = 175 ms.

### C1(b) — `sheet.tsx:34`

`data-[state=closed]:duration-300 data-[state=open]:duration-500` deleted. Before: entrance 250 ms
(`data-[state=open]:overlay-motion` at specificity 0,3,0) vs **exit 300 ms** (the `duration-300` literal, the
`duration-500` literal was dead). After: **enter 250 ms / exit 175 ms** — exit shorter than entrance, matching
`index.css:245-246` and §6 of the direction. This is now the only overlay in `ui/**` with an inverted exit and
it is closed.

### C1(d) — `context-menu.tsx:63`

`shadow-mdoverlay-motion` → `shadow-md overlay-motion`. The malformed token emitted **0** rules, so the context
menu had neither shadow nor motion; both now apply.

---

## 4. G1(a) and G1(b) — unreachable actions and no small-viewport gutter

`dialog.tsx:41` and `alert-dialog.tsx:37` now read:

```
grid max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg … overflow-y-auto …
```

**G1(a)** — `max-h-[90vh] overflow-y-auto`, the same treatment the two precedent dialogs already use
(`queue.tsx:572` `max-h-[90vh] overflow-y-auto`, `settings.tsx:646` `max-h-[80vh] overflow-auto`). The
calendar/queue thread dialog's submit row (`calendar.tsx:371` "Schedule" / "Save New Time") is now reachable:
the panel is capped and scrolls instead of being clipped top and bottom under Radix's body-scroll lock.

**G1(b)** — `w-full` → `w-[calc(100vw-2rem)]`, a 1 rem gutter each side (the fix `responsive-audit.md` #3
specifies). Measured: at 390 px the panel goes from exactly **390 px (100vw, flush to both edges)** to
**358 px**; at 430 px from **430 px** to **398 px**. Desktop is unchanged — `max-w-lg` (512 px) still wins.

**Consumer merge checked, not assumed.** `cn()` is `twMerge(clsx(...))`, and `tailwind-merge` resolves the new
base classes against consumer overrides — verified by running it:

- `CommandDialog`'s `overflow-hidden p-0 shadow-lg` → `overflow-hidden` wins over the new base `overflow-y-auto`,
  so the command palette does **not** gain a scrollbar.
- `settings.tsx:646`'s `max-w-2xl max-h-[80vh] overflow-auto` → all three override, gutter preserved.
- `queue.tsx:572`'s `max-w-lg max-h-[90vh] overflow-y-auto` → no-op, identical to the new default.

**Known trade-off (reported, not silently taken):** because the *content element* is the scroll container, a
tall dialog scrolls its `DialogClose` / `SheetClose` X (`absolute right-4 top-4`) out of view with the body.
That is the behaviour of the two precedent dialogs already in the app, so this is consistent rather than new.
Pinning header/footer around a scrollable body is the stronger structure and would be a rewrite of every
dialog's children — out of scope for this workstream.

---

## 5. M1 — `CardTitle` default

`card.tsx:39` `text-2xl font-semibold leading-none tracking-tight` → `text-base font-semibold leading-none tracking-tight`.

Verified with a multiline parse of the whole of `client/src` (not a line grep):
**41 `<CardTitle>` call sites, 0 without an explicit `text-{xs…4xl}` override.** Nothing rendered at 24 px, so
this is a pure hygiene change with zero visual effect, and the component no longer contradicts every consumer.

---

## 6. Token migration inside my own files

`toast.tsx` carried the only palette literals in `ui/**` (verified: a `bg|text|border|ring|ring-offset|fill`
sweep of `ui/**` returns exactly those 4 and nothing else). Migrated by intent onto the destructive family:

| Before | After | Measured contrast on the destructive fill |
|---|---|---|
| `group-[.destructive]:text-red-300` | `group-[.destructive]:text-destructive-foreground/70` | 3.20:1 → **3.33:1** (icon glyph, ≥3:1 is the bar) |
| `group-[.destructive]:hover:text-red-50` | `group-[.destructive]:hover:text-destructive-foreground` | — (**5.70:1** at full opacity) |
| `group-[.destructive]:focus:ring-red-400` | `group-[.destructive]:focus:ring-destructive-foreground` | 2.19:1 → **5.70:1** |
| `group-[.destructive]:focus:ring-offset-red-600` | `group-[.destructive]:focus:ring-offset-destructive` | — |

The focus-ring migration is a real contrast *improvement*, not just a rename: `red-400` on `bg-destructive`
measures 2.19:1, i.e. the close button's own focus ring failed 3:1. `--destructive-foreground` clears it at
5.70:1 (5.70:1 light; and against W-A's re-derived dark `--destructive: 0 78% 62%` the `/70` glyph measures
3.46:1, still ≥3:1). No new token name is used that §4.2 does not define; `--destructive-foreground` is mapped
in `tailwind.config.ts:49-53` and is the contract's "text on a solid `--{role}` fill".

---

## 7. What I could not do / patches for the coordinator to route

1. **`--accent` still measures 1.00:1 / 1.06:1 against `--popover`** (`index.css:26,35,128,137`) — W-A's file,
   untouched. My fix keeps it as the *fill* and adds `--ring` as the *indicator*, which is the only shape that
   clears 3:1 in both themes (§2). If W-A also moves `--accent`, that is still worth doing for the
   hover/`data-[state=open]` tint on menus — but it must not be expected to fix the focus highlight; measured,
   even the audit's suggested values only reach 1.16:1 / 1.31:1.
2. **`ui/calendar.tsx:45` `day_today: "bg-accent text-accent-foreground"`** is the same 1:1 root cause, on
   `bg-popover`. I did **not** change it: today's-date marker is a different state from a focused option, the
   only fix that keeps it as a tint is the ring treatment (odd on a calendar cell), and the audit's site list
   for Finding #1 excludes it. Worth noting that `ui/calendar.tsx` has **0 importers**, so it does not ship
   today. Recommend the coordinator decide the today-marker treatment when the date picker is next touched.
3. **`sheet.tsx:34` still carries `transition ease-in-out`.** It is dead (the sheet moves on Radix keyframes,
   not transitions) and it is one of the hardcoded literals `motion-audit.md` #9 lists. I left it rather than
   widen the diff inside a C1(b) change; it can be deleted with no behaviour change.
4. **`menubar.tsx:120` (`MenubarContent`) has no `data-[state=closed]:animate-out`** — pre-existing, so its
   exit is already unreachable by a different route. I did not add a motion branch to an unreachable primitive.
5. **`toast.tsx:26` — `motion-audit.md` finding #7 (LOW) and #10 (LOW) are in my file and not in my brief.**
   #7: the toast enters and exits by travelling its full height/width (`slide-in-from-top-full` /
   `slide-out-to-right-full`) at 199 `toast(...)` call sites; `motion.md` asks for a ~12 px fixed offset.
   #10: `transition-all` on the same line should be `transition-[transform,opacity]`. Both are real, both are
   my ownership, both are one-line-ish and neither is in my finding list, so I have not touched them — they are
   available as a follow-up booking on this file. Say the word and they are a 2-line patch.
6. **`.pressable` on the 35 hand-rolled `<button>`s** (`motion-audit.md` #5) is not in `ui/**` — it belongs to
   whoever owns those pages (W-C/W-D/W-E per §7). Not routed to me, not done.
7. **Two findings in my brief's evidence that I want to flag as *not* fixed by the primitives:** the
   `XPostPreview` and per-tweet `<Card>` list that makes `calendar.tsx`'s dialog tall enough to clip is in
   `calendar.tsx` (W-F). G1(a) makes the action reachable at any height, which is the primitive-level fix;
   a layout change to that dialog's body is W-F's call.
8. **Playwright was not run** (needs the e2e DB + `npm start`). `e2e/accessibility.e2e.spec.ts:85-150`
   already asserts that a focused control paints a non-`none` `box-shadow` whose `--ring` colour clears 3:1
   against the surface behind it, and my change satisfies it by construction — but it has not been executed
   here. Its reduced-motion block (≤50 ms on every `animation-duration`/`transition-duration`) is unaffected:
   no duration was added anywhere except by removing the sheet literals.
