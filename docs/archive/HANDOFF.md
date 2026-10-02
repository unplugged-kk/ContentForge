# ContentForge — Agent Handoff Document

> **For:** Next agent taking over the project
> **From:** Previous agent (Phase 0 complete)
> **Date:** 2026-05-01
> **Owner:** Kishore Kumar Behera (Infrastructure Engineering Lead, 11+ yrs)
> **Goal:** Generate second income via X (Twitter) content monetization

---

## 1. What Is ContentForge?

ContentForge is an **AI-powered content creation and social media management platform** built for a single user (Kishore) to:

1. **Discover** trending DevOps/Kubernetes/AI content from HN, Reddit, RSS, GitHub, ArXiv
2. **Generate** tweet threads, single tweets, hooks, and articles using AI (OpenAI currently)
3. **Schedule and post** to X (Twitter) and Threads automatically
4. **Track analytics** to optimize for the X Revenue Share program (5M impressions / 90 days)

**The whole point:** Kishore has a full-time job. This tool automates his personal brand so he can post daily with ~5 minutes of effort, growing his audience and generating income via X Revenue Share + consulting leads.

---

## 2. What Has Been Built (Phase 0 — COMPLETE)

### 2.1 AI Provider Unification ✅
- **File:** `server/ai/config.ts` — Centralized OpenAI-compatible client
- **Models registry:** `MODELS.TEXT`, `MODELS.VISION`, `MODELS.IMAGE`, `MODELS.AUDIO`, `MODELS.AUDIO_TRANSCRIBE`
- **Zero-code provider switching:** Change env vars to switch between OpenAI → OpenRouter → Ollama
- All 17 hardcoded model strings replaced with `MODELS.*` constants
- `logAiUsage()` now records the actual model name used (not hardcoded string)

### 2.2 Database & Local Dev Setup ✅
- **PostgreSQL 16** via Docker Compose (`docker-compose.yml`)
- **Makefile** commands: `make db` (start DB), `make dev` (start server)
- **Schema pushed** via Drizzle ORM
- **Seed data** populated (pillars, templates, ideas, posts, RSS sources, monitored X accounts)
- **`.env`** template with all required variables
- **`.gitignore`** includes `.env` (secrets safe)

### 2.3 Core Features Working

| Feature | Status | Endpoint | Notes |
|---|---|---|---|
| Auth (register/login/session) | ✅ | `/api/auth/*` | Email + password. Google OAuth coded but needs env vars |
| Content pillars | ✅ | `/api/pillars` | 6 pillars seeded |
| Ideas vault | ✅ | `/api/ideas/*` | CRUD + expand into posts |
| Posts / Drafts | ✅ | `/api/posts/*` | CRUD + status updates (draft → ready → scheduled) |
| AI Generation | ✅ | `/api/generate` | Tweet/thread variations using gpt-4o-mini |
| Templates | ✅ | `/api/templates` | 7 post templates |
| Discovery engine | ✅ | `/api/discover/*` | Fetches HN, Reddit, RSS, GitHub, ArXiv in parallel |
| Analytics | ✅ | `/api/analytics/*` | Summary stats |
| Brand memory | ✅ | `/api/profile/memory` | Stores user preferences (bug fixed) |
| Hooks generator | ✅ | `/api/hooks/generate` | AI-generated hook lines |
| Style profiles | ✅ | `/api/styles` | Empty schema ready |
| References / Vault | ✅ | `/api/references`, `/api/vault` | Empty schema ready |
| Chat | ✅ | `/api/conversations` | Empty schema ready |
| Images / Carousels | ✅ | `/api/images`, `/api/carousels` | Empty schema ready |

### 2.4 Bugs Fixed in This Phase
- Brand memory update not persisting `memoryJson` — fixed in `server/routes.ts`
- Missing `GET /api/ideas/:id` endpoint — added
- Missing `storage.getIdea()` method — added

---

## 3. What Must Be Built Next (Prioritized)

### 🔥 PHASE 1 — X Posting (HIGHEST PRIORITY — blocks revenue)
> **This is the #1 gap.** Without this, the app is a toy, not a business tool.

**1.1 X OAuth 2.0 Flow**
- New file: `server/social/x.ts` — `postSingleToX()`, `postThreadToX()`
- Routes: `GET /api/social/x/start`, `GET /api/social/x/callback`
- Uses PKCE, stores tokens in `connected_accounts` table
- **User already has X Client ID + Secret** in `.env`

**1.2 Publish Endpoint**
- `POST /api/posts/:id/publish` — publishes to X (and Threads if connected)
- Updates post status to `posted`, stores `externalIds` + `externalUrls`

**1.3 Scheduler**
- Install `node-cron`, create `server/scheduler.ts`
- Runs every minute, checks `posts.status = "scheduled"` + `scheduledAt <= now()`
- Calls publish logic automatically

**1.4 UI Buttons**
- "Post Now" and "Schedule" buttons on Generate page
- "Connect X" indicator in Settings

**1.5 Schema Migration**
- Add `externalIds`, `externalUrls`, `errorMessage` to `posts` table

### PHASE 2 — Niche Expansion (Week 2)
- Expand 6 → 12 content pillars
- Sharpen `SYSTEM_PROMPT` with Kishore's specific war stories
- Expand RSS sources (Kubernetes Blog, CNCF, SRE Weekly, etc.)
- Expand subreddits in discovery
- **Activate X competitor monitoring** (schema seeded but nothing reads from it)

### PHASE 3 — Daily Workflow (Week 3)
- **Morning Briefing endpoint:** `GET /api/discover/morning-briefing`
  - Returns top 5 ideas + 3 post variations each = 15 drafts ready
  - One screen, 5-minute daily ritual
- **X analytics auto-import:** Daily cron pulls impressions/likes from X API
- **Revenue Share progress bar** in Analytics dashboard
- **Quality scoring:** AI scores drafts before publishing (0-100)

### PHASE 4 — Compounding (Week 4+)
- Auto-schedule queue (fills next 7 days from discovered ideas)
- LinkedIn API integration
- Reply mining (expand your own replies into standalone posts)
- RSS autoposting

### PHASE 5 — Multi-tenant (Month 2+, DEFER)
- DO NOT BUILD until Kishore has 90 days of consistent posting
- User isolation, Stripe billing, landing page

---

## 4. Kishore's Vision & Constraints

### His Goal
> **"Generate a second income."**
> Primary path: X Revenue Share (need 5M impressions in 90 days + 500 followers)
> Secondary: Consulting leads from brand recognition

### His Constraints
- Full-time job = **very limited time**
- Target: **5-minute daily ritual** to schedule posts
- Wants to **read DevOps/K8s news** in the app, not hunt for it
- Wants **AI to auto-create posts** from discovered content
- Willing to spend ~$10-15/mo on AI (currently using OpenAI credits)

### His Voice & Niche
- **Niche:** DevOps · Platform Engineering · SRE · Kubernetes · Multi-Cloud · AI/Data
- **Voice:** Practitioner, not pundit. War stories over textbook. Numbers over adjectives.
- **Reference points:** Maersk (Crossplane/Flux), Salesforce ($500K AWS savings), SAP Labs (multi-cloud)
- **Platforms:** X (primary) → Threads → LinkedIn

### Technical Preferences
- **AI Provider:** OpenAI now (has credits), OpenRouter later (one key, all models), Ollama for local option
- **Models:** Use cheapest that works (gpt-4o-mini for everything text + vision). Upgrade to gpt-4o/Claude only for premium features.
- **Hosting:** Not decided yet. Local dev on localhost:3000. Will need production host before Phase 1 OAuth works publicly.
- **Database:** PostgreSQL via Docker locally. Will need cloud DB for production.

---

## 5. Architecture

```
Frontend: React + Vite + Tailwind + shadcn/ui
Backend: Express + TypeScript + Drizzle ORM
Database: PostgreSQL 16 (Docker locally)
AI: OpenAI SDK (openai package) — centralized in server/ai/config.ts
Auth: Express sessions (PostgreSQL store) + passport-local + passport-google-oauth20
Scheduler: node-cron (not yet installed)
Social APIs: twitter-api-v2 (not yet installed)
```

### Key Files
| File | Purpose |
|---|---|
| `server/ai/config.ts` | Single AI client + model registry. **Touch this for any model changes.** |
| `server/routes.ts` | All API routes (big file, ~2500 lines). **This is where most features live.** |
| `server/storage.ts` | Database queries. Add methods here, update interface at top. |
| `server/seed.ts` | Seed data. Safe to re-run (idempotent checks). |
| `shared/schema.ts` | Database schema. Edit → run `npm run db:push` |
| `server/index.ts` | Server bootstrap. dotenv loaded here. |
| `.env` | All secrets. **Never commit this.** |

---

## 6. Environment Variables

Current `.env` has these set:
```bash
AI_API_KEY=sk-...                    # OpenAI key (user filled)
AI_TEXT_MODEL=gpt-4o-mini
AI_TEXT_PREMIUM_MODEL=gpt-4o
AI_VISION_MODEL=gpt-4o
AI_IMAGE_MODEL=gpt-image-1
AI_AUDIO_MODEL=gpt-audio
AI_AUDIO_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe

X_CLIENT_ID=...                      # X OAuth (user filled)
X_CLIENT_SECRET=...                  # X OAuth (user filled)
X_CALLBACK_URL=http://localhost:5000/api/social/x/callback

DATABASE_URL=postgresql://cfuser:cfpass@localhost:5432/contentforge
```

**Future additions needed:**
```bash
# OpenRouter (when switching)
AI_BASE_URL=https://openrouter.ai/api/v1

# Threads/Meta OAuth
THREADS_APP_ID=...
THREADS_APP_SECRET=...

# Google OAuth (for login)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Production
SESSION_SECRET=random-string-here
PORT=5000
```

---

## 7. How to Start Working

### First time setup
```bash
# 1. Start database
make db
# or: docker compose up -d

# 2. Push schema (if changes made)
npm run db:push

# 3. Install deps
npm install

# 4. Fill .env with real values
# 5. Start dev server
PORT=3000 npm run dev
```

### Before any code changes
1. Read this document
2. Check `server/ai/config.ts` — understand the model registry
3. Check `server/routes.ts` around lines 1461-1630 for discovery logic
4. Check `shared/schema.ts` for DB structure

### After any code changes
1. Run `npm run check` (TypeScript check)
2. Reset DB and run `node scripts/test-all.js`
3. Verify server starts: `PORT=3000 npm run dev`

---

## 8. Known Issues & Gotchas

| Issue | Workaround |
|---|---|
| Port 5000 in use on macOS | Use `PORT=3000 npm run dev` |
| `reusePort` not supported on macOS | Already removed from `server/index.ts` |
| Discovery refresh takes 60-90s | Already parallelized with timeouts. UI should show loading state. |
| Seed data uses `new Date()` | Creates fresh timestamps on every seed. Fine for dev. |
| No `getIdea()` existed | Added in this phase. May be missing for other entities. |
| Brand memory was broken | Fixed. But `PUT /api/profile/memory` only updates fields explicitly passed. |

---

## 9. Suggestions for Next Agent

### Technical
1. **Break up `server/routes.ts`** — it's 2500+ lines. Split into `server/routes/auth.ts`, `server/routes/posts.ts`, `server/routes/discover.ts`, etc.
2. **Add proper error handling** — many routes catch-all with `res.status(500).json({ message: err.message })`. Should log stack traces.
3. **Add request validation** — Zod schemas exist but aren't used everywhere.
4. **Add rate limiting** on AI endpoints before any public exposure.
5. **Use `p-limit` for discovery** — already installed, use it to limit concurrent RSS fetches.

### Product
1. **Phase 1 is the only thing that matters right now.** Everything else is nice-to-have. Without posting, there is no revenue.
2. **Test the X OAuth flow early** — X Developer Portal can be flaky. Verify tokens work before building the rest.
3. **The scheduler must be robust** — if it fails silently, Kishore will miss posting days. Add retry logic and error notifications.
4. **Morning Briefing will be the killer feature** — 5 min daily ritual. Make it fast (<3s load) and keyboard-navigable.

### Cost Optimization
1. **Stick with gpt-4o-mini** for as long as possible. It's $0.15/$0.60 per 1M tokens — incredibly cheap.
2. **Cache discovery results** — don't re-fetch RSS on every refresh. Store last fetch time per source.
3. **Batch AI calls** — Morning Briefing can fetch 15 drafts in fewer calls by batching.

---

## 10. Contact & Context

- **Owner:** Kishore Kumar Behera
- **Niche:** DevOps · Platform Engineering · SRE · Kubernetes · Multi-Cloud · AI/Data
- **Current platforms target:** X (primary) → Threads → LinkedIn
- **Revenue goal:** X Revenue Share (5M impressions / 90 days)
- **Time constraint:** Full-time job — app must enable 5-min daily posting ritual
- **Motivation:** Second income stream + consulting leads

---

## 11. Immediate Next Steps for Next Agent

1. ✅ Read this document
2. ✅ Verify `npm run dev` starts cleanly with filled `.env`
3. ✅ Run `node scripts/test-all.js` — should pass 38/38
4. 🔨 **Start Phase 1.1:** Install `twitter-api-v2`, create `server/social/x.ts`
5. 🔨 **Build X OAuth flow:** `/api/social/x/start` + `/api/social/x/callback`
6. 🔨 **Build publish endpoint:** `/api/posts/:id/publish`
7. 🔨 **Install `node-cron`, build scheduler**
8. 🔨 **Wire UI buttons** for "Post Now" and "Schedule"
9. 🧪 **Test end-to-end:** Generate → Post Now → See tweet on x.com
10. 🚀 **Deploy** to Railway/Fly.io (need production callback URLs)

---

*End of handoff document. Good luck, next agent!*
