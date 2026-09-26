# Change Report — Workstream W-G (Remaining Pages)

**Worktree:** `/Users/kishore/git/cf-design/impl-g` (branch `design/impl-g`)
**Baseline:** `87a0601` (phase-33.2 working tree)
**Direction:** `docs/contentforge-design-direction.md` §4.2 / §4.4 / §6
**Register:** Product — single-operator instrument. Structural/token change only; **no re-skin** (D9 holds).

---

## 1. Files changed (11 — all in W-G's exclusive ownership list)

| File | Findings addressed | Literals before → after |
|---|---|---|
| `client/src/pages/settings.tsx` | L1, M8, exclamation copy, WT-05, progressive disclosure, §3 text scale | 19 → 0 |
| `client/src/pages/hooks.tsx` | L1, M8, exclamation copy, §3 text scale | 22 → 0 |
| `client/src/pages/articles.tsx` | L1, M8, §3 text scale | 6 → 0 |
| `client/src/pages/ingest.tsx` | L1, M8, exclamation copy, §3 text scale | 5 → 0 |
| `client/src/pages/vault.tsx` | M8 (partial), exclamation copy, M-dead pulse | 3 → 1 |
| `client/src/pages/imagegen.tsx` | exclamation copy, M-dead pulse, §3 text scale | 3 → 3 (left, see §5) |
| `client/src/pages/chat.tsx` | exclamation copy, §3 text scale | 0 → 0 |
| `client/src/pages/carousel.tsx` | exclamation copy, M-dead pulse, §3 text scale | 0 → 0 |
| `client/src/pages/auth.tsx` | exclamation copy | 0 → 0 |
| `client/src/pages/formatter.tsx` | (live — verified; §3 text scale) | 0 → 0 |
| `client/src/components/x-post-preview.tsx` | §3 text scale only | 12 → 12 (left, see §5) |
| `client/src/pages/not-found.tsx` | none needed (reviewed) | 0 → 0 |

**Totals.** Raw palette literals across the seven colour-carrying owned pages: **58 → 4**
(the 4 remaining are the verified artwork/convention sites in §5). `x-post-preview.tsx`
unchanged at 12 (brand mock). Sub-12px arbitrary classes `text-[9/10/11px]`: **40 → 0**
(all resolve to 12px via the type floor, so `text-xs` is a no-op migration per §3).
`animate-pulse` survivors: **3 → 0**. Exclamation-point strings: **18 marks → 0** across 8 files.

## 2. L1 / M8 — migrated literals (before → after)

All call sites migrated **by semantic intent**, using only the six token names fixed in §4.2
(`success`, `success-foreground`, `warning`, `warning-foreground`, `info`, `info-foreground`)
plus the pre-existing `destructive` family. `{role}` = the on-surface text/border colour;
tints via alpha. No new token names were invented.

**settings.tsx**
- `:34,:40` `bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30` → `bg-warning/10 text-warning border-warning/30`
- `:44` `bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30` → `bg-success/10 text-success border-success/30`
- `:281,:448` `bg-green-500/10 text-green-500 border-green-500/20` → `bg-success/10 text-success border-success/30`
- `:316` `text-green-500` (**2.28:1**, the measured HIGH) → `text-success`

**hooks.tsx**
- `:43` `bg-green-500/10 text-green-500 border-green-500/20` → `bg-success/10 text-success border-success/30`
- `:44` `bg-blue-500/10 text-blue-500 border-blue-500/20` (**3.42:1**) → `bg-info/10 text-info border-info/30`
- `:81-88` the 8-hue badge map → role tokens by hue family (documented decision, §5):
  red→`bg-destructive/10 text-destructive`; blue/purple/cyan→`bg-info/10 text-info`;
  amber/pink/orange→`bg-warning/10 text-warning`; green→`bg-success/10 text-success`.

**articles.tsx** — `statusColors` map:
- `:29` `writing` `bg-blue-500/20 text-blue-400` → `bg-info/10 text-info`
- `:30` `ready` `bg-green-500/20 text-green-400` → `bg-success/10 text-success`
- `:31` `published` `bg-purple-500/20 text-purple-400` → `bg-success/10 text-success`
- `:28` `draft` `bg-muted text-muted-foreground` unchanged.

**ingest.tsx**
- `:444` `text-orange-500` → `text-warning`
- `:472` `text-green-600 dark:text-green-400` → `text-success`
- `:480` `text-red-600 dark:text-red-400` → `text-destructive`

**vault.tsx**
- `:203` `hover:bg-red-100 … hover:text-red-500` → `hover:bg-destructive/10 … hover:text-destructive`
- `:200` `text-red-400` (favorite heart) **left** — see §5.

## 3. Exclamation-point copy (brief.md:126 — sentence case, no exclamation points)

Rewritten in the product's voice: factual, one verb per action, nothing removed but the `!`.

| File | Before | After |
|---|---|---|
| settings.tsx:149 | `Brand profile saved!` | `Brand profile saved` |
| settings.tsx:164 | `AI analysis complete!` | `AI analysis complete` |
| settings.tsx:215 | `Account connected!` | `Account connected` |
| settings.tsx:244 | `Connection verified!` | `Connection verified` |
| hooks.tsx:75 | `Hook copied!` | `Hook copied` |
| ingest.tsx:212 | `Article draft saved!` | `Article draft saved` |
| ingest.tsx:216 | `Draft saved!` | `Draft saved` |
| imagegen.tsx:59 | `Image generated!` | `Image generated` |
| imagegen.tsx:256 | `Prompt copied!` | `Prompt copied` |
| vault.tsx:61 | `Content extracted!` | `Content extracted` |
| vault.tsx:76 | `Image analyzed!` | `Image analyzed` |
| vault.tsx:90 | `Saved to vault!` | `Saved to vault` |
| chat.tsx:89 | `Post refined!` | `Post refined` |
| chat.tsx:107 | `Saved as draft!` | `Saved as draft` |
| chat.tsx:240 | `Copied!` | `Copied` |
| carousel.tsx:85 | `Carousel created!` | `Carousel created` |
| auth.tsx:49 | `Account created!` / `Welcome to ContentForge, ${data.name}!` | `Account created` / `Welcome to ContentForge, ${data.name}` |

(The task counted 16 across these files; the grep found 18 marks — settings had 4 and auth had
2 marks in a single toast. All 18 fixed. Behaviour unchanged: same toast, same variant, same trigger.)

## 4. Motion — M-dead `animate-pulse` → `.pulse-skeleton`

`imagegen.tsx:217`, `vault.tsx:174`, `carousel.tsx:125` skeletons repointed `animate-pulse` →
`pulse-skeleton` (`index.css:342`). After this change **zero `animate-pulse` remain anywhere in
`client/src`** except one W-E site — see §7.

## 5. Literals deliberately **left as literals** (verified per call site — direction §4.4)

- **`x-post-preview.tsx` (12).** Every one is part of the simulated X chrome:
  `text-sky-400` (mention/hashtag links, `:19,:26`), the character-count badge
  `bg-red-500/20 text-red-300` / `bg-amber-500/20 text-amber-200` / `bg-emerald-500/20 text-emerald-200`
  (`:38-40`), `bg-slate-600` (`:51,:57`) and `text-slate-400` (`:65,:76`). These reproduce another
  product's identity and are calibrated against the fixed dark backdrop `bg-[#15202B]`, which is
  theme-independent — a theme token (`text-destructive` etc.) would render inconsistently against that
  fixed surface. **Decision: leave.** (Matches `design-system-audit.md` §4 and `visual-audit.md` §4.)
- **`imagegen.tsx:242,263,272` (3).** All three render on the image tile / its `bg-black/60` hover
  overlay, not on `--background`; `img.isFavorite ? "text-red-400" : "text-white"` is a favourite-toggle
  convention with no semantic status role. Migrating to `text-destructive` would *regress* contrast in
  the light theme (dark red on a dark overlay). **Decision: leave.** (Matches `design-system-audit.md` §4.)
- **`vault.tsx:200` (1).** Same favourite-heart convention, on a card. `text-red-400` clears the 3:1
  non-text bar on a light card; there is no "favourite" role token. **Decision: leave.**
- `hooks.tsx:81-88` (8-hue map): migrated (not left) because these badges render on normal card
  surfaces and failed AA; the migration collapses the (decorative) 8 hues onto the four role tones, with
  the hook-type **label** carrying identity. Documented because it is a loose semantic fit, not a 1:1 map.

## 6. WT-05 — `/settings` heading hierarchy

The page rendered `h1` (`PageHeader`) then jumped to `h3` at `:57,:274,:440,:523,:535`.
All five were promoted `h3 → h2` (classes unchanged, so no visual change). The outline is now
`h1 Settings → h2 …` with **no skipped level** (0 remaining `h3` in the file). `axe` `heading-order` clean.

## 7. Escalated and **untouched** (WT-02)

- **`settings.tsx:312`** still prints `account.accessToken` in plaintext while `:506` states
  "Tokens are never shown here." Per the task and synthesis M4 this is a **security** finding outside a
  design pass. **The code is exactly as-is; not modified.** Escalated — no design agent should change it.

## 8. Progressive disclosure (Settings)

Settings already groups by dependency: **Connected Accounts** (channels/accounts) · **AI Provider**
(runtime) · **Content Pillars** (content config) · **Brand Profile** (profile) — 4 tabs. I did **not**
restructure the tabs (that would change `tab-*` testids and break e2e for no behavioural gain).
The one impactful/destructive control — **Disconnect account** (and the YouTube disconnect) — was made
visually distinct with `className="text-destructive hover:text-destructive"` on the existing `ghost`
icon button: legible as destructive, not louder than the primary workflow (§5.4). No clutter added.
There is no autonomy-configuration surface on `/settings` to group.

## 9. Could not do / not attempted

- **No rendered verification.** No dev server / browser was run, so findings are verified by
  `npm run check` + `npm run build` and class inspection, **not** by axe or screenshots. The contrast
  values are the ones measured in the audits (2.28:1 / 3.42:1); the token values themselves are W-A's
  (§4.3) and were not re-derived here.
- **`transition-all`** (motion-audit #10) in `formatter.tsx:98`, `imagegen.tsx:146`, `vault.tsx:236`,
  `carousel.tsx:30,251` was **not** changed — it is not in this workstream's finding list (only the
  `animate-pulse` repoint is). Flagged for a motion owner.
- **`vault.tsx` is unreachable.** Verified: `/vault` is a `LegacyRouteRedirect` → `/sources?view=vault`
  (`legacy-route-mapping.ts:21`), `VaultPage` is imported by nothing, and the synthesis §L1 conflict
  lists `/vault` as dropped. I **did** migrate it (task M8 + the toast list named it explicitly), but its
  literals/toasts **do not ship**; the coordinator may revert it if the intent was to skip dead files.
- No e2e suite was executed (Playwright not run in this pass).

## 10. Patches needing another owner (not edited — single-writer rule)

1. **W-E** — `components/create/artifact-review-view.tsx:271` is the **last** raw `animate-pulse` in
   `client/src`:
   ```diff
   -        <Sparkles className="h-6 w-6 animate-pulse text-primary" />
   +        <Sparkles className="h-6 w-6 pulse-skeleton text-primary" />
   ```
   (It is a loading glyph, so `.pulse-skeleton`, not `.pulse-live`.)
2. **W-F** — `pages/queue.tsx:222` exclamation toast:
   ```diff
   -        toast({ title: "Posted to X!", description: `Live: ${data.tweetUrl}` });
   +        toast({ title: "Posted to X", description: `Live: ${data.tweetUrl}` });
   ```
3. **W-A** — the entire migration depends on the six §4.2 token names existing in `index.css` **and**
   their `tailwind.config.ts` mapping. My classes use exactly `success` / `success-foreground` /
   `warning` / `warning-foreground` / `info` / `info-foreground` (+ existing `destructive`). Until W-A
   lands them these utilities emit nothing. **The dark-theme `--destructive` fix (§4.2) and the dead
   `status.*` / `POST_STATUSES` removal are W-A's, not done here.**
4. **W-C** — `components/ui-shared/status-badge.tsx:66-72` still holds the literal status tones; its
   `STATUS_TONE` should be re-expressed on the same role tokens (out of my ownership).

## 11. Verification performed

- `npm run check` → clean (`tsc`, no output).
- `npm run build` → success (`✓ 2992 modules transformed`, `built in 3.20s`).
- Grep-proved **0** exclamation-point strings in owned files (the only `[A-Za-z]!` hits are TS non-null
  assertions `finalPost!` / `bullets!`).
- Grep-proved **0** `animate-pulse` in owned files; **0** `text-[9/10/11px]` in owned files.
- Grep-proved every migrated class references only one of the §4.2 token names or `destructive`;
  no non-existent/renamed token name is referenced.
- Verified reachability: `formatter.tsx` **is live** (imported by `create.tsx`, mode key `formatter`);
  `/vault` is **not** (see §9).

## 12. Commit

`design(pages): semantic status tokens, remove exclamation copy, normalize loading pulse`
