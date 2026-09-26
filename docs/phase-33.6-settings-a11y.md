# ContentForge — Phase 33.6: `/settings` accessible labels

**Date:** 2026-09-26
**Base:** `main` @ `d4a3760`
**Branch:** `phase-33.6-settings-labels` (worktree `cf-design/336labels`)
**Scope:** `/settings` accessible names ONLY.
**Severity:** HIGH (axe-invisible).

---

## 1. Defect

12 controls on `/settings` had **no accessible name**. Each control's visible `<label>`
element had no `htmlFor` and the control had no `id`, so the association never existed:
`el.labels.length === 0` and `aria-label` was `null`.

axe's `label` rule does **not** flag this — a `<label>` element is present in the DOM, it is
simply not associated with its control — so a passing axe run provided false assurance.

| # | Control | `data-testid` | Section |
|---|---|---|---|
| 1 | Brand Voice (textarea) | `textarea-brand-voice` | Brand Profile |
| 2 | Writing Style Notes (textarea) | `textarea-writing-style` | Brand Profile |
| 3 | Target Audience (textarea) | `textarea-audience` | Brand Profile |
| 4 | Content Goals (textarea) | `textarea-content-goals` | Brand Profile |
| 5 | Niche / Expertise (text) | `input-niche` | Brand Profile |
| 6 | Messaging pillar 1 (text) | `input-pillar-0` | Brand Profile |
| 7 | Messaging pillar 2 (text) | `input-pillar-1` | Brand Profile |
| 8 | Messaging pillar 3 (text) | `input-pillar-2` | Brand Profile |
| 9 | Messaging pillar 4 (text) | `input-pillar-3` | Brand Profile |
| 10 | Messaging pillar 5 (text) | `input-pillar-4` | Brand Profile |
| 11 | Username (text) | `input-connect-username` | Connect dialog |
| 12 | Access Token / Bearer Token (password) | `input-connect-token` | Connect dialog |

10 in the Brand Profile tab, 2 in the Connect dialog.

## 2. Fix — `client/src/pages/settings.tsx`

Followed the existing correct pattern in `client/src/components/create/create-studio.tsx`
(`<label htmlFor="…">` + matching `<input id="…">`).

- Controls 1–5: added `htmlFor` to the label and `id` to the control
  (`textarea-brand-voice`, `textarea-writing-style`, `textarea-audience`,
  `textarea-content-goals`, `input-niche`).
- Controls 6–10: the five Messaging-pillar inputs share one visible group label
  ("Messaging pillars (max 5)"), which cannot associate to five controls. Each pillar
  input therefore carries its own explicit `aria-label={`Messaging pillar ${i + 1}`}`
  (settings.tsx:624).
- Controls 11–12: added `htmlFor`/`id` (`input-connect-username`, `input-connect-token`).

**Placeholder text is never used as the label** — every name comes from an associated
label or an explicit `aria-label`. The spec asserts each name differs from the control's
placeholder.

## 3. Evidence (assertion, not axe)

New spec: `e2e/settings-labels.e2e.spec.ts` (5 tests, run green 5× consecutively).

- **Required role query resolves:**
  `getByRole('textbox', { name: 'Brand Voice' })` → visible.
- **All 12 controls** assert a non-empty accessible name via
  `expect(locator).toHaveAccessibleName(<name>)`:
  Brand Voice, Writing Style Notes, Target Audience, Content Goals, Niche / Expertise,
  Messaging pillar 1–5, Username, Access Token.
- Aggregate test names every offender if any control is unnamed; asserts
  `placeholder` is not the source of the name.
- Connect-dialog controls additionally assert the association is a real
  `label[for] ↔ id` link (not just `aria-label`).

**axe (full rule set), `/settings`:** accounts tab, Brand Profile tab, and Connect dialog
all report **zero violations** — no regression.

### Note on a transient axe artifact
A first pass sampled the Connect dialog mid-fade (Radix enter animation) and axe
mis-reported `color-contrast` on the dialog help `<p>`. Verified this is **not** a code
regression: a baseline probe against the pre-fix bundle, and repeated probes against the
fixed bundle, both report `[]` once the animation settles. The axe test emulates
`prefers-reduced-motion: reduce` (which the app honors) so it measures the settled state
deterministically. The help-text contrast was never touched by this change.

## 4. Verification commands

- `npm run check` → clean (tsc).
- `npm run build` → clean.
- `npx playwright test e2e/settings-labels.e2e.spec.ts` → 5 passed (×5 runs).
- Existing settings specs: `npx playwright test e2e/accessibility.e2e.spec.ts
  e2e/routes.e2e.spec.ts` → **54 passed** (including `axe: /settings`, `route /settings
  loads`, and `color-contrast is enforced on every canonical route`).

Env used: `E2E_PORT=4502`, `DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e`,
production bundle via `npm run build` → `npm start`.
