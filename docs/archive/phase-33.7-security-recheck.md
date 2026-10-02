# ContentForge — Phase 33.7 Security Re-check (auth boundary)

**Scope:** Independent re-test of the `/api` authentication boundary on the current tree.
**Worktree/branch:** `/Users/kishore/git/cf-design/337sec` @ `phase-33.7-security-recheck` (from `main` @ `63d6158`).
**Mode:** READ-ONLY. No production code, test or config was modified. Only this report was written.
**Runtime:** built with `npm run build` → `node dist/index.cjs`
`DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e`, `PORT=E2E_PORT=4608`,
`NODE_ENV=production`, `SESSION_COOKIE_SECURE=0`, `CONTENTFORGE_E2E_SERVER=1`, `SESSION_SECRET` set (value never printed).

**Overall verdict: PASS.** No live fail-open owner fallback. No paid endpoint reachable anonymously. Owner isolation holds. Allowlist intact.

---

## 1. Case variants — VERIFIED

`/api`, `/API`, `/Api`, `/aPi`, and mixed-case inside the path (`/API/Research/Jobs`, `/API/Autonomy/Status`),
across GET/POST/PUT/PATCH/DELETE, against 16 representative protected endpoints
(research jobs, artifacts, publications, schedule-occurrences, autonomy status/enable,
experiments, learning, policy-candidates, accounts, settings) → **400/400 returned `401`**.

```
$ bash casecheck.sh
TOTAL=400 NON401=0
```

No handler / provider side effect: owner-1 and NULL-owner row counts in the seeded tables
(research_jobs, artifacts, publications, autonomy_configs, experiments, learning_signals,
policy_candidates, opportunities, generation_jobs, stories) were **byte-identical before and after**
two full 400-request sweeps (`owner_before.txt` == `owner_after.txt`). Every `/api` request was logged
`401 in 0ms :: {"message":"Unauthorized"}`.

Positive proof the gate (not a 404) is what blocks these: with a real session the **same** case variants
are served — `/api|/API|/Api|/aPi/research/jobs`, `/API/Research/Jobs`, `/API/ARTIFACTS`,
`/Api/Autonomy/Status` all returned **200** while authenticated (Express routing is case-insensitive;
the gate lowercases `req.path`, so it can never be stepped aside).

`/api/health`, `/API/health`, `/Api/Health`, `/aPi/HEALTH` → 200 (allowlisted, case-folded).

## 2. No owner fallback — VERIFIED (no live fail-open fallback)

Whole production tree searched (`server/**`, excluding `*.test.ts`/`*.dbtest.ts`):

* `?? 1` / `|| 1` — every hit is a **non-owner** default: `research/providers/last30days.ts:119`
  (`code`), `research/intelligence.ts:475,511` (counts), `content/automationStorage.ts:157`,
  `content/storage.ts:531,886,942,1116` (`version`/`variationCount`/`planVersion`),
  `content/routes.ts:2169` (`frozenReferences.length`), `content/visualService.ts:391`,
  `content/visualProviders/openaiImage.ts:99`, `content/videoRepurpose.ts:166` (`failAtIndex`),
  `content/distribution.ts:140` (`count`), `content/styleService.ts:251` (`sampleCount`),
  `content/repurposing.ts:361,367` (`slot`/`count`), `jobs/envelope.ts:70` (`attempt`).
  The only mentions of the string `getUserId(req) ?? 1` are **comments** in
  `middleware/userContext.ts:92` and `middleware/authGate.ts:41` describing the *removed* pattern.
* `getUserId(req)` call sites — all are fail-closed: `content/routes.ts` (22 sites) and
  `story/routes.ts:122,143` feed `isForeignRow`/`!==` ownership compares (foreign → non-leaking 404);
  `routes.ts:1885,1912,2033,2058` assign the session owner into storage;
  `routes.ts:1952` is `pending.ownerUserId ?? getUserId(req) ?? null` → falls back to **null, not 1**.
* Fail-closed helpers: `sessionUserId()` (`routes.ts:56`) throws; `requireOwnerId()` (`userContext.ts:106`)
  throws; `requireUserId()` (`userContext.ts:61`) returns 401.
* No `ownerId = 1` / `userId = 1` default assignments in production code (only test-seed helpers and e2e scripts).
* Corroboration: `node --import tsx --test server/middleware/authGate.test.ts` → 10/10 pass, including the
  static pin “no owner-1 fallback remains in the central identity helpers”.

**No live fail-open fallback. Nothing to classify as a BLOCKER.**

## 3. Paid endpoints unreachable anonymously — VERIFIED

15 paid/provider-touching routes POSTed with no session, all **401**:
`/api/generate`, `/api/generate/from-sources`, `/api/images/generate`, `/api/images/generate-for-post`,
`/api/carousels/generate`, `/api/video-generations`, `/api/audio/generations`, `/api/visual-generations`,
`/api/articles/1/publish`, `/api/posts/1/publish`, `/api/artifacts/1/publications`,
`/api/publications/dispatch`, `/api/content-actions/generate`, `/api/chat/message`, `/api/agent/runs`.
The global `authGate` (`server/index.ts:205`, mounted before every router) short-circuits all of them.

## 4. Owner isolation (two real users) — VERIFIED

Two real accounts registered over HTTP (userA=391, userB=392). Seeded one full owned row-chain per user
(story→opportunity→artifact→schedule→occurrence→publication→result, plus research job, experiment+variant,
policy candidate, learning signal, connected account, autonomy config + decision). **55/55 assertions pass.**

* A→B reads all **404** (non-leaking): research job, artifact, artifact history, publication,
  publication result, schedule, experiment, policy candidate, learning signal, publication performance.
* A→B mutations all blocked and **B’s rows unchanged in SQL**: `POST /artifacts/:id/approve` → 404
  (B artifact still `draft`, `approved_at NULL`); `POST /experiments/:id/start` → 404 (B status `ready`);
  `POST /learning/publications/:id/refresh` → 404; `DELETE /accounts/:id` → 404 (B account still present);
  `POST /accounts/:id/test` → 404.
* A’s autonomy status returns **A’s** mode (`recommend`), B’s returns `observe_only`; B config untouched.
* List endpoints exclude the other owner’s ids (research jobs, artifacts, experiments, accounts,
  autonomy decisions, learning signals, schedule-occurrences).
* Positive controls: A reads its own research job / artifact / publication / experiment / learning signal → **200**;
  own occurrence and account appear in A’s lists. Symmetric checks (B→A) → 404.

```
$ node isolation.mjs
SUMMARY checks=55 failed=0
```

## 5. Allowlist intact — VERIFIED

* Anonymous `/api/health` → 200, `/api/ready` → 200, `/api/csrf-token` → 200.
* `/api/auth/*` is public **by design** (login/register/OAuth/config): `/api/auth/config` → 200;
  `/api/auth/me` passes the gate but its handler self-guards → **401**.
* Everything else is gated: 400 case-variant requests + an 84-endpoint anonymous root scan
  (`/api/pillars`, `/api/posts`, `/api/accounts`, `/api/autonomy`, `/api/experiments`,
  `/api/policy-candidates`, `/api/learning/*`, `/api/agent/*`, `/api/automation`, …) → **all 401**.
  Allowlist read from code is exactly `PUBLIC_API_EXACT=[/api/csrf-token,/api/health,/api/ready]`,
  `PUBLIC_API_PREFIXES=[/api/auth/]`.

```
$ while read p; do curl -s -o /dev/null -w '%{http_code}' $BASE$p; done < roots.txt
anon root-scan: total=84 non401=0
```

Also verified: `HEAD` and `OPTIONS` on a protected path → 401; forged client identity
(`X-Owner-Id`, body/query `ownerId`) is ignored (401) per the authGate test.

---

## Observations (non-blockers, no data exposure)

1. **Access-log case gap.** The request logger (`server/index.ts:96`) uses a case-sensitive
   `path.startsWith("/api")`, so non-canonical-case `/api` requests (e.g. `/API/...`) are handled/blocked
   but not written to the access log. Observability only — the gate itself is correct.
2. **Non-`/api` paths fall through to the SPA shell.** `/%61pi/research/jobs`, `/%41PI/research/jobs`,
   `//api/research/jobs` are not API-routed; the SPA catch-all (`server/static.ts:24`) returns
   200 `text/html` `index.html` (745 B). No JSON, no handler, no data — not a bypass. `/api//...`,
   `/api/../api/...`, trailing-slash and `%2f` forms still return 401.
3. **Legacy NULL-owner rows** are visible to every authenticated user by design (`isForeignRow`,
   story list). Not an owner-1 fallback and unreachable anonymously.
4. `/uploads` static and `server/replit_integrations/*` routers (`/api/generate-image`,
   `/api/conversations`) are exported but **never mounted**; `/uploads` is a public static assets path
   (outside the `/api` boundary).

## Reproduction

```bash
npm run build
DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e PORT=4608 E2E_PORT=4608 \
  NODE_ENV=production SESSION_COOKIE_SECURE=0 CONTENTFORGE_E2E_SERVER=1 \
  SESSION_SECRET=<set> node dist/index.cjs
bash casecheck.sh            # 400 case-variant requests → NON401=0
node isolation.mjs          # 55 owner-isolation + paid-endpoint assertions → failed=0
NODE_ENV=test node --import tsx --test server/middleware/authGate.test.ts   # 10/10
```
