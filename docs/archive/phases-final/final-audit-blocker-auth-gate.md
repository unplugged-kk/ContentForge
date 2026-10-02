# Final Audit Blocker — Auth-Gate Case Bypass

**Found by:** the independent final audit (auditor A), against the pushed `origin/main` @ `a763250`
**Verified independently by the coordinator** before any change was made
**Severity:** **CRITICAL / P0**
**Status:** **FIXED and verified**

---

## 1. Finding

The platform's headline security claim — *"anonymous must never become owner 1"* — was **false**.

`server/middleware/authGate.ts` gated on:

```ts
if (!req.path.startsWith("/api")) return next();
```

Express routing is **case-insensitive by default**, but this comparison is not. A single
capital letter in the path therefore reached the same route handler with the gate stepping
aside entirely.

---

## 2. Reproduction (executed by the coordinator, not accepted on report)

Production bundle, isolated Postgres, no cookie, no session:

| Request | Before | After |
|---|---|---|
| `GET /api/research/jobs` | 401 | 401 |
| `GET /API/research/jobs` | **200 — returned live owner rows** | **401** |
| `GET /Api/research/jobs` | **200** | **401** |
| `GET /API/artifacts` | **200** | **401** |
| `GET /API/autonomy/status` | **200** | **401** |
| `GET /API/experiments` | **200** | **401** |
| `POST /API/research/jobs` | **201 — anonymous write** | **401** |
| `POST /API/autonomy/enable` | **200 `{userId:1, enabled:true}`** | **401** |

The GET returned real payload, for example a research job with its `correlationId`, `query` and
provider ids. The auditor additionally confirmed in SQL that the writes landed as `user_id = 1`,
and that `POST /API/images/generate` reached the OpenAI SDK — a **paid** endpoint — anonymously.

## 3. Root cause — two defects, one chain

1. **The case-sensitive gate** (`authGate.ts:35`). Same defect in
   `server/middleware/rateLimit.ts:29`, where `/API/...` also bypassed rate limiting.
2. **A fail-open owner fallback.** Handlers resolved the owner as
   `const userId = getUserId(req) ?? 1`. When the request had no session, `getUserId` returned
   `undefined` and the code silently used **owner 1**. This directly contradicted the invariant
   documented at `server/routes.ts:56` ("never grounds for defaulting to owner 1").

Either defect alone was survivable; together they were a complete authentication bypass on
**95 call sites** across 7 route files.

---

## 4. Fix

**`server/middleware/authGate.ts`** and **`server/middleware/rateLimit.ts`** — case-fold the path
before comparing, so the gate matches the router's actual behaviour:

```ts
const path = req.path.toLowerCase();
if (!path.startsWith("/api")) return next();
if (isPublicApiPath(path)) return next();
```

**`server/middleware/userContext.ts`** — new `requireOwnerId(req)` that **throws** when there is
no session, rather than substituting an owner.

**95 call sites** across `content/routes.ts`, `research/routes.ts`, `experimentation/routes.ts`,
`learning/routes.ts`, `autonomy/routes.ts`, `policyActivation/routes.ts` and
`automationRoutes.ts` — `getUserId(req) ?? 1` → `requireOwnerId(req)`.

Zero `?? 1` owner fallbacks remain in production code.

**Regression test** added to `server/middleware/authGate.test.ts`: four case variants of a
protected path must all return 401 and must not run the handler, while an authenticated
case-variant path must still succeed (guarding against over-correction).

---

## 5. Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `authGate.test.ts` | **10/10** (2 new tests) |
| `npm run build` | succeeds |
| All case-variant anonymous reads | **401** |
| All case-variant anonymous writes | **401** |
| Allowlist unaffected (`/api/health`, `/api/ready`, `/api/csrf-token`) | **200** |
| Lowercase protected path, anonymous | 401 (unchanged) |
| `npm run test:unit` | **774/774** |

---

## 6. A second finding, diagnosed while verifying

Three `server/content/threads.test.ts` tests failed intermittently across this programme and were
recorded as "pre-existing flaky". They are neither random nor a product defect:

```
Error: Failed to decrypt stored accessToken. ENCRYPTION_KEY may have rotated.
    at safeDecrypt (server/storage.ts:56)
    at DatabaseStorage.getConnectedAccount (server/storage.ts:654)
```

Two rows left in the **shared test database** by earlier specs were encrypted under a different
`ENCRYPTION_KEY`. Deleting them returned the suite to **774/774**.

So the suite is **not isolated from database state** — a real test-infrastructure defect, and the
correct explanation of the "flakiness" previously attributed to port contention. Recorded for
the (still unfinished) 33.4 workstream rather than papered over.

---

## 7. What this means for the release decision

The blocker was **production-relevant**: `/API/...` is trivially reachable over HTTPS, and the
exposure was anonymous read and write of another owner's data plus paid-endpoint access.

It is fixed and verified, but the fix was authored *after* the audit that found it, so **the
pushed `main` must be re-audited** for this to count as independently verified. Until then the
result is **FINAL NO-GO on `a763250`**, and the remediation must be re-audited.
