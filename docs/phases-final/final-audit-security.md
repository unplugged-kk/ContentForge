# Final Independent Security Audit — Authentication, Tenant Isolation, SSRF, XSS, Secret Exposure

**Auditor role:** independent final auditor (fresh checkout; every prior report treated as unverified and reproduced).
**Target:** pushed `origin/main`
**Artifact hash:** `a763250` (`a763250f311e2bd93a817a5010d83b9a8a8336bb`)
**Worktree:** `/Users/kishore/git/cf-design/audit-a` (detached at `origin/main`)
**Date:** 2026-09-26

## 0. Environment and method

- Isolated ephemeral PostgreSQL 16.13: `DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e` (already migrated).
- Built the production bundle: `npm run build` → `dist/index.cjs` (4.1 MB) + `dist/public`.
- Ran the production server myself:

  ```bash
  DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e \
  NODE_ENV=production PORT=4301 E2E_PORT=4301 SESSION_COOKIE_SECURE=0 \
  SESSION_SECRET=audit-local-secret CONTENTFORGE_E2E_SERVER=1 DISABLE_CRON=1 \
  node dist/index.cjs
  ```

  (`E2E_PORT`/`PORT` = 4301 as instructed.)
- All findings were produced by real HTTP requests against the running production bundle, plus one Playwright browser run of the repo's own canary spec. Test scripts live in the session scratchpad; none are committed (application code is read-only in this audit). Only this report was added.

---

## 1. Authentication boundary

**Verdict: PARTIALLY VERIFIED — the canonical boundary works, but it is BYPASSABLE (see §2 / SEC-01).**
`Authentication boundary complete` = **FALSIFIED**; `canonical gate returns 401` = **VERIFIED**.

Allowlist (enumerated from `server/middleware/authGate.ts`):

- `PUBLIC_API_PREFIXES = ["/api/auth/"]` → `/api/auth/register`, `/login`, `/logout`, `/me`, `/config`, `/google`, `/google/callback`
- `PUBLIC_API_EXACT = ["/api/csrf-token", "/api/health", "/api/ready"]`

Anonymous observations (`GET`, no cookie):

| path | status |
|---|---|
| `/api/csrf-token` | 200 (public by design) |
| `/api/health` | 200 |
| `/api/ready` | 200 |
| `/api/auth/config` | 200 |
| `/api/auth/me` | 401 (`Not authenticated` — handler self-checks) |
| `/api/posts` `/api/accounts` `/api/pillars` `/api/ideas` `/api/articles` `/api/references` `/api/images` `/api/vault` `/api/social/x/status` `/api/discover/ideas` `/api/automation/policies` `/api/learning/proposals` `/api/experiments` `/api/policy-candidates` `/api/autonomy/status` `/api/agent/runs` `/api/research/jobs` `/api/stories` `/api/opportunities` `/api/artifacts` `/api/publications` `/api/schedule-occurrences` `/api/schedules` | **401** `{"message":"Unauthorized"}` |
| `POST /api/posts`, `POST /api/images/generate`, `POST /api/autonomy/run` | 401 |

So for a **canonically-cased** path the gate is correct. The defect is that the gate's own test (`server/middleware/authGate.test.ts`) only ever exercises lowercase paths, so it passes 8/8 while the bypass below exists.

---

## 2. Anonymous must never become owner 1 — **FALSIFIED (CRITICAL)**

This is the headline claim and it is **false** at the pushed commit. `sessionUserId` *does* throw when there is no session (`server/routes.ts:56-63`) and forged client IDs are ignored — but the auth gate itself is bypassable with a **case variation of the path**, and the newer routers derive identity with `getUserId(req) ?? 1`.

### Root cause

`server/middleware/authGate.ts:35`

```ts
if (!req.path.startsWith("/api")) return next();   // case-SENSITIVE
```

Express routing (`app.get("/api/…")` / `app.use("/api/…")`) is **case-INsensitive by default** (`caseSensitive` setting defaults to `false`). A request to `/API/posts` therefore:

1. fails `req.path.startsWith("/api")` in the gate → gate calls `next()` without requiring a session, and
2. still matches the `/api/posts` route → the handler runs unauthenticated.

The legacy `routes.ts` handlers then throw (`sessionUserId` → 500), but every newer router uses `getUserId(req) ?? 1` and **becomes owner 1**:
`server/research/routes.ts:127,205,323`, `server/content/automationRoutes.ts:140-243`, `server/content/routes.ts` (many), `server/content/learning/routes.ts` (all), `server/content/experimentation/routes.ts` (all), `server/content/policyActivation/routes.ts` (all), `server/content/autonomy/routes.ts` (all).

### Reproduction — anonymous READ of owner 1's data

```bash
curl -s  http://127.0.0.1:4301/api/research/jobs       # 401 {"message":"Unauthorized"}   (canonical)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4301/API/research/jobs   # 200
curl -s  http://127.0.0.1:4301/API/research/jobs       # [{"id":157,...},{"id":136,"query":"kubernetes",...}, ...]
```

Observed: `GET /API/research/jobs` → **200** and returns the research jobs owned by **user_id 1** (confirmed in SQL: `select id,user_id,query from research_jobs where id=136;` → `136 | 1 | kubernetes`).
Other lists reachable anonymously the same way: `GET /API/automation/policies`, `/API/automation/runs`, `/API/learning/proposals`, `/API/learning/signals`, `/API/experiments`, `/API/policy-candidates`, `/API/autonomy/status`, `/API/autonomy/decisions`, `/API/stories`, `/API/artifacts`, `/API/publications`, `/API/schedule-occurrences` → all **200**.

### Reproduction — anonymous WRITE as owner 1

An anonymous caller can mint its own CSRF token from the public `/api/csrf-token` endpoint, then POST to the case-variant path:

```bash
curl -s -c /tmp/j -b /tmp/j http://127.0.0.1:4301/api/csrf-token        # get csrfToken
curl -s -b /tmp/j -H "X-CSRF-Token: <token>" -H 'Content-Type: application/json' \
     -d '{"providerIds":["rss"],"query":"audit-write-probe"}' \
     http://127.0.0.1:4301/API/research/jobs                            # 201, job created as user_id 1
curl -s -b /tmp/j -H "X-CSRF-Token: <token>" -H 'Content-Type: application/json' \
     -d '{}' http://127.0.0.1:4301/API/autonomy/enable                  # 200 {"id":71,"userId":1,"enabled":true,...}
```

Confirmed in SQL after the requests:

```
research_jobs where user_id=1  → rows present (incl. the anonymously-created job)
autonomy_configs where user_id=1 → enabled = t, mode = observe_only
```

Anonymous `POST /API/autonomy/enable` therefore **turned on autonomy for owner 1**.

### Forged identity (sub-claims) — VERIFIED

- `GET /api/posts` with `X-User-Id: 1`, `X-Owner-Id: 1` → **401**
- `GET /api/posts?userId=1&ownerId=1` → **401**
- `POST /api/posts` body `{userId:1, ownerId:1}` → **401**
No route consults client-supplied owner IDs.

### Stale / deleted-user sessions (sub-claims)

- Garbage session cookie (`connect.sid=s%3Agarbage…`) → **401** (VERIFIED).
- A session whose user row was deleted but whose session row still exists **passes the gate** (`GET /api/posts` → 200, `GET /api/research/jobs` → 200, both `[]`). The gate checks only that `session.userId` is present, never that the user still exists. It operates as a dangling id (not owner 1), so this is LOW — but it is a real gap (see SEC-06).

---

## 3. Tenant isolation — **MIXED**

**Per-user domains = VERIFIED; one settings domain = FALSIFIED (SEC-02); owner-1 store = FALSIFIED via §2.**

Two freshly-registered real users A (id 173/192/…) and B:

| domain | B reading A's row | result |
|---|---|---|
| posts (`/api/posts`, `/api/posts/:id`, `DELETE`) | `[]`; by-id 404; delete 404 | isolated |
| ideas (`/api/ideas/:id`) | 404 | isolated |
| connected accounts (`/api/accounts`, `/api/accounts/:id/test`) | `[]`; test → 404 | isolated (token never echoed) |
| research jobs (`/api/research/jobs`, `/:id`) | `[]`; by-id 404 | isolated |
| articles (`/api/articles`, `/:id`) | `[]`; by-id 404 | isolated |
| references (`/api/references`, `/batch/:id`) | `[]` | isolated |
| vault (`/api/vault`) | `[]` | isolated |
| carousels / canned-responses / posts queue (`/api/posts/queue/today`) | `[]` | isolated |
| artifacts / publications / schedule-occurrences / schedules / stories / opportunities / learning proposals / experiments / policy-candidates / policies / automation policies | `[]` (and 400-on-missing-param) | isolated |

This **contradicts** the older "R1 legacy pool is shared" residual: at this commit the legacy pool (posts/ideas/articles/references/vault/…) is owner-scoped and B cannot read, mutate, or infer A's rows.

**FALSIFIED — `discovery_settings` is a global singleton with no owner column** (`shared/schema.ts:309`; `\d discovery_settings` shows columns `id, auto_refresh_frequency, custom_keywords, monitored_x_accounts, enabled_sources, min_viral_score, updated_at` — **no `user_id`**). Reproduction:

```
A: PUT /api/discover/settings {"customKeywords":["AONLY_…"]}   → 200
B: GET /api/discover/settings                                  → customKeywords ["AONLY_…"]   (leak)
B: PUT /api/discover/settings {"customKeywords":["BFROM_…"]}   → 200
A: GET /api/discover/settings                                  → customKeywords ["BFROM_…"]   (overwrite)
```

Any authenticated user reads and overwrites every other user's discover settings.

---

## 4. CSRF — **VERIFIED**

| request | result |
|---|---|
| `POST /api/ideas` (no `X-CSRF-Token`) | **403** `Invalid or missing CSRF token` |
| `POST /api/ideas` (bogus token) | **403** |
| fetch `/api/csrf-token` then `POST /api/ideas` with **no header** | **403** (the token endpoint is not itself a bypass) |
| `GET` safe method | allowed (by design) |

`server/middleware/csrf.ts` exempts only `/api/auth/*`, `/api/webhooks/*`, `/api/csrf-token` and safe methods. Note the interaction with SEC-01: because the CSRF token is publicly obtainable and `verifyCsrf` exempts by the same canonical path, an anonymous attacker can satisfy CSRF and then hit the **case-variant** state-changing route (see §2) — CSRF does not close the gate bypass.

---

## 5. SSRF — **VERIFIED**

The legacy ingestion boundary (`POST /api/vault/extract-url` → `safeFetch`, `server/security/ssrf.ts`) rejects every internal target tested, at the address/DNS level (not merely documented):

| target | result |
|---|---|
| `http://127.0.0.1/`, `http://127.0.0.1:80/` | 400 `Address 127.0.0.1 is not routable` |
| `http://localhost/` | 400 `Host localhost resolved to a non-routable address (::1, 127.0.0.1)` |
| `http://0.0.0.0/` | 400 |
| `http://2130706433/`, `http://127.1/`, `http://0x7f000001/` (numeric forms) | 400 (normalised to 127.0.0.1) |
| `http://[::1]/`, `http://[0:0:0:0:0:0:0:1]/` | 400 |
| `http://[::ffff:127.0.0.1]/` | 400 (IPv4-mapped validated) |
| `http://[fd00::1]/` | 400 |
| `http://169.254.169.254/` (metadata) | 400 `Address 169.254.169.254 is not routable` |
| `http://10.0.0.1/`, `http://192.168.1.1/` (RFC1918) | 400 |
| `https://example.com@127.0.0.1/` | 400 `URLs with embedded credentials are rejected` |
| `file:///etc/passwd` | 400 `Only http and https are allowed` |
| non-default port (`:4301`) | 400 `Port 4301 is not allowed` |

Redirect re-validation and connect-time guarded DNS are present in code; redirect-to-internal was not exercised end-to-end (needs an attacker-controlled external host — see §10).

---

## 6. XSS — **UNVERIFIED (no live exploit); unsanitised sink identified**

- The only dynamic `dangerouslySetInnerHTML` sink in the client is `client/src/pages/ingest.tsx:587`, rendering `variation.contentHtml`.
- That value comes from `POST /api/content-actions/:action` (`server/routes.ts:1616-1694`), which builds `contentHtml` straight from the model's JSON (`String(v.contentHtml || v.content || "")`) **without passing it through `sanitizeHtml`**, then returns it to the client for direct `innerHTML` rendering. The AI prompt is seeded with attacker-influenceable ingested source text/title (prompt-injection → stored/DOM XSS).
- Compensating facts: persisted articles *are* sanitised (`server/routes.ts:703,714,906` use `DOMPurify`), and most user content is rendered as text or via the client-side `sanitizeUntrustedText` (tag-stripping). `POST /api/vault` stores raw HTML server-side (`{"content":"<img src=x onerror=…><script>…</script>"}` round-trips unchanged); today the vault UI strips tags client-side, so there is no *current* sink, but server-side persistence of unsanitised HTML is a latent hazard.
- I could **not** execute a deterministic XSS: the `content-actions` path requires a working AI key (AI is unconfigured in the ephemeral environment) and the injected HTML is model-generated. Reported as a real but unproven-by-execution finding (SEC-04, SEC-05).

---

## 7. Paid side-effect protection — **FALSIFIED via SEC-01; canonical auth + rate limits VERIFIED**

- Canonical paths: `POST /api/images/generate`, `POST /api/autonomy/run`, `POST /api/posts` → **401** anonymously (gate runs before the handler). VERIFIED.
- **But the case-variant bypass reaches paid handlers anonymously.** With a self-obtained CSRF token:

  ```
  POST /API/images/generate  → 500 {"message":"401 Incorrect API key provided: <provider-masked key>"}
  POST /API/generate         → 500 "Failed to generate content. Please try again."
  POST /API/viral/score      → 500 "Failed to score content."
  ```

  `/API/images/generate` reached the OpenAI SDK — the provider rejected the (placeholder) key. **With a valid key configured this endpoint would spend money on an anonymous request.** (I did not perform a real paid call/post.)
- Rate limits VERIFIED: `authLimiter` returned **429** on the 5th–11th `/api/auth/*` call (limit 10/min/IP) and `publishLimiter` returned **429 at request 31** on `POST /api/posts/:id/publish` (limit 30/min/IP).

---

## 8. Secret exposure to the browser — **VERIFIED**

- Ran the repo's canary spec against the production server:

  ```bash
  E2E_PORT=4301 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4301 \
    npx playwright test e2e/security-secret-exposure.e2e.spec.ts --project=chromium
  # 5 passed (setup + 4 tests)
  ```

  It proves the canary `cfcanary_S3CRETVALUE_9f3b7a21deadbeefcafe` never appears in network responses, rendered DOM/HTML, `localStorage`, `sessionStorage`, the URL, or console.
- Falsification attempt on the mask: the accounts API masks with `"••••••" + accessToken.slice(-4)`. Full `GET /api/accounts` body:

  ```json
  [{"id":33,"userId":188,"platform":"threads","username":"canaryacct",
    "accessToken":"••••••cafe","tokenExpiresAt":null,"isActive":true,
    "profileData":{},"connectedAt":"…","lastUsedAt":null}]
  ```

  Only the last 4 characters are ever returned; `refreshToken` is deleted from the payload; `connect` echoes the same `••••••cafe` mask. The Settings page (`client/src/pages/settings.tsx:317`, `text-account-token-<platform>`) renders exactly that string — **no more than the last 4 characters anywhere**. ✅
- Checked adjacent "settings" endpoints for leaks — `/api/social/{threads,x,instagram,youtube}/status`, `/api/discover/settings`, `/api/discover/rss-sources`, `/api/usage`, `/api/ai-usage/dashboard`, `/api/profile/branding` — none contained the canary or its last-4 beyond the intended mask.
- No secret values were printed during this audit.

---

## 9. Findings table

| ID | Severity | Location | Observation | Suggested fix |
|---|---|---|---|---|
| **SEC-01** | **CRITICAL** | `server/middleware/authGate.ts:35` (+ `server/routes.ts:56`, all `getUserId(req) ?? 1` sites) | `req.path.startsWith("/api")` is case-sensitive while Express routing is case-insensitive ⇒ `/API/…` skips the gate. Anonymous `GET /API/research/jobs`/`/API/automation/…`/etc. return **200 with owner-1 data**; anonymous `POST /API/research/jobs` **201**, `POST /API/autonomy/enable` **200 (userId 1, enabled)**; `POST /API/images/generate` reaches the paid provider. | Match the gate case-insensitively and normalise the path: use `req.path.toLowerCase().startsWith("/api")` (and lower-case the allowlist comparison), or set `app.set("case sensitive routing", true)` **and** gate on the router-level mount. Remove every `?? 1` fallback (fail closed). Add mixed-case paths to `authGate.test.ts`. |
| **SEC-02** | **HIGH** | `shared/schema.ts:309` `discovery_settings`; `server/routes.ts` `/api/discover/settings` (GET/PUT) | Global singleton (no `user_id`): user B reads and overwrites user A's `customKeywords`; all authenticated users share one settings row. | Add `user_id` to `discovery_settings`, scope GET/PUT by `sessionUserId`, unique index on `user_id`; migrate the existing singleton row per owner. |
| **SEC-03** | **MEDIUM** | ~90 × `getUserId(req) ?? 1` across `server/research/routes.ts`, `server/content/**` | The `?? 1` default converts any gate bypass (SEC-01) into full owner-1 access incl. writes and paid calls; it also silently degrades isolation whenever the session id is momentarily absent. | Delete the fallbacks; use `requireUserId(req,res)` / throw. Keep the existing static pin but extend it to every router, not just `routes.ts`/`agent/routes.ts`. |
| **SEC-04** | **MEDIUM** | `client/src/pages/ingest.tsx:587` ← `server/routes.ts:1669-1689` (`/api/content-actions/:action`) | AI-generated `contentHtml` is returned un-sanitised and rendered with `dangerouslySetInnerHTML`; the prompt is seeded with attacker-influenceable ingested text (prompt-injection → DOM/stored XSS). Not executed live (AI unconfigured). | Run AI HTML through the server-side `sanitizeHtml` (DOMPurify) before returning, and sanitise again before `dangerouslySetInnerHTML`. |
| **SEC-05** | **MEDIUM** | `server/routes.ts:800-2807` (`POST /api/vault`, `/api/references` raw HTML) | Raw HTML is persisted server-side without sanitisation (client strips tags today). A future/other renderer of these fields becomes an XSS sink. | Sanitise on write (`sanitizeHtml`) or store as text; defence-in-depth even where the current client is safe. |
| **SEC-06** | **LOW** | `server/middleware/userContext.ts:78-83` (`requireAuthMiddleware`) | The gate checks only that `session.userId` is present, never that the user still exists; a session for a deleted user still authenticates (200, operates as a dangling id). | On authentication, verify the user row (cheap cached lookup) and destroy the session if missing. |
| **SEC-07** | **LOW / informational** | `server/routes.ts:1841-1845` (`GET /api/bookmarklet`) | Builds a `javascript:` bookmarklet from `req.get("host")` without validation (host-header injection surface). Could not reproduce a spoofed host through Node `fetch` (Host is a forbidden header); noted as latent. | Validate the host against an allowlist before embedding it in the returned bookmarklet. |

**Bonus observation (not a vulnerability):** the gate pass-through for `/api/auth/*` means `/api/auth/me` and `/api/auth/logout` are "public at the gate" but self-check the session (me → 401 anonymously), which is correct.

---

## 10. What I could not verify

- **Deterministic XSS execution.** The only dynamic `dangerouslySetInnerHTML` sink (`ingest.tsx:587`) is reached via AI generation, which requires provider credentials absent from the ephemeral environment. The sink and the un-sanitised server return path were confirmed by reading the exact request/response contract, but no payload was executed in a browser.
- **Real redirect-based SSRF.** `safeFetch` re-validates each redirect hop in code, but exercising redirect-to-internal needs an attacker-controlled external host serving a redirect; not available off-network here.
- **Actual paid spend / real publication.** No valid provider key or xQuick token was configured, so I proved the paid endpoints are *reachable anonymously* and reached the provider (which rejected the key), but I did not incur a real charge or publish real content.
- **Full browser suite.** Only `e2e/security-secret-exposure.e2e.spec.ts` was run in a real browser (chromium). The full Playwright suite, Google OAuth (disabled: `/api/auth/config` → `{"googleEnabled":false}`), YouTube OAuth, and the non-API static `/uploads` surface were out of practical scope/time.
- **Owner-1 store contents.** The case-variant list leak returns owner-1 rows for research/automation/stories/etc.; observed collections for artifacts/publications/schedule-occurrences happened to be empty in this ephemeral DB, so I could not show owner-1 rows in those particular tables (the leak primitive is the same).
- **Brute-force/lockout behaviour** beyond the observed 429 rate-limit (no account lockout tested).

---

## 11. Prior-report deltas (reproduced independently)

- The older Phase 30.1 report's residual **R1 ("legacy pool is shared among authenticated users")** no longer holds at `a763250`: posts/ideas/articles/references/vault/carousels/canned-responses are owner-scoped and cross-tenant reads return `[]`/404.
- The older report's residual **R2 ("~90 `?? 1` under the gate are unreachable-unauthenticated")** is **false**: they are reachable via the case-variant bypass (SEC-01), which the existing 8/8-passing `authGate.test.ts` does not cover because it never uses a mixed-case path.

## 12. Headline verdicts

| Claim | Verdict |
|---|---|
| 1. Auth boundary rejects unauthenticated /api | **FALSIFIED** as a complete boundary (canonical paths 401 = verified; `/API/…` bypasses) |
| 2. Anonymous never becomes owner 1 | **FALSIFIED — CRITICAL** |
| 3. Tenant isolation | **MIXED** — per-user domains VERIFIED; `discovery_settings` global (FALSIFIED) |
| 4. CSRF | **VERIFIED** |
| 5. SSRF | **VERIFIED** |
| 6. XSS | **UNVERIFIED** (unsanitised AI-HTML sink confirmed; no live exploit) |
| 7. Paid side-effect protection | **FALSIFIED** via SEC-01 (reachable anonymously); canonical auth + rate limits VERIFIED |
| 8. Secret exposure to browser | **VERIFIED** (canary spec 5/5; mask = last 4 only) |
