# ContentForge — Master Plan & Progress Tracker

> **Living document.** Every agent that works on this project MUST:
> 1. Read this file first
> 2. Update task status as work is done (`[ ]` → `[x]`)
> 3. Fill in the "Last Checkpoint" section before handing off
> 4. Never start coding without checking this file

**Owner:** Kishore Kumar Behera (Infrastructure Engineering Lead, 11+ yrs)  
**Primary Goal:** X (Twitter) + Threads monetization via automated content posting  
**Revenue Target:** X Revenue Share → 5M impressions / 90 days + 500 followers  
**Time constraint:** Full-time job. Max 5 min/day of manual effort after setup.  
**Last updated:** 2026-05-05 — DB auto-migrate, X analytics sync, postiz-app audit, publishing fixes

---

## Postiz-App Audit Findings (2026-05-05)

> Audited `/Users/kishore/git/postiz-app`. Goal: copy what works, skip complexity.
> **Bottom line: replace Postiz SaaS cost by building same patterns into ContentForge.**

### What Postiz does that we are copying

| Feature | Postiz file | ContentForge status |
|---------|-------------|---------------------|
| Human-readable X error messages | `x.provider.ts handleErrors()` | ✅ Done — `translateXError()` |
| Auto-sync analytics after posting | `x.provider.ts postAnalytics()` | ✅ Done — fires after every publish |
| Daily analytics refresh | analytics scheduler | ✅ Done — 02:00 UTC cron |
| Threads OAuth2 + publish | `threads.provider.ts` | 🔄 Next — needs THREADS_APP_ID |
| Instagram OAuth2 via Facebook | `instagram.provider.ts` | 🔄 Planned — needs FACEBOOK_APP_ID |
| Per-account token storage | Prisma Integration model | ✅ Already have connected_accounts table |

### What Postiz does that we are NOT copying (too heavy)

| Skipped | Why |
|---------|-----|
| Temporal.io workflows | Our node-cron handles the volume fine |
| NestJS provider abstractions | ContentForge is single-user, not multi-tenant SaaS |
| Image/media upload via sharp | Text threads are the priority; add later if needed |
| Auto-repost plugin | Nice-to-have, not needed yet |

### Cost impact

| Item | Before | After |
|------|--------|-------|
| Postiz SaaS subscription | Paying | Cancel — ContentForge replaces it |
| X API tier | Check if on paid tier | Free tier (1,500 tweets/month) covers ~400/month volume |
| Threads API | Not implemented | Free (Meta Threads Graph API) |
| Instagram API | Not implemented | Free (Meta Graph API, 25 posts/day) |

---

## Current Status: ACTIVE BUILD — DISCOVER + X POSTING PATH

**Architecture:** Neon + Railway + OpenRouter decided; in-process scheduling (`node-cron` planned); PWA first; Apify on hold 30 days; X research via twitterapi.io (not signed up).

**In progress:** Autopilot engine live — 3-4 posts/day, discover → auto-draft → schedule pipeline. Both manual and auto flows work side-by-side.

**Posting frequency target:** 3–4 posts/day (not week) across 3 global time slots: 07:30 UTC (EU), 14:00 UTC (India), 17:30 UTC (US).

---

## Last Checkpoint (update this every session)

```
Date: 2026-05-05
Agent: Claude Sonnet 4.6

What was done this session:
  DB MIGRATIONS (CRITICAL FIX):
  - server/index.ts: replaced manual ALTER TABLE with drizzle-orm migrate() on startup
  - migrations/0000_init.sql: full schema baseline (CREATE TABLE IF NOT EXISTS — safe on existing Railway DB)
  - script/build.ts: copies migrations/ to dist/migrations/ so migrate() finds them at runtime
  - package.json: added db:generate script
  → Going forward: edit schema.ts → npm run db:generate → commit → Railway auto-migrates

  PUBLISHING FIXES:
  - Queue page: "Post to X" on a draft auto-promotes to ready before publishing (no more 500 error)
  - Fixed missing external_urls + error_message columns in startup migration

  POSTIZ-APP AUDIT + X IMPROVEMENTS (copied from postiz-app):
  - server/social/x.ts: translateXError() — human-readable X API error messages
    (usage-cap, duplicate post, auth expired, invalid URL, video too long, etc.)
  - server/social/x.ts: syncPostAnalyticsFromX(postId) — after posting, fetches
    public_metrics from X API and upserts into analytics table
  - server/social/x.ts: refreshXAnalytics(days) — bulk refresh for all posted X posts
  - server/storage.ts: upsertAnalytics() — delete+insert for x_api source analytics
  - server/scheduler.ts: daily 02:00 UTC analytics refresh cron
  - server/routes.ts: POST /api/analytics/sync/x and /api/analytics/sync/x/:id

What is NOT done yet:
  - "Sync from X" button on Analytics page (30 min UI — endpoint exists)
  - Threads publisher (needs THREADS_APP_ID from Kishore first)
  - Instagram publisher (needs FACEBOOK_APP_ID + Business accounts from Kishore)
  - Account selector in draft creation (after Threads/Instagram wired up)

Next steps (in order):
  1) Add "Sync from X" button to analytics page (quick win, 30 min)
  2) When Kishore has THREADS_APP_ID → implement Threads publisher (Sprint 3)
  3) When Kishore has FACEBOOK_APP_ID → implement Instagram publisher
```

---

## Weekly cadence & global posting (playbook)

**Goal:** 3–4 posts/day to X, timed for **US / Europe / India**, with **off-X research** (RSS, Reddit, GitHub, blogs, Substack, etc.) → AI hooks & synthesis → **you approve** → **X API only to publish**. One heavier “weekend read” piece (often **Friday**).

### Suggested publish windows (store as UTC in `scheduled_at`)

| Audience | Local window (rule of thumb) | UTC-ish |
|----------|-------------------------------|---------|
| **US / English** | Lunch scroll | ~**17:00–19:00 UTC** (12–2pm US Eastern) |
| **Europe** | Morning commute | ~**07:30–09:30 UTC** (8:30–10:30 London winter) |
| **India** | Evening | ~**14:00–16:00 UTC** (7:30–9:30pm IST) |

Rotate which post hits which band across the week (e.g. Mon US, Wed EU, Fri India + long read). **Cron compares `scheduled_at` to wall clock in UTC inside JS** — pick the exact instant in Calendar so each post fires in the right global window (set Railway to UTC or keep `CRON_TZ` consistent; the timestamp is what matters).

### Example week (3–4 posts + Fri anchor)

| Day | Format | Notes |
|-----|--------|--------|
| **Mon** | Tweet | One strong hook + one insight |
| **Tue** | Thread | Tutorial / list / story |
| **Wed** | Tweet | Hot take or data point from research |
| **Thu** | (rest or light tweet) | Optional 4th slot |
| **Fri** | Long / article | Thread teaser + link, or native thread — timed so **Saturday** opens in target TZ |

### Morning “research stack” (automated + minimal you)

1. **Curated allowlist** — RSS + Discover sources (blogs, Substack, eng portals); **round-robin** emphasis (e.g. Mon Reddit-heavy, Tue RSS-heavy) until we add code rotation.
2. **Daily discover job** — `DISCOVER_CRON` (e.g. `30 5 * * *` in `CRON_TZ`) runs ingest/rank pipeline.
3. **Rank** — viral score + your 5‑min pass: pick top ideas with hooks.
4. **Dedupe** — skip if same URL/title already in `ideas` / `posts` (**not built yet** — priority backlog).
5. **Generate → Ready** — Calendar schedule to the **band** above; Queue or auto-publish when due.

### Google Trends

Use **official** Trends data (CSV export, Trends UI, or API where allowed) as **input to ideas**, not scraping. Optional later: small job that writes ranked topics into `discovered_ideas` or `ideas`.

### Gaps vs app today

- Dedupe / “already covered”
- Calendar labels for **target region** per slot
- Optional cadence presets (tweet vs thread vs Fri long)

---

## Architecture Decisions (Final)

| Decision | Choice | Reason |
|---|---|---|
| Database | **Neon** (PostgreSQL serverless, free tier) | Zero config, Drizzle-native, free, daily backups, branching |
| App hosting | **Railway** (~$5/mo) | Simple, GitHub auto-deploy, HTTPS out of box, needed for X OAuth |
| AI provider | **OpenRouter** (one key, 200+ models) | Replaces home Ollama + pays-per-use, ~$2-5/mo |
| X posting | **twitter-api-v2 npm** + X pay-per-use API (~$2.50/mo) | Official, no ban risk, sufficient volume |
| X research | **twitterapi.io** (100K free credits on signup) | Read/search X without paying for X API Read tier |
| Reddit | **Free Reddit JSON API** (already implemented) | Free, no auth needed, 10 req/min |
| GitHub trending | **scrape-github-trending npm** | Free scrape of github.com/trending |
| Scheduling | **node-cron** (in-process, free) | Zero external services |
| Mobile | **PWA first** (vite-plugin-pwa, 2 hours) → Capacitor later | Fastest path to all-device access |
| Apify | **HOLD** — evaluate after 30 days posting | Main value is LinkedIn scraping; defer until proven needed |
| Home server | **Dropped** — Railway handles everything | Mac goes to sleep, not worth the maintenance |

---

## Environment Variables

> Kishore fills these in. Mark ✅ when each is set in Railway + local .env.

### Required Before Sprint 1 (must have)

| Variable | Value | Status | Where to get |
|---|---|---|---|
| `DATABASE_URL` | `postgresql://...neon.tech/...` | ⬜ NOT SET | Neon dashboard → project → connection string |
| `SESSION_SECRET` | any long random string | ⬜ NOT SET | Run: `openssl rand -hex 32` |
| `AI_API_KEY` | OpenAI or OpenRouter key | ⬜ NOT SET | Already set? Check existing .env |
| `X_CLIENT_ID` | From X Developer Portal | ⬜ NOT SET | developer.x.com → Your App → OAuth 2.0 Client ID |
| `X_CLIENT_SECRET` | From X Developer Portal | ⬜ NOT SET | developer.x.com → Your App → OAuth 2.0 Client Secret |
| `X_ACCESS_TOKEN` | Your personal access token | ⬜ NOT SET | developer.x.com → Your App → Keys and Tokens |
| `X_ACCESS_TOKEN_SECRET` | Your personal access secret | ⬜ NOT SET | developer.x.com → Your App → Keys and Tokens |
| `X_CALLBACK_URL` | `https://<railway-url>/api/social/x/callback` | ⬜ NOT SET | Set after Railway deploy |
| `PORT` | `5000` | ⬜ NOT SET | Add to Railway env vars |

### Required Before Sprint 3 (Threads)

| Variable | Value | Status | Where to get |
|---|---|---|---|
| `THREADS_APP_ID` | From Meta Developer Portal | ⬜ NOT SET | developers.facebook.com → Your App |
| `THREADS_APP_SECRET` | From Meta Developer Portal | ⬜ NOT SET | developers.facebook.com → Your App |
| `THREADS_CALLBACK_URL` | `https://<railway-url>/api/social/threads/callback` | ⬜ NOT SET | Set after Railway deploy |

### Optional (AI Cost Saving)

| Variable | Value | Status | Where to get |
|---|---|---|---|
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` | ⬜ NOT SET | openrouter.ai |
| `AI_TEXT_MODEL` | `meta-llama/llama-3.1-8b-instruct` | ⬜ NOT SET | For cheap drafts via OpenRouter |
| `TWITTERAPI_IO_KEY` | API key | ⬜ NOT SET | twitterapi.io (100K free credits) |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console | ⬜ NOT SET | For Google OAuth login |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console | ⬜ NOT SET | For Google OAuth login |

---

## Features Inspired by CannerAI Analysis

> CannerAI (cannerai.com) is a competitor. LinkedIn-focused but X/Twitter too.  
> Key features ContentForge is MISSING that CannerAI has:

| CannerAI Feature | Add to ContentForge? | Priority | Sprint |
|---|---|---|---|
| **Reply/Comment templates** ("Canned responses") — pre-written replies in your voice for fast engagement | ✅ YES — critical for X engagement loops | High | S5 |
| **YouTube channel monitoring** — subscribe to channels, auto-ingest new videos | ✅ YES — good for research automation | Medium | S4 |
| **Discussion/comment mining** — extract post ideas from viral post comment sections | ✅ YES — unique angle generator | Medium | S4 |
| **120+ templates** — ContentForge has 7, CannerAI has 120+ | ✅ YES — expand to 50+ in seeded templates | Medium | S2 |
| **Voice matching from past posts** — upload your old tweets, AI learns your style | ✅ YES — "AI Learn" exists but improve it | Medium | S5 |
| LinkedIn-only focus | ❌ NO — we're X-first, LinkedIn is secondary | — | — |

---

## Content Pillars (Expanded — 14 total)

> These replace the current 6 pillars. Add to `server/seed.ts` in Sprint S2-1.

| # | Pillar Name | Core Topics | Color |
|---|---|---|---|
| 1 | Data Infrastructure & MLOps | Pipelines, feature stores, model serving, data mesh, lakehouse | #3B82F6 |
| 2 | AIOps & AI-Assisted DevOps | AI observability, LLM for IaC review, intelligent incident triage | #8B5CF6 |
| 3 | Cloud-Native Data Platforms | Kafka/Spark/Flink on K8s, multi-cloud data, cost optimization | #06B6D4 |
| 4 | Infrastructure as Code | Terraform, Crossplane, Pulumi, GitOps, Flux, ArgoCD | #10B981 |
| 5 | SRE & Reliability Engineering | SLOs/error budgets, chaos engineering, incident management, on-call | #EC4899 |
| 6 | Platform Engineering & DevEx | Internal developer platforms, Backstage, golden paths, self-service infra | #F97316 |
| 7 | Kubernetes Deep Dives | K8s internals, operators, scheduling, networking (CNI), storage (CSI) | #14B8A6 |
| 8 | AI Agents & Agentic Workflows | LLM agents, RAG, agentic pipelines, MCP, guardrails, LangChain patterns | #A855F7 |
| 9 | Technical Leadership & Eng Management | Staff/Principal patterns, managing distributed teams, hiring, roadmaps | #F59E0B |
| 10 | Security & DevSecOps | Supply chain security, SLSA, secrets management, SAST/DAST, zero-trust | #EF4444 |
| 11 | FinOps & Cloud Cost Engineering | Reserved instances, spot strategy, K8s cost attribution, rightsizing | #84CC16 |
| 12 | Open Source & CNCF Ecosystem | Project spotlights, contribution strategy, CNCF landscape | #0EA5E9 |
| 13 | Career & Leadership | Growth IC→manager, remote-first teams, mentoring, salary negotiation | #F59E0B |
| 14 | Hot Takes & Trends | Tool wars, industry shifts, unpopular opinions, predictions | #EF4444 |

---

## Sprint Tracker

> Status: `⬜ NOT STARTED` | `🔄 IN PROGRESS` | `✅ DONE` | `🚫 BLOCKED`

---

### SPRINT 0 — Foundation (Kishore does account setup, Agent does code prep)

**Goal:** App running on Railway + Neon + X credentials ready  
**Status:** 🚫 BLOCKED on Kishore's account setup

| # | Task | Who | Status | Notes |
|---|---|---|---|---|
| S0-1 | Create Neon account at neon.tech → new project `contentforge-prod` → copy `DATABASE_URL` | Kishore | ⬜ | Share DATABASE_URL with agent |
| S0-2 | Create Railway account → connect GitHub repo `ContentForge` → deploy → get public URL | Kishore | ⬜ | Share Railway URL with agent |
| S0-3 | Add all env vars to Railway dashboard (from table above) | Kishore | ⬜ | After S0-1 and S0-2 |
| S0-4 | Register at developer.x.com → create App → enable "Read and Write" → copy API_KEY, API_SECRET, ACCESS_TOKEN, ACCESS_TOKEN_SECRET | Kishore | ⬜ | Share all 4 with agent |
| S0-5 | Register at twitterapi.io → get free 100K credits API key | Kishore | ⬜ | Share key with agent |
| S0-6 | Register at openrouter.ai → get API key | Kishore | ⬜ | Optional but recommended |
| S0-7 | Agent: Update `.env` template in repo with all new var names | Agent | ⬜ | After Kishore has accounts |
| S0-8 | Agent: Run `npm run db:push` against Neon → verify schema created | Agent | ⬜ | After S0-1 |
| S0-9 | Agent: Verify `npm run dev` starts cleanly with Neon DATABASE_URL | Agent | ⬜ | After S0-8 |
| S0-10 | Agent: Add `vite-plugin-pwa` → manifest.json → icons → basic offline caching | Agent | ⬜ | Quick win, 2 hours |

---

### SPRINT 1 — X Posting (THE revenue unlock)

**Goal:** Can post to X manually and on schedule. This starts the revenue clock.  
**Status:** 🔄 IN PROGRESS — code complete, blocked on X credentials  
**Blocked by:** S0-4 (X credentials from Kishore)

| # | Task | Who | Status | Notes |
|---|---|---|---|---|
| S1-1 | Add `externalIds jsonb`, `externalUrls jsonb`, `errorMessage text` to `posts` table | Agent | ✅ | Done in prior session |
| S1-2 | `npm install twitter-api-v2` | Agent | ✅ | Done in prior session |
| S1-3 | `server/social/x.ts` — OAuth1 + OAuth2 + DB token fallback, thread posting | Agent | ✅ | Done in prior session |
| S1-4 | `GET /api/social/x/start` + `GET /api/social/x/callback` OAuth routes | Agent | ✅ | Done in prior session |
| S1-5 | `POST /api/posts/:id/publish` → x.ts → sets `posted` + externalUrls | Agent | ✅ | Done in prior session |
| S1-6 | `node-cron` + `server/scheduler.ts` — every-minute publish check + retry backoff | Agent | ✅ | Enhanced in this session (retry logic added) |
| S1-7 | Wire scheduler into `server/index.ts` on startup | Agent | ✅ | Done in prior session |
| S1-8 | `/queue` page + "Post Now" + sidebar nav | Agent | ✅ | Done in prior session |
| S1-9 | "Connect X" OAuth button + connection status in Settings | Agent | ⬜ | Still needed |
| S1-10 | End-to-end test: morning briefing → review → Post Now → verify tweet on x.com | Kishore + Agent | 🚫 BLOCKED | Needs X credentials |

---

### SPRINT 2 — Content Expansion (Pillars + Research)

**Goal:** 14 pillars, richer research sources, better discovery  
**Status:** ⬜ NOT STARTED

| # | Task | Who | Status | Notes |
|---|---|---|---|---|
| S2-1 | Expand `server/seed.ts`: replace 6 pillars with 14 (idempotent — only insert if not exists) | Agent | ⬜ | See pillar table above |
| S2-2 | Update `SYSTEM_PROMPT` in `server/routes.ts` to cover all 14 pillars + Kishore's war stories (Maersk, Salesforce $500K savings, SAP Labs) | Agent | ⬜ | Critical for AI quality |
| S2-3 | Expand `CONTENT_PILLARS_DATA` constant in `server/routes.ts` to match new 14 | Agent | ⬜ | |
| S2-4 | Add 7 new Reddit subreddits to discover refresh: `r/sre`, `r/platformengineering`, `r/cloudnative`, `r/aws`, `r/googlecloud`, `r/FinOps`, `r/ExperiencedDevs` | Agent | ⬜ | More relevant research |
| S2-5 | Add 8 new RSS sources to seed: Kubernetes Blog, CNCF Blog, The New Stack, InfoQ DevOps, SRE Weekly, AWS What's New, GCP Blog, Last Week in AI | Agent | ⬜ | Richer content feed |
| S2-6 | Replace GitHub API search in discover with `scrape-github-trending` npm package | Agent | ⬜ | Better trending repos |
| S2-7 | Add `GET /api/research/x-trending` endpoint using twitterapi.io to search viral DevOps/K8s tweets | Agent | ⬜ | After S0-5 |
| S2-8 | Expand templates from 7 → 50+ in `server/seed.ts` covering all 14 pillars | Agent | ⬜ | Modelled on CannerAI's 120+ |

---

### SPRINT 3 — Threads Posting

**Goal:** Post to Threads automatically alongside X  
**Status:** ⬜ NOT STARTED  
**Blocked by:** Kishore creating Meta Developer App

| # | Task | Who | Status | Notes |
|---|---|---|---|---|
| S3-1 | Create Meta Developer App at developers.facebook.com → enable Threads API → get App ID + Secret | Kishore | ⬜ | Share credentials with agent |
| S3-2 | Create `server/social/threads.ts` with `postToThreads(token, content)` | Agent | ⬜ | |
| S3-3 | Add Threads OAuth routes: `/api/social/threads/start` + `/api/social/threads/callback` | Agent | ⬜ | |
| S3-4 | Add Threads to publish endpoint (posts to both X and Threads simultaneously) | Agent | ⬜ | |
| S3-5 | Add "Connect Threads" button to Settings page | Agent | ⬜ | |
| S3-6 | Test: post to Threads → verify it appears | Kishore + Agent | ⬜ | |

---

### SPRINT 4.5 — Autopilot Intelligence (3-4x/day, both manual + auto)

**Goal:** Full autopilot — research all sources, auto-draft, auto-schedule 3-4x/day. Manual flow still available for Kishore to override or add custom posts.  
**Status:** ✅ DONE (this session)

| # | Task | Who | Status | Notes |
|---|---|---|---|---|
| S4.5-1 | `server/autopilot.ts` — `generateDraftFromIdea()`, `autofillCalendar()`, `runMorningBriefing()` | Agent | ✅ | Core engine |
| S4.5-2 | Morning briefing cron (05:00 UTC) — discover + auto-generate 5 ready drafts | Agent | ✅ | Wired in scheduler |
| S4.5-3 | Calendar autofill cron (Sun 18:00 UTC) — fills next 7 days × 3 slots/day | Agent | ✅ | 07:30/14:00/17:30 UTC slots |
| S4.5-4 | Exponential retry: failed posts retry at 5m/30m/120m, max 3 attempts | Agent | ✅ | retry_count + last_retry_at on posts |
| S4.5-5 | Google Trends RSS + 6 new Reddit subreddits + URL dedupe in discover | Agent | ✅ | sre/platformengineering/cloudnative/aws/gcp/finops |
| S4.5-6 | 14 pillars seeded (expanded from 6) — idempotent | Agent | ✅ | SRE, Platform Eng, K8s, AI Agents, Security, FinOps, CNCF added |
| S4.5-7 | 30+ templates seeded (expanded from 7) | Agent | ✅ | |
| S4.5-8 | `GET /api/autopilot/content-gaps` — pillars not posted in N days | Agent | ✅ | |
| S4.5-9 | `GET /api/autopilot/status` — pipeline health dashboard endpoint | Agent | ✅ | |
| S4.5-10 | Manual override: Discover page still works for manual research + pick-and-generate | Agent | ✅ | Both flows coexist |

**Posting slots (UTC, stored in `scheduled_at`):**
| Slot | UTC | Audience | Content type rotation |
|------|-----|----------|----------------------|
| Morning | 07:30 | EU commute | Thread (educational) |
| Afternoon | 14:00 | India evening | Tweet or Hot Take |
| Evening | 17:30 | US lunch | Thread or Long Thread |

---

### SPRINT 4 — Daily Workflow Automation (5-min ritual)

**Goal:** One screen, 5 minutes, week scheduled. Morning Briefing + auto-calendar.  
**Status:** ⬜ NOT STARTED

| # | Task | Who | Status | Notes |
|---|---|---|---|---|
| S4-1 | `GET /api/discover/morning-briefing` — pre-compute top 5 ideas + 3 draft variations each at 5 AM via cron | Agent | ⬜ | Killer feature |
| S4-2 | `POST /api/calendar/autofill` — fills next 7 days with posts at 8 AM / 12 PM / 5 PM EST | Agent | ⬜ | True automation |
| S4-3 | Daily cron: for all posted tweets, call X API to fetch impressions/likes → update `analytics` table | Agent | ✅ | Done — 02:00 UTC, syncPostAnalyticsFromX() |
| S4-4 | Analytics dashboard: "Revenue Share Progress" widget — impressions last 90 days vs 5M goal + projected date | Agent | ⬜ | Motivation tracker |
| S4-5 | YouTube channel monitoring — subscribe to channel URLs, cron checks for new videos, auto-adds to ideas | Agent | ⬜ | Inspired by CannerAI |
| S4-6 | Comment/discussion mining — for a given viral tweet URL, extract comments as post idea seeds | Agent | ⬜ | Inspired by CannerAI |
| S4-7 | `POST /api/research/push` webhook — home server (if ever used) can push trending content to ContentForge | Agent | ⬜ | Simple endpoint, low effort |

---

### SPRINT 5 — Engagement + Polish

**Goal:** Features that compound engagement (replies, voice matching, templates)  
**Status:** ⬜ NOT STARTED

| # | Task | Who | Status | Notes |
|---|---|---|---|---|
| S5-1 | **Reply Templates** — library of pre-written reply starters in Kishore's voice for fast engagement on others' posts | Agent | ⬜ | Inspired by CannerAI "canned responses". Huge for X growth |
| S5-2 | **Voice Fingerprint** — import Kishore's past 100 tweets, AI extracts vocabulary, sentence patterns, emoji usage, hooks | Agent | ⬜ | Improve on existing "AI Learn" in Brand Memory |
| S5-3 | Add rate limiting on AI endpoints (`express-rate-limit`) | Agent | ⬜ | Cost safety before any public exposure |
| S5-4 | Add `@extractus/article-extractor` for better blog/article scraping (handles JS-heavy + paywalled sites better than cheerio alone) | Agent | ⬜ | |
| S5-5 | Performance: cache RSS feed results per source (don't re-fetch if < 1 hour old) | Agent | ⬜ | Discovery currently slow (60-90s) |

---

### SPRINT 6 — OpenRouter + AI Cost Control

**Goal:** Pay-per-use AI across 200+ models, Settings UI to pick model  
**Status:** ⬜ NOT STARTED

| # | Task | Who | Status | Notes |
|---|---|---|---|---|
| S6-1 | Update `server/ai/config.ts` to support OpenRouter (just env var swap, already architected for this) | Agent | ⬜ | 5-minute change once key available |
| S6-2 | Settings UI: model picker — cheap Llama 3 for drafts, Claude Haiku for polish, GPT-4o for premium | Agent | ⬜ | |
| S6-3 | Track cost per feature in `ai_usage_log` table with estimated $ amount | Agent | ⬜ | Know your AI spend |

---

### SPRINT 7 — Mobile (PWA → Native)

**Goal:** App installable on iPhone and Android  
**Status:** 🔄 S0-10 is in Sprint 0 (basic PWA)

| # | Task | Who | Status | Notes |
|---|---|---|---|---|
| S7-1 | Complete PWA: service worker + offline caching for calendar + drafts page | Agent | ⬜ | After S0-10 basic setup |
| S7-2 | Push notifications for scheduled post reminders via PWA | Agent | ⬜ | |
| S7-3 | (DEFER) Capacitor wrapping for App Store / Google Play submission | Agent | ⬜ | Only after app is stable and posting daily |

---

### SPRINT 8 — Public Launch Prep (DEFER — Month 2+)

> **Do NOT start until Kishore has 90 days of consistent posting.**

| # | Task | Who | Status | Notes |
|---|---|---|---|---|
| S8-1 | Add `userId` FK to all tables (posts, ideas, articles, templates, etc.) | Agent | ⬜ | Row-level data isolation |
| S8-2 | Filter every storage query by `req.session.userId` | Agent | ⬜ | Security for multi-user |
| S8-3 | Stripe billing integration | Agent | ⬜ | |
| S8-4 | Email verification on signup | Agent | ⬜ | |
| S8-5 | Landing page | Agent | ⬜ | |
| S8-6 | LinkedIn API actual posting | Agent | ⬜ | |

---

## What Was Built in Phase 0 (Already Done)

> Previous agent completed this. Do NOT redo.

- [x] AI provider unification → `server/ai/config.ts` with `MODELS.*` registry
- [x] Zero-code provider switching via env vars (OpenAI → OpenRouter → Ollama)
- [x] PostgreSQL 16 via Docker Compose (`docker-compose.yml`)
- [x] Makefile commands: `make db` + `make dev`
- [x] Schema pushed via Drizzle ORM (26 tables)
- [x] Seed data: 6 pillars, 7 templates, RSS sources, monitored X accounts, sample posts
- [x] `.env` template with all required variables
- [x] Bug fix: Brand memory `memoryJson` not persisting → fixed in `server/routes.ts`
- [x] Bug fix: Missing `GET /api/ideas/:id` → added
- [x] Bug fix: Missing `storage.getIdea()` → added
- [x] All 17 hardcoded model strings replaced with `MODELS.*` constants

---

## Key Files Reference

| File | Purpose | Touch for |
|---|---|---|
| `server/ai/config.ts` | AI client + model registry | Any model or provider changes |
| `server/routes.ts` | ALL API routes (~2500 lines) | New endpoints, AI prompt changes |
| `server/storage.ts` | All DB queries | New DB methods |
| `server/seed.ts` | Seed data (idempotent) | Adding pillars, templates, RSS sources |
| `server/index.ts` | Server bootstrap | Adding middleware, scheduler startup |
| `server/scheduler.ts` | Background cron jobs | Scheduling logic (CREATE THIS in S1-6) |
| `server/social/x.ts` | X posting logic | X API changes (CREATE THIS in S1-3) |
| `server/social/threads.ts` | Threads posting logic | Threads API changes (CREATE THIS in S3-2) |
| `shared/schema.ts` | Drizzle schema (source of truth) | DB structure changes → always run `npm run db:push` after |
| `client/src/pages/generate.tsx` | Main content generation UI | Post Now / Schedule buttons (S1-8) |
| `client/src/pages/settings.tsx` | Settings page | Connect X/Threads buttons (S1-9, S3-5) |
| `client/src/pages/analytics.tsx` | Analytics dashboard | Revenue progress widget (S4-4) |
| `PLAN.md` | **This file** | After every session |

---

## Known Issues & Gotchas

| Issue | Workaround |
|---|---|
| Port 5000 conflicts on macOS | Use `PORT=3000 npm run dev` |
| X OAuth requires public HTTPS URL | Deploy to Railway first (Sprint 0) |
| Discovery refresh takes 60-90s | Pre-compute via morning briefing cron (S4-1) |
| `reusePort` not supported on macOS | Already removed from `server/index.ts` |
| Brand memory update only patches fields explicitly passed | Known behavior, not a bug |
| Seed runs on startup — idempotent via existence checks | Safe to re-run |
| Reddit JSON API rate limit: 10 req/min unauth | Already handled with timeouts |
| Screenshots stored in `/uploads/` folder | This folder is gitignored — not persisted on Railway. Need object storage (S3/Cloudflare R2) if screenshots must persist. **LOW PRIORITY for now.** |

---

## Competitive Context (CannerAI Analysis)

> Reviewed cannerai.com on 2026-05-01. LinkedIn-focused tool, also supports X.

**What they have that we're adding:**
- Reply/comment templates for fast engagement (→ Sprint 5)
- YouTube channel monitoring (→ Sprint 4)
- Discussion/comment mining for post ideas (→ Sprint 4)
- 120+ templates (→ Sprint 2, expanding to 50+ first)

**Where ContentForge beats CannerAI:**
- X/Threads-first (CannerAI is LinkedIn-first)
- Technical DevOps/K8s/SRE niche depth (CannerAI is generic)
- Full open-source stack (you own your data)
- No monthly subscription for the tool itself (you only pay AI API + Railway)
- Context Vault, References Library, Carousel Builder all built
- Free self-hosted = no per-seat cost when you open to others

---

## How to Hand Off to Next Agent

When ending a session, update the "Last Checkpoint" section at the top with:
1. Date and agent name
2. What was done this session (bullet list)
3. What is NOT done yet
4. Any blocking items
5. Exact task number to start from next session

Then share `PLAN.md` + `HANDOFF.md` with the next agent as the first context.

---

*End of PLAN.md — update this file every session.*
