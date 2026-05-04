# X API — compliance & risk (ContentForge)

**Purpose:** Single internal reference distilled from official X Developer Platform docs (including `llms-full`). Use this instead of loading the full ~84k-line bundle into context.

**Not legal advice.** For binding text, use the official agreements and current docs URLs below.

---

## What ContentForge does (research is not “X-only”)

Typical flow:

1. **Research** from the **open web** — feeds, HN, Reddit, GitHub, ArXiv, blogs, newsletters, pasted notes, screenshots, etc. X is **one optional source**, not the definition of “research.”
2. **AI synthesis** — turn signals into drafts, angles, hooks, and structure (your voice and expertise stay in the loop).
3. **You approve** — Ready / Scheduled / explicit publish; tune for quality and engagement without crossing into spam or manipulation.
4. **Publish or schedule** — Push to X (and elsewhere) via official APIs where applicable.

**This document is narrow on purpose:** it only spells out **X Developer Platform** rules for the moments we **read or write X** (API keys, posting, optional X URL ingest). It does **not** limit you to researching on X.

---

## How ContentForge maps to X’s expectations

| Product behavior | Risk lens |
|------------------|-----------|
| User composes or approves posts in the app; publishing uses **official API** with **user-context** credentials | Aligns with **user-initiated** actions; avoid anything that posts/replies/DMs **without** explicit user intent per item. |
| Scheduled posting of **original** editorial content (Data & AI topics) | Similar to allowed examples: scheduled informational content—not identical spam across many accounts or trend gaming. |
| No auto-replies, keyword replies, auto-DMs, auto-likes, bulk follow | Required: unsolicited automation and engagement manipulation are **prohibited**. |
| Multi-source discover + ingest from **non-X** sites | Normal web/API usage; respect each site’s terms and robots conventions where relevant. **X-owned pages** are the special case: use the X API or paste, not HTML scraping. |
| Optional X API reads (tweet lookup, future search) | **Read** usage is billed and rate-limited; cache and dedupe; no scraping. |

### Enforced in application code

- **`assertEligibleForXPublish`** (`shared/xDeveloperRisk.ts`): blocks API publish from **`draft`** or **`posted`**; manual publish only from **`ready`**, **`scheduled`**, or **`failed`**; the scheduler passes **`invokedBy: "scheduler"`** and may only publish **`scheduled`** posts whose **`scheduledAt`** is in the past (double-checked beyond the cron filter).
- **Discover pipeline** aggregates many portals (RSS, HN, Reddit, GitHub, ArXiv, …); it does **not** scrape X. Keep adding sources there — that is separate from X API compliance.
- **Queue UI** reminds operators that publishing is user-driven and points at official guidelines.
- **Research / References (`POST /api/ingest`)**:
  - **No HTML fetch** of `x.com` / `twitter.com` in the generic webpage extractor (would violate “official API only”).
  - **X post URLs** (`…/status/<id>`): text is loaded with **`fetchTweetTextByIdViaOfficialApi`** (`GET /2/tweets/:id` via configured credentials), not scraping.
  - **X profile URLs**: rejected with guidance to use the **X username** ingest path (AI + public signals, no page scrape) or **paste** text.
  - Do **not** use stored X payloads to train external models or exceed redistribution limits documented by X.

---

## Policy quick check (from Developer Guidelines)

Before shipping a feature, all should be **yes** for our use case:

1. **User-initiated?** — User explicitly chose to create, approve, or publish that content.
2. **Transparent?** — Account is a normal user account (not a deceptive bot). If you ever run a **dedicated automated account**, enable the **Automated** label, disclose in bio, link to a human operator.
3. **Easy opt-out?** — Users can stop using the app and revoke app access in X settings; for any **reply/DM** automation (we should avoid), would need clear in-product opt-out.
4. **Official API only?** — No browser automation or scraping of X.
5. **Within limits?** — Respect **rate limits** and **pay-per-usage** / caps (see below).

**Violations** can lead to app suspension, API revocation, or account bans.

---

## Do / Don’t (condensed)

### Do

- Use **HTTPS** only; store keys in **env / secret manager**; never expose tokens in client bundles or logs.
- Treat **429** and usage caps with backoff; monitor `x-rate-limit-*` headers.
- **Delete** stored X content within **24 hours** when X, the user, or a takedown requires it; have a plan for API termination (bulk delete timelines in agreements).
- For **off-X matching** (linking X identity to CRM/email), require **clear opt-in** and disclosure.
- Attribute X content correctly if you embed off-X; follow display / brand rules in official **Display requirements**.

### Don’t

- Identical or coordinated posting across accounts to amplify the same message.
- Auto-replies to non-engaged users, bulk DMs, unsolicited @mentions.
- Auto-like / scheduled like / “growth” likes, selling engagement, bulk follow/unfollow, indiscriminate list adds.
- Scraping or non-API automation.
- Using X data to **train** external ML models (policy calls this out; Grok is carved out on their side).
- Deriving **sensitive** attributes (health, politics, religion, etc.) from X data.
- Redistributing post IDs or hydrated content beyond **technical redistribution limits** (see official tables).
- Creating **multiple apps** to bypass limits for the same use case.

---

## Gray areas relevant to “AI + posting”

- **AI-generated replies at scale:** Official docs state **prior X approval** may be required before deploying AI that **replies** on X. ContentForge’s core loop is **drafting/scheduling posts the user owns**, not unsolicited AI replies—still avoid blurring into public auto-reply bots without legal/product review.
- **Giveaways** requiring follows/reposts: high risk of being seen as **engagement manipulation**; follow [X contest rules](https://help.x.com/en/rules-and-policies/x-contest-rules).
- **Affiliate / promo:** OK when **user-initiated** and **disclosed**; not OK as spam replies or cold DMs.

---

## Authentication (what we use vs what we don’t)

| Method | Typical use | ContentForge |
|--------|-------------|----------------|
| **OAuth 1.0a user context** (API key + secret + access token + secret) | `POST /2/tweets`, `DELETE /2/tweets/:id`, many user-context reads | **Supported** — primary posting path. |
| **OAuth 2 user (PKCE)** with scopes `tweet.read`, `tweet.write`, `users.read` | Same write/read family with scoped tokens | Optional future browser OAuth. |
| **App-only Bearer** | Public read endpoints; **not** for posting as a user | OK for read-only discover if implemented that way; **cannot** replace user context for writes. |

Official mapping table: [v2 authentication mapping](https://docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping).

---

## Rate limits (high-signal excerpt)

Limits **change by tier and over time** — verify in [X API v2 rate limits](https://docs.x.com/x-api/fundamentals/rate-limits) and the Developer Console.

From current public docs (representative):

| Operation | Endpoint | Typical cap (check live docs) |
|-----------|----------|-------------------------------|
| Create post | `POST /2/tweets` | **100 / 15 min** per user; high per-app daily pool |
| Delete post | `DELETE /2/tweets/:id` | **50 / 15 min** per user |
| Recent search | `GET /2/tweets/search/recent` | **300–450 / 15 min** depending on app vs user |
| Tweet lookup | `GET /2/tweets`, `GET /2/tweets/:id` | Per-app and per-user 15-minute windows |

On **429**: exponential backoff; read `x-rate-limit-reset`.

---

## Billing / usage (pay-per-use)

- **Credits** debited per successful billable read operations on listed product surfaces (lookup, search, streams, timelines, etc.). **Failed requests** generally do not bill (per FAQ in official usage doc).
- **Daily deduplication:** same post ID returned multiple times in a day often **counts once** for billing.
- **Monthly post-read cap** on pay-per-use plans is documented (order of **2M reads/month** in public doc—confirm current number in Console).
- **Quote tweets via API** may require **Enterprise** on current docs—verify before building quote-post features on self-serve.

Primary reference: [Usage and Billing / post cap](https://docs.x.com/x-api/fundamentals/post-cap).

---

## HTTP errors (operations)

| Code | Meaning | Action |
|------|---------|--------|
| **400** | Bad request / validation | Fix JSON/query; surface to user. |
| **401** | Auth failure | Keys rotated, wrong signature, clock skew. |
| **403** | Forbidden / wrong product tier | Scopes, plan, or rule violation. |
| **404** | Resource missing | Deleted post/user. |
| **429** | Rate limit or throttle | Backoff; respect headers. |
| **5xx** | X side | Retry with backoff; check [status](https://docs.x.com/status). |

Problem `type` URIs (e.g. `.../rate-limit-exceeded`, `.../usage-capped`) — see [Response codes & errors](https://docs.x.com/x-api/fundamentals/response-codes-and-errors).

---

## Security (minimum bar)

- TLS only; env-based secrets; rotate on leak; minimal OAuth scopes.
- Validate any user input used in **search queries** or rules (injection-style issues in query builders).
- OAuth **state** parameter on any future web OAuth callback; allowlist redirect URLs.
- Breach involving X data: notify X and mitigate per [Security](https://docs.x.com/fundamentals/security).

---

## Official links index (bookmark, don’t paste full llms-full)

| Topic | URL |
|-------|-----|
| Developer Guidelines | https://docs.x.com/developer-guidelines |
| Developer terms hub | https://docs.x.com/developer-terms |
| Authentication overview | https://docs.x.com/fundamentals/authentication/overview |
| v2 auth mapping | https://docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping |
| OAuth 1.0a API key & secret | https://docs.x.com/fundamentals/authentication/oauth-1-0a/api-key-and-secret |
| Rate limits (fundamentals) | https://docs.x.com/fundamentals/rate-limits |
| Rate limits (v2 tables) | https://docs.x.com/x-api/fundamentals/rate-limits |
| Usage / billing (post cap) | https://docs.x.com/x-api/fundamentals/post-cap |
| Response codes & errors | https://docs.x.com/x-api/fundamentals/response-codes-and-errors |
| Security | https://docs.x.com/fundamentals/security |
| Manage Posts | https://docs.x.com/x-api/posts/manage-tweets/introduction |
| Create Post (reference) | https://docs.x.com/x-api/posts/create-post |
| Counting characters | https://docs.x.com/fundamentals/counting-characters |
| OpenAPI | https://docs.x.com/openapi.json |
| Machine-readable full doc (update periodically) | https://docs.x.com/llms-full.txt |

---

## Maintenance

- Re-run a diff against `llms-full.txt` quarterly or when X announces pricing/policy changes.
- Keep **rate limit and billing numbers** out of automated tests as single source of truth—link to Console + official tables instead.
