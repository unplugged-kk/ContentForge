---
title: ContentForge Project State
author: Kishore
date: 2026-11-28
id: l-142c6635
scope: repo
status: active
touches:
  - server/routes.ts
  - shared/schema.ts
  - server/auth.ts
  - server/seed.ts
  - client/src/App.tsx
  - client/src/components/app-sidebar.tsx
  - "server/ai/chat.ts#aiCall"
---

## Decided
ContentForge is a personal content generation + publishing platform running on autopilot (3-4 posts/day).

**Live as of 2026-05-04**: First autopilot tweet posted to @devopsbyte. X OAuth1 keys are configured and working. Stack: React 18 + TypeScript + Tailwind + shadcn/ui (frontend), Express.js 5 + Drizzle ORM + PostgreSQL 16 (backend), OpenAI (AI).

**What works**: Content generation (3 variants), AI images (DALL·E 3), Content Calendar, Ideas Bank, Templates, Hook Generator, Carousel Builder, Chat→Post, Articles (TipTap), Discover (HN/Reddit/RSS), Context Vault, References Library, Style Profiles, Analytics (manual entry), Brand Memory, Connected Accounts UI.

**What's missing / not wired**:
- Actual X/Threads/LinkedIn posting (tokens stored but no API calls)
- OAuth for social platforms (X OAuth, Threads OAuth)
- Scheduled post auto-publishing (no cron worker - scheduledAt exists in DB but nothing fires it)
- Multi-user isolation (no userId on most tables - single user app for now)
- Real analytics import from platform APIs
- Rate limiting on AI endpoints (cost risk)

**AI setup**: Currently hardwired to OpenAI via Replit env vars `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL`. Model is `gpt-4o-mini`. The `aiCall()` function in `server/routes.ts:79` is the central AI call point. Multi-provider abstraction layer is needed.

**Key files**:
- `server/routes.ts` — all API routes (~2500 lines), `aiCall()` at line 79, section headers with `// ──`
…

_From Claude Code's memory of this repo, last updated May 4._
