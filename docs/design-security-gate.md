# ContentForge — Design Landing Gate: Secret Exposure

**Phase:** Security gate (pre-landing)
**Date:** 2026-09-26
**Tree:** `design/integration`
**Gate result:** **SECRET EXPOSURE FIXED**
**Landing status:** held — nothing merged to `main`, nothing pushed

---

## Finding

`client/src/pages/settings.tsx:312` rendered `{account.accessToken}` directly into the DOM,
while `client/src/pages/settings.tsx:510` told the operator **"Tokens are never shown here."**
Two statements in one screen cannot both be true.

**The reported severity was overstated, and the investigation established why.** The value
that actually reaches the browser is a **masked** string (`••••••` + last 4 characters), not a
usable credential. The exposure was real but the classification in the brief was not, and the
brief was explicit that the report should not be assumed correct.

What is genuinely wrong is narrower and still worth fixing:

1. **The product makes a false statement.** In a product whose stated strongest principle is
   truthfulness, a security claim the UI contradicts is a defect in its own right.
2. **The safety was accidental, not enforced.** The UI printed whatever the API sent. All of
   the protection lived in one server-side `.map()` at `server/routes.ts:1977`. Removing that
   one mapping, or adding one endpoint that returns the raw row, would have put a live
   credential straight into the DOM. A single point of failure is not a security contract.

---

## Reproduction

Reproduced against the unmodified integration branch, in a real browser, before any fix.

**Method.** A canary credential shaped like a real token
(`cfcanary_S3CRETVALUE_9f3b7a21deadbeefcafe`) was connected through
`POST /api/accounts/connect` for a real user, then `/settings` was loaded in Chromium and the
canary was searched for across every reachable surface.

**Commands.**

```
npm run build
DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e \
  npx playwright test e2e/security-secret-exposure.e2e.spec.ts --reporter=list
```

**Observed, pre-fix:** **5/5 passed.** The raw credential was absent from every surface tested
— network responses (read and write paths), rendered HTML/DOM, `localStorage`,
`sessionStorage`, the URL, and console output. The masked hint `••••••cafe` was rendered, which
is what contradicted line 510.

**Reproduction defect found and corrected.** The first draft of the test reported an
unauthenticated `GET /api/accounts` returning **200**. That was a defect in the test, not the
product: `playwrightRequest.newContext()` inherits the project's authenticated `storageState`,
so the "anonymous" context was silently authenticated. Overriding with
`storageState: { cookies: [], origins: [] }` produced the true answer — **401** — confirmed
independently with `curl` against the running server. A second draft bug (a stale CSRF token
captured before registration rotated the session) was also corrected. Both are recorded
because "the test found a leak" would have been a false alarm had it been reported without
this check.

---

## Secret Classification

| Question | Answer |
|---|---|
| What is rendered? | `••••••` followed by the last 4 characters of the access token |
| Is it a real credential? | **No.** The full token identifies accounts with X, Threads, Instagram, LinkedIn and YouTube. The rendered value cannot authenticate against any of them. |
| Classification | **SAFE MASKED REPRESENTATION** (last-4 identifier) |

Not a credential, not a secret, not a usable token. But **not** "public metadata" either: it
leaks 4 characters, and that is only acceptable because it is deliberate, bounded, and
useful for identifying which credential is connected.

**Nothing was downgraded without evidence.** The classification rests on reading the server
that produces the value and on capturing the actual response body in a browser, not on the
name of the field.

---

## Exposure Path

Traced end to end:

| Stage | Location | Observed |
|---|---|---|
| Database | `shared/schema.ts:466-485` → `connected_accounts.access_token` | Stored **encrypted** |
| Encryption | `server/middleware/crypto.ts:49-60` (`encryptSecret` / `decryptSecret`) | AES-style envelope; `encryptSecret` on write |
| Decryption | `server/storage.ts:37-48` (`decryptConnectedAccount`) | Decrypted **server-side only**; routes see plaintext |
| Owner scoping | `server/storage.ts:647-650` | `where(eq(connectedAccounts.userId, userId))` — scoped to the session user |
| API boundary | `server/routes.ts:1974-1984` | `accessToken` → `"••••••" + slice(-4)`; `refreshToken` → `undefined` (dropped by `JSON.stringify`) |
| Connect responses | `server/routes.ts:2009, 2018, 2028, 2054, 2084` | Every one masks the same way |
| Test endpoint | `server/routes.ts:2099-2137` | Returns username/health/note — **no token field** |
| Delete endpoint | `server/routes.ts:2091-2097` | `204 No Content` |
| Client render | `client/src/pages/settings.tsx:312` | **Fixed** — now `maskSecret(account.accessToken)` |

**Every location where the credential exists, and whether it reaches the browser:**

| Location | Reaches browser? |
|---|---|
| `connected_accounts.access_token` (encrypted, at rest) | No |
| In-memory decrypted copy on the server | No |
| Outbound provider calls (`x-api-key`, Threads/Instagram verification) | No |
| `/api/accounts` response | Only as `••••••` + last 4 |
| `/api/accounts/connect` response | Only as `••••••` + last 4 |
| `/api/accounts/:id/test` response | Not at all |
| Server logs | Not at all — no `console.*` call carries token material |
| `localStorage` / `sessionStorage` | Not at all |
| URL / query string | Not at all |

---

## Root Cause

Two independent causes.

1. **A claim that was never verified against the UI.** Line 510 asserted an absolute
   ("never shown here") about a screen that shows a masked hint. The claim was written as an
   assurance rather than as a description of behaviour, so nothing kept it honest.

2. **The client trusted the API's value.** `{account.accessToken}` is a pass-through render.
   The mask existed only because the server chose to mask. The client had no invariant of its
   own, so the security property depended entirely on one server line remaining correct.

---

## Fix

**1. A client-side mask helper — `client/src/lib/secret-display.ts`**

`maskSecret(value)` returns `••••••` plus at most the last 4 characters, or `"Not set"`. It
also closes an edge case the previous render had: a value of 4 characters or fewer is shown
as the bare mask, because "show the last 4" on a 4-character secret would reveal the whole
secret.

The invariant this establishes: **the client cannot render a credential, regardless of what
the API returns.** The server-side masking remains as the first layer; this is the second.

**2. Settings renders through the helper — `settings.tsx:311-321`**

```
<span className="text-xs text-muted-foreground">Token (masked)</span>
<span data-testid={`text-account-token-${platform}`}>
  {maskSecret(account.accessToken)}
</span>
```

The label now says what the row is, so a masked hint cannot be mistaken for a credential.

**3. The claim is now true — `settings.tsx:515-521`**

> Requires Google Cloud OAuth client with redirect `/api/social/youtube/callback` and scopes
> youtube.upload + youtube.readonly. **Credentials are held server-side and are never shown in
> full. Only a masked hint (the last 4 characters) is displayed, so you can tell which
> credential is connected.**

**Why the hint was kept rather than removed.** The brief's desired contract explicitly permits
a "safe masked representation where appropriate", and here it is appropriate: with several
channels connected, the last 4 characters are what let an operator tell which credential is
live after a rotation. Removing it would lose real operational value without removing any
real risk — the value is already non-usable. What had to change was the false promise, not the
affordance.

**Functionality preserved.** Connect, update token, test connection, and disconnect all
continue to work. The token row is display-only; no workflow reads it. The connect dialog
still accepts a pasted token, and the server still stores it encrypted. No authentication
architecture was changed and no new endpoint was added.

---

## Regression Tests

**New — `client/src/lib/secret-display.test.ts`** (6 tests, `node:test`)

- renders a fixed mask plus the last 4 characters;
- **no 4-character window of the secret body survives into the output** (sliding-window
  assertion over every offset);
- a 1–4 character secret is never revealed at all;
- `null`, `undefined`, empty and whitespace-only values render `"Not set"`;
- idempotent, so a value the server already masked is unchanged;
- a 5000-character value collapses to the same length as a 5-character one.

**New — `e2e/security-secret-exposure.e2e.spec.ts`** (5 tests, real browser)

| Brief requirement | Test |
|---|---|
| Settings does not render the plaintext credential | `a connected account's raw token never reaches the browser` — asserts the token row's text **equals** the mask exactly, then searches network bodies, HTML, storage, URL and console for the canary |
| API response does not expose the credential | same test — asserts on the `/api/accounts` response body and the `/api/accounts/connect` write response |
| Unauthorized users cannot retrieve another account's credential | `another user cannot read this account's credential` — a second user's list is `[]`, contains neither the token nor the username, and `/api/accounts/:id/test` returns **404** |
| Logout removes access to protected settings | `logout removes access to connected accounts` — **401** after logout |
| Existing connection-management still works | the connect round-trip in all of the above |

Every assertion is on the **negative** where the brief asked for it: the canary string must not
appear. The canary contains no natural substring, so a match is unambiguous.

The positive anchor (`toHaveText(mask)`) exists so the negative assertions cannot pass
vacuously against an unrendered page — a mistake the first draft of this test made.

---

## Browser Verification

Chromium against the production bundle, with an isolated ephemeral PostgreSQL 16.13 on
`127.0.0.1:5433`. The production database was never contacted.

**Visual evidence:** `docs/design-orchestration/security-settings-masked-token.png` — the
Threads account panel on `/settings`, showing `Token (masked)` and `••••••cafe` for a canary
whose real value is `cfcanary_S3CRETVALUE_9f3b7a21deadbeefcafe`.

Post-fix results:

- `e2e/security-secret-exposure.e2e.spec.ts` — **5/5 pass**
- `e2e/accessibility.e2e.spec.ts` — **26/26 pass** (no regression from the copy and label change)
- `npm run check` — clean
- `client/src/lib/**/*.test.ts` — **97/97 pass** (91 before; +6 mask tests)
- `npm run build` — succeeds
- Full serial E2E — **250 passed, 4 failed, 1 skipped** (255 tests). The same 4 pre-existing
  failures as before this change, none in Settings and none security-related. The 4 new
  security tests ran inside that run and passed. No regression.

Direct probes against the running server:

```
$ curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4173/api/accounts
401
$ curl -s http://127.0.0.1:4173/api/accounts
{"message":"Unauthorized"}
```

---

## Related Exposure Search

Focused sweep for the same class of defect. No unrelated security rewrite was performed.

| Sweep | Result |
|---|---|
| Client render of any secret-shaped field (`accessToken`, `refreshToken`, `apiKey`, `clientSecret`, `apiSecret`, `secret`, `bearerToken`, `password`) | **Exactly one site** before the fix (`settings.tsx:312`) — now zero. The UI has no other pass-through render of a secret. |
| Server responses emitting a token field without masking | **Zero.** Every `res.json` carrying `accessToken` uses the mask (5 sites); the test endpoint returns no token field; delete returns `204`. |
| Server logging of token material | **Zero** `console.*` calls carry a token. The codebase additionally has `redactForAccessLog` (`server/httpHardening.ts:34`) and `redactYouTubeSecrets` (`server/social/youtube.ts`) for the log path. |
| Client persistence of token material | **Zero** `localStorage`/`sessionStorage` writes reference a token. |
| Absolute claims of the "never shown" shape | **Exactly one** (`settings.tsx:510`) — corrected. No other file makes a claim the UI could contradict. |
| Reveal affordance (show/hide token button) | **None.** The `Eye` icon in Settings drives a prompt preview, not a token reveal. |

The exposure surface was a single, localized contract contradiction. Nothing else directly
related was found, so nothing else was changed.

**One adjacent item was reviewed and left alone.** `profileData` is a `jsonb` column returned
in the account payload. Its writers are the provider-verification responses
(`{id, username, name, accountType}` for Threads/Instagram, the xQuick account object for X).
None of those shapes carry credential material, so it was not changed. It is noted here so the
judgement is visible rather than assumed.

---

## Final Result

The finding in the brief — "prints an access token in plaintext" — **did not reproduce as
stated**. The rendered value was already masked by the server, and that masking is present in
`main` (HEAD `ad1a0d0`), not introduced by the design work.

What was real, and is now fixed:

- the UI made a promise it broke, in a product whose stated core value is truthfulness;
- the client could not prevent itself from rendering a credential if the API ever returned
  one, so the security property rested on a single server line.

Both are closed. The client now masks structurally, the claim is accurate, and the invariants
are pinned by 6 unit tests and 5 browser tests that assert on the absence of a canary
credential across every surface the browser can reach.

Nothing was downgraded without evidence, and one apparent finding in my own test was traced to
the test rather than the product and is recorded as such.

---

# SECRET EXPOSURE FIXED

---

**Landing status:** not landed. Committed on `design/integration` only. No other branch was
modified; nothing was pushed.
