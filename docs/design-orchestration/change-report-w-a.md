# Change Report — Workstream W-A (Token Layer)

**Branch:** `design/impl-a` · **Findings:** A1, A1b, M-dead-vocab
**Files changed:** `client/src/index.css`, `tailwind.config.ts`, `client/src/lib/constants.ts`
**Verification:** `npm run check` → exit 0 · Tailwind CLI → exit 0 (utilities emitted, see §5) · `npm run build` → exit 0 (client built, `index-DLgehbFh.css` 115.10 kB / gzip 18.27 kB)

---

## 1. What changed

**`client/src/index.css`**

- Added six semantic tokens to **both** `:root` and `.dark` exactly as named in
  `contentforge-design-direction.md` §4.2 (no renames): `--success`, `--success-foreground`,
  `--warning`, `--warning-foreground`, `--info`, `--info-foreground`.
- **A1b** — fixed `--destructive` in `.dark`: `0 84% 42%` → `0 84% 64%`. Because that makes
  the solid fill light, `--destructive-foreground` in `.dark` was flipped from `0 84% 98%`
  (near-white, which would sit at **3.18:1** on the new fill) to `0 84% 10%`. Light
  `--destructive` / `--destructive-foreground` are unchanged. See §3 for the numbers and §6
  for the cross-workstream note.

**`tailwind.config.ts`**

- Added `success`, `warning`, `info` color groups following the file's existing
  `--{role}` / `<alpha-value>` convention exactly (DEFAULT + `foreground`; no `-border` key,
  because the contract is deliberately two values per role and `border-success/30` resolves
  through DEFAULT + alpha — proven in §5).
- **M-dead-vocab** — deleted the dead `status.*` namespace (was lines 78–83).

**`client/src/lib/constants.ts`**

- **M-dead-vocab** — deleted `POST_STATUSES` (was line 35).

Not touched, by instruction: the type scale (`index.css:186–440`), the motion system, the
`--chart-N` lightness ladder, the reduced-motion block. No tokens re-skinned.

---

## 2. Dead-vocabulary verification (grep before delete)

Both deletions were gated on a zero-consumer check, run against the whole worktree.

- `POST_STATUSES` — grep `POST_STATUSES` matched **only** its own definition in
  `client/src/lib/constants.ts:35` plus two prose mentions in audit documents
  (`Claude outputs/DESIGN_SYSTEM_AUDIT.md:45`, `docs/ux-audit/DESIGN_SYSTEM_AUDIT.md:45`).
  **0 imports.** Deleted.
- `status.*` (`online`/`away`/`busy`/`offline`) — grep for
  `status\.(online|away|busy|offline)` and `(bg|text|border|fill|ring)-status-` matched **0**
  call sites; the only hit anywhere was a prose citation in
  `.commandcode/design/checkup-report.md:127`. **0 consumers.** Deleted.

Neither had a consumer, so nothing was retained.

---

## 3. Computed contrast table (required rows, light **and** dark)

**Method.** WCAG 2.x relative luminance: sRGB channels companded
(`c ≤ 0.03928 → c/12.92`, else `((c+0.055)/1.055)^2.4`), `L = 0.2126R + 0.7152G + 0.0722B`.
Alpha compositing is done **in sRGB (gamma-encoded) space**, which is the CSS default for
`bg-{role}/10`. Ratio = `(Lmax+0.05)/(Lmin+0.05)`. Script:
`scratchpad/locked.mjs` (scratch, not committed). No ratio below is asserted that was not
computed by that script.

Surfaces: light `--background 0 0% 100%` (#ffffff), `--card 0 0% 98%` (#fafafa);
dark `--background 0 0% 8%` (#141414), `--card 0 0% 10%` (#1a1a1a).
"tint/BG" and "tint/card" are the role against **its own 10% tint** composited over each
surface — the test for `text-{role}` on `bg-{role}/10`.

### Light (`:root`)

| Token | HSL | Hex | vs `--background` | vs `--card` | tint/BG | tint/card | fg-vs-role |
|---|---|---|---|---|---|---|---|
| `--success` | `143 64% 24%` | `#166434` | **7.19** | **6.88** | **6.17** | **5.92** | — |
| `--success-foreground` | `138 76% 97%` | `#f2fdf5` | — | — | — | — | **6.90** |
| `--warning` | `26 83% 31%` | `#91460d` | **6.80** | **6.51** | **5.85** | **5.61** | — |
| `--warning-foreground` | `48 100% 96%` | `#fffbeb` | — | — | — | — | **6.55** |
| `--info` | `224 76% 48%` | `#1d4fd7` | **6.65** | **6.37** | **5.70** | **5.47** | — |
| `--info-foreground` | `214 100% 97%` | `#f0f6ff` | — | — | — | — | **6.13** |

### Dark (`.dark`)

| Token | HSL | Hex | vs `--background` | vs `--card` | tint/BG | tint/card | fg-vs-role |
|---|---|---|---|---|---|---|---|
| `--success` | `142 69% 58%` | `#4ade80` | **10.52** | **10.02** | **8.76** | **8.25** | — |
| `--success-foreground` | `144 61% 12%` | `#0c311b` | — | — | — | — | **8.16** |
| `--warning` | `43 96% 56%` | `#fbbd23` | **10.86** | **10.35** | **8.98** | **8.45** | — |
| `--warning-foreground` | `26 83% 14%` | `#412006` | — | — | — | — | **8.67** |
| `--info` | `213 94% 68%` | `#61a6fa` | **7.27** | **6.93** | **6.28** | **5.93** | — |
| `--info-foreground` | `224 76% 12%` | `#071436` | — | — | — | — | **7.17** |

**Every required row clears 4.5:1 with margin; the tightest is `--info` light tint/card at
5.47:1.** Light stops are Tailwind `green-800` / `amber-800` / `blue-700`; dark stops are
`green-400` / `amber-400` / `blue-400` — chosen so the passing values also read as the same
named hues the migration table already used, rather than as invented colours.

### `--destructive` — A1b before/after

| Surface / pair | OLD (both themes `0 84% 42%` = #c51111) | NEW dark (`0 84% 64%` = #f05656) |
|---|---|---|
| `--destructive` vs `--background` (dark `0 0% 8%`) | **3.03** ❌ | **5.41** ✅ |
| `--destructive` vs `--card` (dark `0 0% 10%`) | **2.89** ❌ | **5.15** ✅ |
| `--destructive` vs its own 10% tint / BG (dark) | 2.84 ❌ | **4.86** ✅ |
| `--destructive` vs its own 10% tint / card (dark) | 2.71 ❌ | **4.60** ✅ |
| `--destructive-foreground` on `--destructive` fill (dark) | 3.18 ❌ | **5.43** ✅ (`0 84% 10%`) |
| Light `--destructive` vs BG / card / tint (unchanged) | 6.06 / 5.80 / 5.09 / 4.88 | 6.06 / 5.80 / 5.09 / 4.88 ✅ |

The measured OLD dark value is **3.03:1**, corroborating the reported A1b figure of 3.04:1
(rounding). The `hover:bg-destructive/10` call site below is why the dark tint rows were also
made to pass, not only `--background`/`--card`:

- `client/src/components/sources/create-story-dialog.tsx:196` —
  `hover:bg-destructive/10 hover:text-destructive`. At the new dark value this pair is 4.60:1
  (light: 4.88:1). At the old dark value it would have been 2.71:1.

### The `--warning` tension (required to report)

Amber is genuinely the hard case, and the tension is real and was reported rather than
rounded.

- The literal being replaced, `text-amber-600` (`#d97706`, `32 95% 44%`), measures **3.02:1**
  on white — the A1 defect.
- The threshold that actually binds is **not** "on white" (4.5:1) but the required
  **self-tint** row: `text-warning` on `bg-warning/10` composited over the 98% card. At
  `26 90% L`, anything lighter than **L≈35%** fails tint/card; L=36% already measures 4.40:1
  ❌. So a passing amber is necessarily a **dark burnt brown-orange**, several steps darker
  than the amber the UI uses today.
- Shipped: `26 83% 31%` (= Tailwind `amber-800`), tint/card **5.61:1**. It is deliberately a
  shade darker than the bare minimum (`26 90% 34%` clears at 4.79:1) to buy margin.
- **Rendering consequence to flag:** `text-warning` will look closer to a brown than to the
  current amber, and a solid `bg-warning` fill is a dark brown button. This is the honest
  price of 4.5:1 for amber on a light surface; the direction's rule — status is never rounded
  down — was followed. Dark mode has no comparable tension (`amber-400` at 10.86:1).

---

## 4. Substitution table — for the coordinator to route to per-file writers

Per `contentforge-design-direction.md` §4.4. Writers migrate **by semantic intent**, not by
hue; categorical/decorative uses (chart series via `--chart-N`, carousel artwork fills,
`x-post-preview.tsx` platform-brand literals) stay as literals.

| Old literal | New class | Role |
|---|---|---|
| `text-emerald-600 dark:text-emerald-400`, `text-green-500` | `text-success` | success text |
| `bg-emerald-500/10`, `bg-green-500/10` | `bg-success/10` | success tint |
| `border-emerald-500/30`, `border-green-500/30` | `border-success/30` | success border |
| `bg-emerald-700 hover:bg-emerald-800 text-white` (solid button) | `bg-success text-success-foreground` | success fill |
| `text-amber-600 dark:text-amber-400`, `text-orange-*` | `text-warning` | warning text |
| `bg-amber-500/10`, `bg-orange-500/10` | `bg-warning/10` | warning tint |
| `border-amber-500/30`, `border-orange-500/30` | `border-warning/30` | warning border |
| `bg-amber-600 text-white` (solid) | `bg-warning text-warning-foreground` | warning fill |
| `text-blue-600 dark:text-blue-400`, `text-sky-*` | `text-info` | info text |
| `bg-blue-500/10`, `bg-sky-500/10` | `bg-info/10` | info tint |
| `border-blue-500/30`, `border-sky-500/30` | `border-info/30` | info border |
| `bg-blue-600 text-white` (solid) | `bg-info text-info-foreground` | info fill |
| `text-red-*`, `text-rose-*` | `text-destructive` | error text (unchanged name; now readable in dark) |

All thirteen classes above were compiled against the real tokens and emit the expected
`hsl(var(--*))` declaration (§5).

---

## 5. Verification detail (mapping proven end to end)

- `npm run check` (`tsc`) → **exit 0**.
- `npm run build` (`tsx script/build.ts`) → **exit 0**. Client built; CSS bundle
  `dist/public/assets/index-DLgehbFh.css`, 115.10 kB / gzip 18.27 kB; JS unchanged at
  1,792.01 kB (this workstream adds no JS).
- Tailwind CLI exact command
  `npx tailwindcss -i client/src/index.css -o /tmp/w-a-out.css --content 'client/src/**/*.tsx'`
  → **exit 0**. That output legitimately contains **none** of the new utilities, because no
  call site has migrated to them yet (migration is the per-file writers' job) — grep for
  `(bg|text|border)-(success|warning|info)` returns 0.
- To prove the **mapping** end to end, the same command was re-run with a scratch probe
  source appended to the content list
  (`--content 'client/src/**/*.tsx,$SCRATCH/probe.tsx'`, probe never committed). The output
  then contained, resolving correctly through the `<alpha-value>` convention:

  ```
  .bg-success            { background-color: hsl(var(--success) / var(--tw-bg-opacity, 1)); }
  .text-warning          { color: hsl(var(--warning) / var(--tw-text-opacity, 1)); }
  .text-info             { color: hsl(var(--info) / var(--tw-text-opacity, 1)); }
  .text-success-foreground { color: hsl(var(--success-foreground) / var(--tw-text-opacity, 1)); }
  .bg-success/10         { background-color: hsl(var(--success) / 0.1); }
  .border-success/30     { border-color: hsl(var(--success) / 0.3); }
  .bg-info/10            { background-color: hsl(var(--info) / 0.1); }
  .border-warning/30     { border-color: hsl(var(--warning) / 0.3); }
  ```

  So `bg-success`, `text-warning`, `text-info` — and the tints/borders the substitution
  table depends on — compile from the token layer.

---

## 6. Cross-workstream notes / items needing another owner

No source-file patch is required for this token work. Two advisory items:

1. **Dark `--destructive-foreground` flipped to dark (`0 84% 10%`).** In dark mode the solid
   `bg-destructive` fill is now light, so its label must be dark. Consumers are in files
   **not owned by W-A** and need no code change, but the coordinator should route them for a
   visual check in dark mode:
   `components/ui/button.tsx:16`, `components/ui/badge.tsx:17`, `components/ui/toast.tsx:32`
   and `:63`, `components/ui-shared/confirm-dialog.tsx:54` (all use
   `bg-destructive text-destructive-foreground`). The token change alone makes them legible
   (5.43:1).
2. **Two-value contract respected — no `-border` token added.** `border-{role}/30` works via
   DEFAULT + alpha. If any writer wants a solid `border-{role}` companion var (as
   `primary`/`secondary`/`muted`/`accent`/`destructive` have), that is a change to the §4.2
   contract and should go back to the coordinator rather than be invented per file.

Nothing was left undone. Everything asked of W-A (six tokens in both themes, dark
`--destructive` fix, both dead vocabularies) is implemented, computed, verified, and
committed.
