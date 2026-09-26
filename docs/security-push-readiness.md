# ContentForge — Security Push-Readiness Verification

**Date:** 2026-09-26
**Worker:** SECURITY VERIFICATION (read-only)
**Read-only target:** `/Users/kishore/git/ContentForge` (shared object store)
**Worktree:** `/Users/kishore/git/cf-design/sec` — branch `phase-security-verification`
**Question:** is this repository safe to push to `origin/main`?

**Verdict at the bottom of this file.**

---

## Summary

The **push itself is content-clean** — no secret is reachable from any ref, and none would be
transmitted. But the **repository is not clean**: the leaked `.env.orig-backup` object still
physically exists in the local object store (recoverable by a local clone or a `.git` backup),
it holds live credentials, and the `.gitignore` gap that let it be committed is still open.

| # | Check | Result |
|---|---|---|
| 1 | Tracked secrets | **PASS** — no real credential tracked |
| 2 | `.env.orig-backup` reachable from any ref | **PASS** — unreachable from every ref |
| 3 | Residual unreachable objects | **FAIL** — leaked blob + tree still present in the pack |
| 4 | `.gitignore` `.env` family coverage | **FAIL** — only exact `.env` is ignored (gap) |
| 5 | Branch / remote state | **PASS** — `origin/main` untouched, nothing pushed |
| 6 | Settings credential masking | **PASS** — ≤ last 4 characters exposed |
| 7 | Browser exposure (canary) | **PASS** — 5/5, absent from every surface |
| 8 | Runtime boot & auth | **PASS** — production bundle boots and authenticates |

---

## Check 1 — Tracked secrets — PASS

```
$ git ls-files | grep -Ei '\.env|\.pem$|\.key$|credential|secret'
.env.example
client/src/lib/secret-display.test.ts
client/src/lib/secret-display.ts
e2e/security-secret-exposure.e2e.spec.ts

$ git grep -lIE 'BEGIN (RSA|EC|OPENSSH)? PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|xox[baprs]-…|sk-[A-Za-z0-9]{32,}|AIza[0-9A-Za-z_-]{35}|cfcanary_[A-Za-z0-9_]+' -- . ':!package-lock.json'
client/src/lib/secret-display.test.ts
docs/design-security-gate.md
e2e/security-secret-exposure.e2e.spec.ts

$ git grep -nIE '(SECRET|API_KEY|ACCESS_TOKEN|CLIENT_SECRET|PASSWORD)[[:space:]]*[:=][[:space:]]*[A-Za-z0-9_/+.-]{16,}' -- . ':!package-lock.json' ':!*.md'
.env.example:24:XQUIK_API_KEY=<placeholder>
.github/workflows/e2e.yml:43:SESSION_SECRET=ci-e2e-session-secret-not-for-production
docker-compose.yml:36:SESSION_SECRET=change-me-in-production
server/**/*.test.ts:…:KEY: process.env.KEY   (env reads, not literals)
```

No secret-shaped file is tracked. `.env.example` holds placeholders only. The token-shaped hits
are the deliberate test canary `cfcanary_…` in the two security test files and the doc that
documents it. No real credential is tracked. **PASS.**

## Check 2 — `.env.orig-backup` reachable from any ref — PASS

```
$ git log --all --oneline -- '.env.orig-backup'
(empty)

$ git rev-list --all --objects | grep -Ei 'orig-backup'
(empty)                        # only *.env.example blobs are listed

$ git for-each-ref --format='%(objecttype) %(objectname) %(refname)' | awk '$1!="commit"'
tree f59768fe… refs/codex/turn-diffs/checkpoints/…   # inspected: carries .env.example only, NOT .env.orig-backup
```

The path `.env.orig-backup` is **unreachable from every ref** (35 commit refs + 1 tree ref, all
inspected). It cannot be sent by `git push` and was never on a remote. **PASS.**

## Check 3 — Residual unreachable objects — FAIL

```
$ comm -23 <(git cat-file --batch-all-objects --batch-check='%(objectname)' | sort -u) \
           <(git rev-list --all --objects | awk '{print $1}' | sort -u)
9d83f21eabca29a15b8423fc04790d44e0991b28 type=tree
a32bcae25aea151ca4eb0ef51fa78f0edbd5acd9 type=blob

$ git verify-pack -v …/pack-ab13a4b8584f37d75e5c2fe22c0670e278f3c301.idx | grep -E '9d83f21e|a32bcae'
9d83f21e… tree 2253 1849 91334
a32bcae…  blob 4403 2145 17655769
f996b8c6… tree 111 126 93183 1 9d83f21e…        # reachable deltas, base = leaked tree
d528a960… tree  32  49 17702466 1 9d83f21e…
a5181ded… tree  82  99 17702515 1 9d83f21e…
1b75b90f… tree  82  99 17702790 1 9d83f21e…

$ git cat-file -p 9d83f21e… | grep env.orig-backup
100644 blob a32bcae25aea151ca4eb0ef51fa78f0edbd5acd9	.env.orig-backup

$ git fsck --unreachable
(empty)
```

The leaked file `.env.orig-backup` (blob `a32bcae…`) and the root tree that carries it
(`9d83f21e…`) are **still in the object database, inside the pack**. The tree survives as a
**delta base for four reachable trees**, which is why `git fsck --unreachable` reports nothing.
The landing report's claim of "`.env.orig-backup` unreachable from every ref, **0 objects**"
(`docs/final-design-landing-report.md`, §7) is therefore **not reproducible**: reachability is
zero, but the object count is two, not zero. `git fsck` is not a sound proof of purge here.

- **Effect on `git push`: none.** Push transmits only objects reachable from the pushed refs;
  these two are unreachable.
- **Effect on a local clone or backup: real.** `git clone <local path>` (hard-linked objects)
  and any filesystem copy of `.git/` carry the pack; the blob is directly recoverable with
  `git cat-file blob a32bcae…`. **FAIL.**

## Check 4 — `.gitignore` `.env` family coverage — FAIL

```
$ grep -nE 'env' .gitignore
7:.env
```

Only the exact name `.env` is ignored. `.env.*`, `*.env`, `*.env.*`, `.env.orig-backup`,
`.env.local`, `production.env` are **not** covered. This is the precise gap that let the leaked
file be committed — the landing report states it outright: *"`.env` is gitignored;
`.env.orig-backup` is not, because the ignore rule matches the exact filename."* **This is a
finding. FAIL.**

## Check 5 — Branch and remote state — PASS

```
$ git ls-remote origin main
d9db1a70c4ddd4c3ff51c3ecbe3beb1795fa2640	refs/heads/main      # live remote (read-only)
$ git rev-parse origin/main   -> d9db1a70…   (identical)
$ git rev-parse main          -> bcf14704…
$ git merge-base --is-ancestor origin/main main && echo fast-forward   -> fast-forward
$ git log --oneline origin/main..main | wc -l   -> 20
$ git diff --shortstat origin/main..main        -> 131 files changed, 11367 insertions(+), 1629 deletions(-)
$ git tag -l | wc -l                            -> 0
```

`origin/main` is untouched (`d9db1a7`, confirmed against the live remote, not just the local
tracking ref). `main` is a strict fast-forward of it; **nothing has been pushed**. A push of
`main` would fast-forward `origin/main` `d9db1a7 → bcf1470`. **PASS.**

## Check 6 — Settings credential masking — PASS

Server (`server/routes.ts`):

```
1979  accessToken: a.accessToken ? "••••••" + a.accessToken.slice(-4) : null,   // GET /api/accounts
                                                      refreshToken: undefined
2009/2018/2028/2054/2084  return res.json({ ...account, accessToken: "••••••" + accessToken.slice(-4) … })
2099-2138  POST /api/accounts/:id/test -> { success, username, health, isActive, note } — no token field
```

Client: `client/src/lib/secret-display.ts` `maskSecret` returns a fixed mask plus **at most the
last 4** characters, and returns the bare mask for any value of 4 characters or fewer;
`client/src/pages/settings.tsx:319` renders `maskSecret(account.accessToken)`.
**Maximum exposure is the last 4 characters. PASS.**

## Check 7 — Browser exposure — PASS

```
$ npm run build
$ E2E_PORT=4203 DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e \
    npx playwright test e2e/security-secret-exposure.e2e.spec.ts --reporter=list
  ✓ a connected account's raw token never reaches the browser
  ✓ another user cannot read this account's credential
  ✓ an unauthenticated caller cannot read connected accounts
  ✓ logout removes access to connected accounts
  ✓ [setup] register (or login) and persist session
  5 passed (3.8s)
```

Against the production bundle, the canary `cfcanary_…cafe` is absent from network responses
(read and write paths), rendered DOM/HTML, `localStorage`, `sessionStorage`, the URL and
console; the token row renders exactly the mask. **PASS.**

## Check 8 — Runtime credentials still work — PASS

The same run proves the app **boots on the production bundle and authenticates**: the setup
project registered a session, `/api/accounts/connect` and `/api/accounts` round-tripped,
anonymous → 401, cross-owner → 404, post-logout → 401. Only the in-repo canary and the local
Postgres `:5433` were used. **No external paid provider was contacted. PASS.**

---

## What a `git push origin main` would and would not transmit

- **Would transmit:** the 20 commits `ce884ea..bcf1470` and the trees/blobs reachable from them
  (131 files, +11367/−1629). Zero tags.
- **Would NOT transmit:** `.env.orig-backup`, or any object reachable only from it. No `.env*`
  path appears in `git diff --name-only origin/main..main`, and the leaked blob/tree are
  unreachable from every ref.
- Net: the push content is clean.

## Credentials to ROTATE

The persisted `.env.orig-backup` object (blob `a32bcae…`, in the pack) contains **live** values.
A local clone or a `.git` backup exposes them, so the following must be rotated. Key names only,
file `.env.orig-backup`; no value is recorded here.

`AI_API_KEY`, `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`,
`X_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`, `FAL_KEY`, `ELEVENLABS_API_KEY`, `SESSION_SECRET`,
`DATABASE_URL` (its embedded Postgres credential).

## Remediation

1. Physically drop the two objects and verify with the `comm` command in Check 3 — **not** with
   `git fsck`: e.g. `git reflog expire --expire=now --all && git gc --prune=now`, or re-clone.
2. Close the ignore gap: add `.env.*`, `*.env`, `*.env.*` (with `!*.env.example`) to `.gitignore`.
3. Rotate the credentials listed above.

---

**SECURITY ISSUE REMAINS**
