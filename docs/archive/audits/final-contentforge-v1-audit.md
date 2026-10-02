# ContentForge — Final Independent Audit (v1)

**Date:** 2026-09-26
**Audited commit:** `a763250` (pushed `origin/main` at audit time)
**Auditors:** four independent workers, each in a fresh checkout of the pushed tree
**Decision:** **FINAL NO-GO**

---

## 1. Executive Summary

The independent audit **falsified the platform's headline security claim** and found the single
most serious defect of this entire programme.

`authGate` compared `req.path.startsWith("/api")` **case-sensitively** while Express routes
case-insensitively. A capital letter in the path (`/API/research/jobs`) reached the same handler
with the gate stepped aside. Handlers then resolved the owner as `getUserId(req) ?? 1`, so an
unauthenticated request silently became **owner 1**.

Verified independently by the coordinator: anonymous **read and write** of owner 1's data, and
anonymous access to **paid** AI endpoints. `POST /API/autonomy/enable` returned
`{userId: 1, enabled: true}`.

**Fixed and pushed** as `ea86cca` — 95 call sites, plus regression tests. **But that commit has
not itself been independently audited**, so the audited commit `a763250` is a **NO-GO**, and the
remediation requires re-audit.

The audit also **corrected two of the coordinator's own claims**, and found a class of
accessibility defect that axe cannot see.

**This is the third time in the programme that independent verification overturned a
coordinator conclusion.** That is the finding about the process, not just the product.

---

## 2. Final MAIN State

```
origin/main : ea86cca  fix(security): close the auth-gate case bypass …   (pushed)
audited     : a763250  (previous tip)
tag         : rc-33-design-verified -> a763250 (superseded)
local == remote: yes
server/ changes since the pre-design main: the security fix above
```

Worktrees `audit-a`…`audit-d` are detached at the audited tree. `phase-33.4-test-stability`
holds an explicitly **unverified** WIP commit, correctly not merged and not pushed.

---

## 3. Security

| Claim | Verdict | Evidence |
|---|---|---|
| Every protected `/api/*` requires auth | **FALSIFIED** | `/api/...` 401, but `/API/...` **200** |
| **Anonymous never becomes owner 1** | **FALSIFIED — CRITICAL** | `GET /API/research/jobs` returned owner rows; `POST /API/autonomy/enable` → `{userId:1, enabled:true}`, confirmed in SQL |
| Paid endpoints authenticated | **FALSIFIED** | `POST /API/images/generate` reached the OpenAI SDK anonymously |
| Forged client identity ignored | VERIFIED | `X-User-Id`/`X-Owner-Id`/body/query → 401 |
| CSRF enforced | VERIFIED | missing/invalid token → 403; token endpoint is not a bypass |
| SSRF boundary | VERIFIED | `safeFetch` rejects loopback, link-local, metadata, RFC1918, CGNAT, numeric encodings, IPv4-mapped, credentials, non-http |
| Credential masking | VERIFIED | `/api/accounts` returns only `••••••<last4>`, no `refreshToken`; nothing beyond the last 4 rendered |

**Fixed in `ea86cca`**, verified: all case variants 401 for reads and writes; allowlist
(`/api/health`, `/api/ready`, `/api/csrf-token`) still 200; `authGate.test.ts` 10/10.

## 4. Tenant Isolation

**FALSIFIED (one domain).** `discovery_settings` (`shared/schema.ts:309`) has **no `user_id`**;
one user can read and overwrite another's `customKeywords`. Every other per-user domain checked
(posts, ideas, articles, references, vault, accounts, research, artifacts, publications,
schedule-occurrences, experiments, policy-candidates, learning, automation) **is** properly
owner-scoped. **Not yet fixed.**

## 5. Authentication

The gate itself is correct for canonical paths (allowlist = `/api/auth/*`, `/api/csrf-token`,
`/api/health`, `/api/ready`). The bypass was the case comparison, now fixed. The `authGate.test.ts`
suite passed 8/8 throughout because it never used a mixed-case path — a test-design gap now closed.

## 6. Functionality

**Audit incomplete.** Auditor B (functionality / scheduler / autonomy / recovery) hit its turn
limit without producing a report. The core and advanced loops and the scheduler
`WHEN`/`WHETHER` separation are therefore **UNVERIFIED by this audit** and must be re-run.

## 7. UX

Real findings, from the UX auditor's per-destination pass:

- **MEDIUM** `/create`: the primary action is disabled with **no inline reason** — the design
  direction explicitly forbids a disabled primary as the only explanation.
- **MEDIUM** `/create`, `/settings`: mode strips scroll behind `no-scrollbar` with **no visible
  affordance**; 37 off-viewport elements at 390px.
- **MEDIUM** `/sources`: the section heading ties the page `h1` in weight.
- **MEDIUM** `/sources`: the header action (`Quick Capture`) does not name the surface's actual job.
- **MEDIUM** `/agent`: **Capabilities is deleted below `lg`**, not disclosed.
- **MEDIUM** `/insights`: only one heading on the page; no section navigation.

## 8. Visual Design

Consistent with the design programme: one token system, semantic status colour, no exclamation
copy, no colour-only status. **Latent defect found:** `analytics.tsx:101` still carries a raw
`text-green-500` literal (2.28:1 on light) that renders only when a trend string exists — the
empty database hid it from axe.

## 9. Accessibility

**0 axe violations on default first paint — 7 routes × 2 themes.** But the auditor's **deep pass
(opening every tab and every overlay)** found more, and additional probes found defects axe
**structurally cannot report**:

- **HIGH — dialog focus is not restored to the invoking control** (3 dialogs).
- **HIGH — 12 form controls on `/settings` have no programmatically associated label** (Brand
  Profile ×10, Connect dialog ×2). `el.labels.length === 0`, no `aria-label`, no `id`.
  `create-studio.tsx` does this correctly and is the model.
- **HIGH — colour contrast in the Calendar view**, both themes (visible only when the Calendar tab
  is activated).
- **LOW/MEDIUM** — `aria-modal` absent on dialogs (Radix compensates via `aria-hidden`).

The auditor proved axe does not flag placeholder-only or unassociated-label inputs, so
**"0 axe violations" is not "accessible"**. This also **corrects the coordinator's earlier
"14/14 clean" claim**, which was first-paint only.

Clean: one `<main>` and one `<h1>` per route, no skipped heading levels, tab `aria-controls`
resolve before activation, primary actions keyboard-reachable, real focus rings, no overflow at
320px or 2× zoom, and a genuinely enforced CSP.

## 10. Responsive

No horizontal overflow at 320px on all seven routes, nor at 2× zoom. Risks are the hidden
scroll strips and the deleted Capabilities list above. Coarse-pointer behaviour is
**structurally invisible** to the harness (Playwright is fine-pointer only) and was not verified.

## 11. Performance

Not re-measured — auditor D was still running at report time. The pre-audit baseline stands:
entry 362 KB (from 1,792 KB), 8 route chunks. `/create` (647 KB) and `/insights` (497 KB) exceed
Vite's 500 KB warning.

## 12. Autonomy / 13. Scheduler / 14. Data Integrity / 15. Recovery

**UNVERIFIED by this audit** (auditor B incomplete). Migrations were independently confirmed
additive-only (no `DROP`, `TRUNCATE`, or `DELETE` across 31 files), so schema changes cannot
destroy data.

## 16. Test Integrity

- `tsc` clean · build clean · `authGate.test.ts` 10/10 · unit **774/774** after the fix.
- E2E serial **252 passed / 4 failed** (all pre-existing and classified); parallel 235 / 19 under
  known rate-limit contention.
- **The 3 "flaky" `threads.test.ts` failures were explained, not excused:** they were stale
  `connected_accounts` rows in the shared test database encrypted under a different
  `ENCRYPTION_KEY` (`Failed to decrypt stored accessToken`). Deleting them restored 774/774. The
  suite is **not isolated from database state** — a real harness defect, previously mislabelled.
- Worker 33.4 (test stability) **failed twice**; its work is preserved unverified and not merged.

## 17. Previous Findings Reconciliation

Substantially incomplete: the reconciliation auditor (D) did not report. What was reconciled by
the security and UX auditors is recorded in `docs/final-audit-security.md` and
`docs/final-audit-ux-a11y.md`. Notably, the legacy "shared rows" claim (R1) **no longer holds** —
legacy domains are owner-scoped at this commit.

## 18. New Findings

1. **CRITICAL** auth-gate case bypass + owner-1 fallback — fixed in `ea86cca`.
2. **HIGH** `discovery_settings` has no tenant column — open.
3. **HIGH** ×3 accessibility defects axe cannot see — open.
4. **MEDIUM** hidden scroll strips; deleted Capabilities below `lg`; disabled primary without a
   reason; `/insights` heading structure; `/sources` header action.
5. **MEDIUM** test suite pollutes itself with un-decryptable rows.

## 19. Remaining Debt

The four pre-existing E2E failures; the parallel-run contention; 33.4 incomplete; hidden scroll
strips; 45 sub-12px classes and 49 palette literals (19 and 17 shipping in live chunks);
`/create` + `/insights` chunk sizes; coarse-pointer verification.

## 20. Don't-Build Review

**PASS.** No second queue, no second workflow engine, no second design system, no native app, no
auto-DM/reply, no speculative dashboards, no RL/bandits, no autonomous experiment creation or
self-modification. The design programme added no product features; the one feature-class finding
(scheduled-post surfacing) remained deferred.

## 21. Final Decision

**FINAL NO-GO.**

Three independent grounds:

1. **A CRITICAL production security blocker existed in the audited commit** — anonymous read,
   write and paid-endpoint access as owner 1. It is fixed in `ea86cca`, but that commit has not
   been independently audited, and the rule is that the audit must run against the pushed tree.
2. **A P1 tenant-isolation defect remains open** — `discovery_settings` has no owner column.
3. **Three HIGH accessibility defects remain open**, and the audit **corrected the coordinator's
   own claim** that there were none.

Additionally the audit is **incomplete**: two of four auditors did not produce reports, so
functionality, scheduler, autonomy, recovery, performance and findings reconciliation are
**unverified**.

Minimal remediation required before a GO:
fix `discovery_settings` ownership; fix the three accessibility defects; re-run the incomplete
auditors; then re-audit the resulting commit independently. The four pre-existing E2E failures and
33.4 may remain as documented non-blocking debt.
