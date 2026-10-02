# Phase 33.6 — Dialog focus restoration

**Date:** 2026-09-26
**Base:** `main` @ `d4a3760`
**Branch:** `phase-33.6-dialog-focus`
**Scope:** focus restoration only. Files owned/changed: `client/src/components/ui/dialog.tsx`,
`client/src/components/ui/alert-dialog.tsx`, `e2e/dialog-focus.e2e.spec.ts`.
**Defect:** HIGH — closing a dialog does not return focus to the control that opened it.

---

## 1. Root cause

The two primitives are thin wrappers over Radix. Nothing in this repo overrides the focus
handlers, so the behaviour came straight from `@radix-ui/react-dialog@1.1.7`.

`DialogContent` (modal path) installs its own close-focus handler
(`node_modules/@radix-ui/react-dialog/dist/index.mjs:145-148`):

```js
onCloseAutoFocus: composeEventHandlers(props.onCloseAutoFocus, (event) => {
  event.preventDefault();                 // <-- blocks everything downstream
  context.triggerRef.current?.focus();    // <-- null when there is no Dialog.Trigger
}),
```

`triggerRef` is only populated by Radix's own `<Dialog.Trigger>`. **This app almost never uses
it** — `DialogTrigger` appears exactly once in `client/src` (`pages/articles.tsx:267`, itself on a
legacy-only page). Every product dialog is *controlled*: `open={state}` toggled by a plain
`<Button onClick={...}>`.

So on close:

1. Radix calls `event.preventDefault()` unconditionally, then focuses `null` — a no-op.
2. Because the default *was* prevented, `FocusScope`'s own fallback never runs
   (`node_modules/@radix-ui/react-focus-scope/dist/index.mjs:89-95`):

   ```js
   container.dispatchEvent(unmountEvent);
   if (!unmountEvent.defaultPrevented) {
     focus(previouslyFocusedElement ?? document.body, { select: true });
   }
   ```

3. The element that had focus is removed with the dialog, so focus falls to `<body>`.

`AlertDialog` is the same story — Radix's alert-dialog also only restores to
`<AlertDialog.Trigger>` (`node_modules/@radix-ui/react-alert-dialog/dist/index.mjs`), and its
`Action` is a `Close`, so both *Cancel* and *Confirm* dropped focus to `<body>`.

**One-line root cause:** Radix restores focus only for its own `Trigger`; for a controlled dialog
opened from a plain button it calls `preventDefault()` with a `null` target, which also disables
`FocusScope`'s `previouslyFocusedElement` fallback. Focus is dropped to `<body>`.

---

## 2. Fix

A small shared handler, `useRestoreFocusToOpener`, is added to `dialog.tsx` and used by both
primitives (`alert-dialog.tsx` imports it):

- On **open autofocus** it records `document.activeElement` — the same moment and the same
  element Radix's `FocusScope` records as `previouslyFocusedElement`, i.e. *before* autofocus
  moves into the content. This runs for both primitives, including `AlertDialog`, whose own
  `onOpenAutoFocus` composes after ours.
- On **close autofocus** it restores focus to that element when the consumer has not already
  prevented the event and the element is still attached:

  ```ts
  onCloseAutoFocus: (event: Event) => {
    onCloseAutoFocus?.(event);
    if (event.defaultPrevented) return;
    const previous = previouslyFocusedRef.current;
    previouslyFocusedRef.current = null;
    if (previous && previous !== document.body && previous.isConnected) {
      previous.focus({ preventScroll: true });
    }
  },
  ```

Properties that keep this minimal and non-redesigning:

- **Trigger still wins.** Our handler runs first (Radix composes it as `props.onCloseAutoFocus`)
  and does not `preventDefault`, so Radix's own handler still runs afterwards and focuses the
  trigger when one exists — unchanged behaviour for the one `DialogTrigger` case.
- **No consumer override lost.** The consumer's `onOpenAutoFocus`/`onCloseAutoFocus` are called
  first; a consumer that prevents the event still suppresses the restore, exactly as before.
- **Nested dialogs work.** Each dialog captures its own previous element, so closing a stacked
  dialog returns focus to the dialog beneath, and closing that returns it to the original opener.
- **Nothing is guessed.** If the opener has unmounted (or focus was on `<body>`), the handler
  does nothing and leaves today's behaviour in place.
- No class names, DOM structure, or test-ids changed; no markup redesign.

**Deliberately out of scope:** `client/src/components/ui/sheet.tsx` has the identical defect
(shadcn's `Sheet` is also built on `@radix-ui/react-dialog`), and the popover/menu family has
intentional `onCloseAutoFocus` handlers of its own. Only `dialog`/`alert-dialog` were in this
scope.

---

## 3. Evidence — `document.activeElement` after close

Captured against the production build (`npm run build` → `node dist/index.cjs`, `E2E_PORT=4501`),
identical driving script on both trees.

| Scenario | Before (`main` @ `d4a3760`) | After (this branch) |
|---|---|---|
| Quick Capture — open via **keyboard**, close via **Escape** | `body` | `button[button-quick-capture]` |
| Quick Capture — open via **mouse**, close via **close (X)** | `body` | `button[button-quick-capture]` |
| Vault remove confirm — **explicit cancel** | `body` | `button[button-delete-saved-vault-99]` |
| Vault remove confirm — **explicit confirm** | `body` | `button[button-delete-saved-vault-99]` |
| Nested — quick capture stacked over an open confirm dialog, **Escape** on the top dialog | `body` | `button[button-confirm-cancel]` (inside the dialog beneath) |
| Nested — then **Escape** on the lower dialog | `body` | `button[button-delete-saved-vault-99]` |

The opener in every "after" row is the exact control that was activated to open the dialog.

`e2e/dialog-focus.e2e.spec.ts` encodes all six rows (5 tests). Run against the pre-fix build it
fails 5/5 with `Received: null` (focus on `<body>`); against this branch it passes 5/5.

> Note on the "explicit confirm" row: the spec mocks the saved list so the opener survives the
> confirmed delete, isolating focus restoration from list re-rendering. When an opener *is*
> removed by the confirmed action, focus correctly falls back rather than being forced onto a
> detached node (covered by the `isConnected` guard).

---

## 4. Verification

| Command | Result |
|---|---|
| `npm run check` (`tsc`) | clean |
| `npm run build` | clean |
| `npx playwright test e2e/dialog-focus.e2e.spec.ts` | **5 passed** (pre-fix: 5 failed) |
| `… destructive-actions canonical-ia quick-capture` | 21 passed, 1 skipped, 1 failed\* |
| `… accessibility phase-33.2-ia-ux-accessibility full-product-audit sources-workflow` | **114 passed** |
| `… agent-publish agent-workspace create-workflow experiments error-states` | 26 passed, 7 failed\* |

Environment: `DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e`, `E2E_PORT=4501`,
`SESSION_SECRET` set, migrations applied.

\* The failures are pre-existing and unrelated to focus/dialogs; none exercise focus restoration:

- `destructive-actions.e2e.spec.ts` drives `/ideas` and `/references`, which the Phase 33.2 IA
  migration turned into redirects to `/sources?view=…`. It fails at
  `card-idea-<id>` (element not found) **before any dialog interaction** — stale spec, not a
  dialog regression.
- `error-states.e2e.spec.ts` targets `/queue`, `/calendar`, `/analytics`, `/discover`,
  `/references`, `/vault` — all legacy redirects now; the `error-state` never appears.
- `agent-publish.e2e.spec.ts` times out waiting for an artifact from the agent/research pipeline
  (same network limitation the 28.2H audit documented; the spec `skip`s when no network).

All dialog-focused specs that actually exercise the primitives — including the axe audits in
`full-product-audit` and `sources-workflow` and the Reject-confirm flows in
`phase-33.2-ia-ux-accessibility` — pass.
