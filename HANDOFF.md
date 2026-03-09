# ContentForge — Comprehensive Handoff Document

> Last updated: March 9, 2026

---

## 1. Project Overview

### App Name & Purpose
**ContentForge** is a full-stack web application for creating, managing, and scheduling social media content about Data & AI topics. The target user is **Kishore Kumar Behera**, an Infrastructure Engineering Lead building a personal brand on X (Twitter) and Threads.

### Core Functionality
- **AI-Powered Content Generation** — Generate tweet/thread variations using OpenAI (gpt-4o-mini) with customizable pillar, tone, post type, and platform
- **Content Calendar** — Month-view calendar with posts color-coded by status and pillar
- **Ideas Bank** — Capture ideas quickly, AI-expand into full drafts
- **Template Library** — Pre-built content templates with AI fill
- **Analytics Dashboard** — Charts for posts by pillar, platform, engagement metrics
- **Universal Source Ingestion** — Ingest URLs, text, or screenshots; AI extracts content goldmines and style fingerprints
- **Idea Discovery** — Auto-discover trending content ideas from Hacker News, Reddit, ArXiv, and RSS feeds
- **X Articles Editor** — Long-form article editor with TipTap, AI outline generation, section expansion, and article-to-thread conversion
- **Style Profiles** — Extract and reuse writing styles from reference content
- **Viral Optimization** — AI scores content across 8 viral dimensions and suggests improvements
- **Connected Accounts** — Link X and Threads accounts via API tokens for future publishing

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Tailwind CSS 3 + shadcn/ui (Radix) |
| Backend | Express.js 5 (Node.js) |
| Database | PostgreSQL + Drizzle ORM 0.39 |
| AI | OpenAI gpt-4o-mini via Replit AI Integrations |
| Routing (FE) | wouter 3.3 |
| State Mgmt | TanStack React Query v5 |
| Rich Text Editor | TipTap 3 |
| Charts | Recharts 2 |
| RSS Parsing | rss-parser 3 |
| Web Scraping | cheerio 1.2 |
| File Uploads | multer 2 |
| Build | Vite 7 + esbuild |

### Current Status
**Working features (all verified via e2e tests):**
- Content generation with 3 AI variations
- Content calendar with month navigation and post display
- Ideas bank with CRUD and AI expansion
- Template library with AI fill
- Analytics dashboard with charts
- Universal source ingestion (URL, text, screenshot)
- Idea discovery from HN, Reddit, ArXiv, RSS
- Articles editor with AI outline/section expansion
- References library with style analysis
- Style profiles with AI-powered content generation
- Viral scoring and optimization
- Connected accounts (X/Threads) with Connect button, dialog, test, disconnect
- Settings page with 3 tabs (Connected Accounts, AI Provider, Content Pillars)
- Dark/light theme toggle
- Quick capture floating button
- Sidebar navigation across all 10 pages

**Not yet implemented:**
- Actual publishing to X/Threads (tokens stored but no posting API calls)
- OAuth flow (uses manual token entry instead)
- Scheduled post auto-publishing (cron/worker)
- Real engagement data import from X/Threads APIs
- Multi-user/authentication (single-user app currently)

---

## 2. Architecture

### High-Level Architecture
Monolithic client-server application. A single Express.js server serves both the REST API and the Vite-built React frontend on port 5000.

```
┌──────────────────────────────────────────────┐
│                   Browser                     │
│  React + wouter + TanStack Query + shadcn/ui │
└──────────────┬───────────────────────────────┘
               │ HTTP (fetch)
┌──────────────▼───────────────────────────────┐
│           Express.js Server (:5000)           │
│  ┌─────────────┐  ┌──────────────────────┐   │
│  │  API Routes  │  │  Vite Dev / Static   │   │
│  │ /api/*       │  │  (serves React app)  │   │
│  └──────┬──────┘  └──────────────────────┘   │
│         │                                     │
│  ┌──────▼──────┐  ┌──────────────────────┐   │
│  │  Storage    │  │  OpenAI Client       │   │
│  │  Interface  │  │  (gpt-4o-mini)       │   │
│  └──────┬──────┘  └──────────────────────┘   │
└─────────┼────────────────────────────────────┘
          │ SQL (Drizzle ORM)
┌─────────▼────────────────────────────────────┐
│              PostgreSQL Database              │
└──────────────────────────────────────────────┘
```

### Folder/File Structure
```
/
├── client/
│   ├── index.html                    # HTML entry point
│   ├── public/favicon.png
│   └── src/
│       ├── main.tsx                  # React DOM entry
│       ├── App.tsx                   # Root component, routing, sidebar layout
│       ├── index.css                 # Global styles + Tailwind + CSS variables
│       ├── components/
│       │   ├── app-sidebar.tsx       # Navigation sidebar (10 pages)
│       │   ├── quick-capture.tsx     # Floating quick-capture button
│       │   ├── theme-provider.tsx    # Dark/light theme context
│       │   ├── theme-toggle.tsx      # Theme toggle button
│       │   ├── tiptap-editor.tsx     # Rich text editor for Articles
│       │   └── ui/                   # 47 shadcn/ui components
│       ├── hooks/
│       │   ├── use-mobile.tsx        # Mobile breakpoint hook
│       │   └── use-toast.ts          # Toast notification hook
│       ├── lib/
│       │   ├── constants.ts          # Content pillars, post types, tones, platforms
│       │   ├── queryClient.ts        # TanStack Query config + apiRequest helper
│       │   └── utils.ts              # cn() utility
│       └── pages/
│           ├── generate.tsx          # AI content generation
│           ├── calendar.tsx          # Content calendar (month view)
│           ├── ideas.tsx             # Ideas bank
│           ├── templates.tsx         # Template library
│           ├── analytics.tsx         # Analytics dashboard
│           ├── settings.tsx          # Settings (accounts, AI, pillars)
│           ├── articles.tsx          # X Articles editor
│           ├── references.tsx        # References library
│           ├── discover.tsx          # Idea discovery
│           ├── ingest.tsx            # Universal source ingestion
│           └── not-found.tsx         # 404 page
├── server/
│   ├── index.ts                      # Express server entry, middleware, startup
│   ├── routes.ts                     # ALL API routes (~1867 lines)
│   ├── storage.ts                    # IStorage interface + DatabaseStorage class
│   ├── db.ts                         # PostgreSQL connection (Drizzle + pg Pool)
│   ├── seed.ts                       # Seed data (pillars, templates, ideas, posts)
│   ├── static.ts                     # Production static file serving
│   └── vite.ts                       # Vite dev server integration
├── shared/
│   └── schema.ts                     # Drizzle schema + Zod insert schemas + types
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vite.config.ts
├── drizzle.config.ts
├── postcss.config.js
└── script/
    └── build.ts                      # Production build script
```

### Data Flow
1. **Frontend** uses TanStack Query with a default `queryFn` that fetches from the API using the `queryKey` as the URL
2. **Mutations** use `apiRequest(method, url, body)` which calls `fetch()` with JSON body and `credentials: "include"`
3. **Backend** validates request bodies with Zod schemas, delegates to the `storage` interface
4. **Storage** uses Drizzle ORM to execute SQL against PostgreSQL
5. **AI calls** go through the `aiCall()` helper which calls `openai.chat.completions.create()` and logs usage

### State Management
- **Server state**: TanStack React Query v5 with `staleTime: Infinity` and manual invalidation after mutations
- **Local UI state**: React `useState` for form inputs, dialogs, tabs
- **Theme**: React context provider with localStorage persistence
- **No global client state store** (no Redux/Zustand)

---

## 3. Database & Data Models

### Database Type
PostgreSQL (Replit-managed), connected via `DATABASE_URL` environment variable using the `pg` Pool driver + Drizzle ORM.

### Schema (All Tables)

#### `pillars`
Content categories/themes for organizing posts.
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| name | varchar(100) | NOT NULL |
| description | text | |
| color | varchar(7) | HEX color code |

#### `posts`
Central entity for social media content.
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| pillarId | integer | FK → pillars.id |
| postType | varchar(20) | NOT NULL (tweet/thread/hot_take/poll/quote_template) |
| tone | varchar(20) | |
| targetPlatform | varchar(20) | Default: "both" |
| status | varchar(20) | Default: "draft" (draft/ready/scheduled/posted/failed) |
| scheduledAt | timestamp | |
| postedAt | timestamp | |
| aiModel | varchar(100) | |
| createdAt | timestamp | Default: now() |
| updatedAt | timestamp | Default: now() |

#### `tweets`
Individual content fragments within a post (thread items).
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| postId | integer | NOT NULL, FK → posts.id |
| position | integer | NOT NULL |
| content | text | NOT NULL |
| charCount | integer | |

#### `ideas`
Quick-captured content ideas.
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| title | varchar(280) | NOT NULL |
| notes | text | |
| pillarId | integer | FK → pillars.id |
| isExpanded | boolean | Default: false |
| createdAt | timestamp | Default: now() |

#### `templates`
Reusable content patterns.
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| name | varchar(200) | NOT NULL |
| pattern | text | NOT NULL |
| postType | varchar(20) | |
| pillarId | integer | FK → pillars.id |

#### `analytics`
Engagement metrics for posts.
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| postId | integer | FK → posts.id |
| platform | varchar(20) | |
| impressions | integer | Default: 0 |
| likes | integer | Default: 0 |
| retweets | integer | Default: 0 |
| replies | integer | Default: 0 |
| quotes | integer | Default: 0 |
| bookmarks | integer | Default: 0 |
| views | integer | Default: 0 |
| source | varchar(20) | Default: "manual" |
| recordedAt | timestamp | Default: now() |

#### `ai_usage_log`
AI API consumption tracking.
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| model | varchar(100) | NOT NULL |
| inputTokens | integer | |
| outputTokens | integer | |
| totalTokens | integer | |
| latencyMs | integer | |
| feature | varchar(50) | |
| createdAt | timestamp | Default: now() |

#### `articles`
Long-form content (X Articles).
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| postId | integer | FK → posts.id |
| title | varchar(200) | NOT NULL |
| subtitle | varchar(300) | |
| coverImageUrl | text | |
| contentJson | jsonb | Default: {} (TipTap doc) |
| contentHtml | text | |
| contentMarkdown | text | |
| wordCount | integer | Default: 0 |
| estimatedReadMinutes | integer | Default: 0 |
| seoDescription | varchar(200) | |
| articleTemplate | varchar(50) | |
| status | varchar(20) | Default: "draft" |
| pillarId | integer | FK → pillars.id |
| createdAt | timestamp | Default: now() |
| updatedAt | timestamp | Default: now() |

#### `references`
Ingested source material.
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| sourceUrl | text | |
| rawContent | text | |
| rawContentHtml | text | |
| notes | text | |
| sourceType | varchar(30) | |
| sourcePlatform | varchar(30) | |
| screenshotUrls | text[] | |
| tags | text[] | |
| analysisJson | jsonb | AI content analysis |
| styleAnalysisJson | jsonb | AI style fingerprint |
| sourceEngagementMetrics | jsonb | |
| batchSynthesisJson | jsonb | |
| pillarId | integer | |
| isBookmarked | boolean | Default: false |
| isStyleSaved | boolean | Default: false |
| batchId | varchar(50) | |
| createdAt | timestamp | Default: now() |

#### `reference_content`
Join table: references → posts/articles.
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| referenceId | integer | FK → references.id |
| postId | integer | FK → posts.id |
| articleId | integer | FK → articles.id |
| contentType | varchar(20) | |
| createdAt | timestamp | Default: now() |

#### `style_profiles`
Extracted writing styles for reuse.
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| name | varchar(200) | NOT NULL |
| sourceReferenceId | integer | FK → references.id |
| styleJson | jsonb | |
| stylePromptSnippet | text | NOT NULL |
| usageCount | integer | Default: 0 |
| isFavorite | boolean | Default: false |
| createdAt | timestamp | Default: now() |

#### `discovered_ideas`
AI-generated content suggestions from external sources.
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| rank | integer | |
| title | varchar(500) | NOT NULL |
| description | text | |
| summary | text | |
| sourceInspiration | text | |
| sourceUrl | text | |
| sourceType | varchar(30) | |
| category | varchar(50) | |
| contentTypeSuggestion | varchar(30) | |
| contentAngles | text[] | |
| pillarId | integer | |
| viralScore | decimal(3,1) | |
| viralReasoning | text | |
| valueProposition | text | |
| uniqueAngle | text | |
| timeliness | varchar(20) | |
| targetAudience | text | |
| suggestedHook | text | |
| hashtagSuggestions | text[] | |
| isBookmarked | boolean | Default: false |
| status | varchar(20) | Default: "new" |
| batchId | varchar(50) | |
| discoveredAt | timestamp | Default: now() |

#### `discovery_settings`
User preferences for discovery engine (single-row table).
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| autoRefreshFrequency | varchar(20) | Default: "daily" |
| customKeywords | text[] | Default: {} |
| monitoredXAccounts | text[] | Default: {} |
| enabledSources | jsonb | {hackernews, reddit, rss, github} |
| updatedAt | timestamp | Default: now() |

#### `viral_scores`
AI viral analysis scores.
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| postId | integer | FK → posts.id |
| articleId | integer | FK → articles.id |
| overallScore | decimal(3,1) | |
| hookPower | decimal(3,1) | |
| valueDensity | decimal(3,1) | |
| readability | decimal(3,1) | |
| engagementPotential | decimal(3,1) | |
| shareability | decimal(3,1) | |
| authenticity | decimal(3,1) | |
| platformOptimization | decimal(3,1) | |
| improvements | text[] | |
| strengths | text[] | |
| platform | varchar(20) | |
| createdAt | timestamp | Default: now() |

#### `monitored_accounts`
X accounts to monitor for discovery.
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| platform | varchar(20) | |
| username | varchar(100) | |
| displayName | varchar(200) | |
| category | varchar(50) | |
| isActive | boolean | Default: true |
| createdAt | timestamp | Default: now() |

#### `rss_sources`
RSS feeds for idea discovery.
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| name | varchar(200) | |
| feedUrl | text | |
| category | varchar(50) | |
| isActive | boolean | Default: true |
| lastFetchedAt | timestamp | |
| createdAt | timestamp | Default: now() |

#### `connected_accounts`
Linked social media accounts.
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| platform | varchar(30) | |
| username | varchar(100) | |
| displayName | varchar(200) | |
| accessToken | text | Stored server-side, masked in API responses |
| refreshToken | text | |
| tokenExpiresAt | timestamp | |
| isActive | boolean | Default: true |
| profileData | jsonb | |
| connectedAt | timestamp | Default: now() |
| lastUsedAt | timestamp | |

#### `conversations` & `messages`
Chat history tables (for Replit AI integrations).
- **conversations**: id, title, createdAt
- **messages**: id, conversationId, role, content, createdAt

### Migrations
Schema is managed via `drizzle-kit push` (no versioned migration files). Run `npm run db:push` to sync schema.

### Seed Data
`server/seed.ts` seeds on first run:
- 6 content pillars
- 7 templates
- 5 ideas
- 4 posts with tweets (various statuses: posted, ready, scheduled, draft)
- 2 analytics records
- 6 RSS sources (TLDR AI, TLDR DevOps, HN Best, Pragmatic Engineer, ByteByteGo, Last Week in AI)
- 5 monitored X accounts (kelseyhightower, chiphuyen, GergelyOrosz, AndrewYNg, karpathy)

---

## 4. API & Routes

All routes defined in `server/routes.ts`. No authentication/authorization.

### Pillars
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/pillars` | List all content pillars |

### Posts
| Method | Path | Request Body | Description |
|--------|------|-------------|-------------|
| GET | `/api/posts` | — | List all posts with tweets |
| GET | `/api/posts/:id` | — | Get single post with tweets |
| POST | `/api/posts` | `{pillarId, postType, tone, targetPlatform, status, aiModel, scheduledAt, tweets[]}` | Create post |
| PUT | `/api/posts/:id` | `Partial<Post>` | Update post |
| PATCH | `/api/posts/:id/status` | `{status, scheduledAt?}` | Update post status |
| DELETE | `/api/posts/:id` | — | Delete post |

### Ideas
| Method | Path | Request Body | Description |
|--------|------|-------------|-------------|
| GET | `/api/ideas` | — | List all ideas |
| POST | `/api/ideas` | `{title, notes?, pillarId?}` | Create idea |
| DELETE | `/api/ideas/:id` | — | Delete idea |
| POST | `/api/ideas/:id/expand` | — | AI-expand idea into draft post |

### Templates
| Method | Path | Request Body | Description |
|--------|------|-------------|-------------|
| GET | `/api/templates` | — | List all templates |
| POST | `/api/templates/fill` | `{templateId}` | AI-fill a template |

### Content Generation
| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| POST | `/api/generate` | `{pillar?, postType, tone, platform, context?}` | `{variations: [{tweets: [{content, charCount}]}], model}` |

### Analytics & Usage
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/analytics/summary` | Full analytics dashboard data |
| POST | `/api/analytics` | Create analytics record |
| GET | `/api/usage` | List AI usage logs |

### Articles
| Method | Path | Request Body | Description |
|--------|------|-------------|-------------|
| GET | `/api/articles` | — | List articles |
| GET | `/api/articles/:id` | — | Get single article |
| POST | `/api/articles` | `{title, subtitle?, contentJson?, status, pillarId?, ...}` | Create article |
| PUT | `/api/articles/:id` | `Partial<Article>` | Update article |
| DELETE | `/api/articles/:id` | — | Delete article |
| POST | `/api/articles/upload-image` | multipart (field: "image") | Upload cover image |
| POST | `/api/articles/:id/generate-outline` | `{topic?}` | AI generate article outline |
| POST | `/api/articles/:id/expand-section` | `{heading, description?, keyPoints?}` | AI expand one section |
| POST | `/api/articles/:id/generate-full` | `{outline}` | AI generate full article |
| POST | `/api/articles/:id/improve` | `{text, goal?}` | AI improve text |
| POST | `/api/articles/:id/generate-meta` | — | AI generate title/subtitle/SEO |
| POST | `/api/articles/:id/to-thread` | — | Convert article to thread |
| POST | `/api/articles/:id/to-tweet` | — | Convert article to tweet |

### Ingestion & References
| Method | Path | Request Body | Description |
|--------|------|-------------|-------------|
| GET | `/api/references` | — | List all references |
| GET | `/api/references/:id` | — | Get single reference |
| POST | `/api/ingest` | `{url?, rawContent?, sourceType?}` | Ingest URL or text |
| POST | `/api/ingest/batch` | `{sources[]}` | Batch ingest |
| POST | `/api/ingest/screenshot` | multipart (field: "screenshots", max 10) | Ingest screenshots via OCR |
| POST | `/api/references/analyze` | `{referenceId}` | AI analyze reference |
| POST | `/api/references/:id/generate` | `{contentType, tone?, styleProfileId?}` | Generate content from reference |
| POST | `/api/content-actions/:action` | `{referenceId, contentType, topic?}` | Content action (my-take, counter, etc.) |
| DELETE | `/api/references/:id` | — | Delete reference |
| POST | `/api/references/:id/bookmark` | — | Toggle bookmark |
| POST | `/api/references/:id/note` | `{notes}` | Update notes |
| GET | `/api/references/batch/:batchId` | — | Get batch references |
| GET | `/api/bookmarklet` | — | Get bookmarklet JS code |

### Style Profiles
| Method | Path | Request Body | Description |
|--------|------|-------------|-------------|
| GET | `/api/styles` | — | List style profiles |
| POST | `/api/styles` | `{name, sourceReferenceId?, styleJson?, stylePromptSnippet}` | Create style |
| DELETE | `/api/styles/:id` | — | Delete style |
| POST | `/api/styles/:id/apply` | `{topic?, contentType?, pillarId?}` | Generate content in this style |

### Connected Accounts
| Method | Path | Request Body | Description |
|--------|------|-------------|-------------|
| GET | `/api/accounts` | — | List accounts (tokens masked) |
| POST | `/api/accounts/connect` | `{platform, username?, accessToken}` | Connect/upsert account |
| DELETE | `/api/accounts/:id` | — | Disconnect account |
| POST | `/api/accounts/:id/test` | — | Test connection (X: verifies via Twitter API v2 /users/me) |

### Discovery
| Method | Path | Request Body | Description |
|--------|------|-------------|-------------|
| GET | `/api/discover/ideas` | `?batchId=` | List discovered ideas |
| POST | `/api/discover/refresh` | — | Scrape HN/Reddit/ArXiv/RSS and AI-rank ideas |
| PATCH | `/api/discover/ideas/:id/status` | `{status}` | Update idea status |
| POST | `/api/discover/ideas/:id/to-draft` | — | Convert to content idea |
| POST | `/api/discover/ideas/:id/expand` | — | AI expand to post thread |
| POST | `/api/discover/ideas/:id/bookmark` | — | Toggle bookmark |
| GET | `/api/discover/settings` | — | Get discovery settings |
| PUT | `/api/discover/settings` | `Partial<DiscoverySettings>` | Update settings |
| GET | `/api/discover/sources` | — | List accounts + RSS feeds |
| POST | `/api/discover/sources/rss` | `{name, feedUrl, category?}` | Add RSS source |
| POST | `/api/discover/sources/account` | `{platform, username, displayName?, category?}` | Add monitored account |
| DELETE | `/api/discover/sources/:id?type=rss|account` | — | Delete source |

### Viral Optimization
| Method | Path | Request Body | Description |
|--------|------|-------------|-------------|
| POST | `/api/viral/score` | `{content, postId?, articleId?, platform?}` | AI viral score (8 dimensions) |
| POST | `/api/viral/optimize` | `{content, improvements[], platform?}` | AI optimize content |
| POST | `/api/viral/apply-fix` | `{content, improvement}` | Apply single improvement |
| GET | `/api/viral/scores/:postId` | — | Get viral scores for post |

### Third-Party API Integrations
| Service | Usage | Keys Needed |
|---------|-------|-------------|
| OpenAI (via Replit) | Content generation, analysis, scoring | `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL` (auto-set by Replit) |
| X/Twitter API v2 | Token verification (`/users/me`) | User-provided Bearer Token (stored in `connected_accounts`) |
| Hacker News API | Idea discovery (public, no key) | None |
| ArXiv API | Idea discovery (public, no key) | None |
| RSS feeds | Idea discovery (public) | None |

---

## 5. Environment & Configuration

### Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (auto-set by Replit) |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Yes | OpenAI API key (auto-set by Replit AI Integrations) |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Yes | OpenAI base URL (auto-set by Replit AI Integrations) |
| `SESSION_SECRET` | Yes | Express session secret |
| `PORT` | No | Server port (default: 5000) |
| `NODE_ENV` | No | "development" or "production" |

### External Dependencies
- **PostgreSQL** — Replit-managed, accessed via `DATABASE_URL`
- **OpenAI API** — via Replit AI Integrations (no manual key setup needed on Replit)
- **No message queues, Redis, or external storage** — all in-process

### Package Dependencies
See `package.json` for full list. Key dependencies:
- `express@5`, `drizzle-orm@0.39`, `pg@8`, `openai@6`
- `react@18`, `wouter@3`, `@tanstack/react-query@5`
- `@tiptap/react@3`, `recharts@2`, `rss-parser@3`, `cheerio@1.2`
- `tailwindcss@3`, `lucide-react`, `react-icons`
- `zod@3`, `drizzle-zod@0.7`, `react-hook-form@7`
- `multer@2` (file uploads), `date-fns@3`

---

## 6. Current Issues & TODOs

### Known Limitations (Not Bugs)
1. **No actual publishing to X/Threads** — Tokens are stored and verified but no `POST /tweets` or Threads publish API calls exist. The "Connect" flow only stores credentials.
2. **No scheduled post worker** — Posts can be marked "scheduled" with a date, but nothing auto-publishes them. Needs a cron/worker process.
3. **No real analytics import** — Engagement metrics are manual entry only. No X/Threads API polling.
4. **Single-user** — No authentication. Anyone with the URL can access all data.
5. **Discovery scraping is basic** — Fetches HN/Reddit/ArXiv HTML and RSS feeds, then sends to AI. No rate limiting or caching.

### Workarounds in Place
- **Token verification**: X Connect verifies the Bearer Token against Twitter API v2 `/users/me`. If verification fails (network issues, wrong token), the account is still saved with a warning message.
- **JSON parsing**: The `safeJsonParse()` function handles AI responses that sometimes include markdown code fences around JSON.
- **Pillar ID handling**: Zod schemas accept both `number` and `string` (auto-transforms) for pillarId to handle form submissions that send strings.

### Potential Improvements
- Add WebSocket for real-time AI generation streaming
- Add proper OAuth 2.0 flow for X and Threads
- Add a background job system (BullMQ, pg-boss, or similar) for scheduled publishing
- Add rate limiting for AI calls
- Add user authentication (Replit Auth or custom)
- Add export/import for content calendar

---

## 7. Build & Run Instructions

### Install Dependencies
```bash
npm install
```

### Push Database Schema
```bash
npm run db:push
```

### Run Locally (Development)
```bash
npm run dev
```
This starts Express + Vite on port 5000. Hot-reloads frontend changes automatically.

### Build for Production
```bash
npm run build
```
Output goes to `dist/`. Builds the React frontend with Vite and bundles the server with esbuild.

### Run in Production
```bash
npm run start
```
Serves from `dist/` with `NODE_ENV=production`.

### Type Check
```bash
npm run check
```

### No Test Suite
There are no unit or integration test files. Testing has been done via manual e2e testing with Playwright (through Replit's testing infrastructure).

---

## 8. Key Code Snippets

### AI Call Helper (`server/routes.ts:68-96`)
Central function for all OpenAI interactions:
```typescript
async function aiCall(messages: any[], jsonMode = false) {
  const msgs = jsonMode
    ? messages.map((m: any, i: number) =>
        i === 0 && m.role === "system"
          ? { ...m, content: m.content + "\nRespond in JSON format." }
          : m
      )
    : messages;
  const opts: any = { model: "gpt-4o-mini", messages: msgs, max_completion_tokens: 8192 };
  if (jsonMode) opts.response_format = { type: "json_object" };
  const startTime = Date.now();
  const response = await openai.chat.completions.create(opts);
  return {
    content: response.choices[0]?.message?.content || "",
    usage: response.usage,
    latency: Date.now() - startTime,
  };
}

async function logAiUsage(usage: any, latency: number, feature: string) {
  await storage.createAiUsageLog({
    model: "gpt-4o-mini",
    inputTokens: usage?.prompt_tokens || 0,
    outputTokens: usage?.completion_tokens || 0,
    totalTokens: usage?.total_tokens || 0,
    latencyMs: latency,
    feature,
  });
}
```

### System Prompt (`server/routes.ts:33-54`)
Defines Kishore's persona and 10 viral content principles:
```typescript
const SYSTEM_PROMPT = `You are a ghostwriter for Kishore Kumar Behera, a senior Infrastructure Engineering Lead with 11+ years in DevOps, Cloud (AWS/Azure/GCP), Kubernetes, and Platform Engineering. He is building a personal brand on X (Twitter) and Threads at the intersection of Data & AI and DevOps/Infrastructure.

VIRAL CONTENT PRINCIPLES — Apply these to every piece of content:
1. LEAD WITH VALUE: The first 2 lines must deliver or promise specific, actionable value.
2. SPECIFICITY WINS: Use specific metrics, tool names, and real scenarios.
3. CONTRARIAN + CREDIBLE: Challenge conventional wisdom WITH evidence.
4. TEACH ONE THING: Every piece should leave the reader knowing ONE new thing.
5. STORY > ADVICE: Lead with real scenarios, not generic advice.
6. USE THE READER'S LANGUAGE: Write how engineers talk in Slack, not documentation.
7. NUMBERS ARE HOOKS: "5 things", "40% reduction", "$500K saved" — numbers stop the scroll.
8. END WITH ENGAGEMENT: End with a question or bold prediction that invites debate.
9. PATTERN INTERRUPT: Start with something unexpected.
10. THE SAVE TEST: Would someone bookmark this to reference later?

Writing style:
- Write in first person as Kishore
- Be technically credible — use specific tools, metrics, and real-world scenarios
- Short, punchy sentences for tweets. No fluff.
- For threads, start with a killer hook
- For X: Stay within 280 characters per individual tweet
- For Threads: Stay within 500 characters per individual post
- Never use hashtags inside post body`;
```

### OpenAI Client Initialization (`server/routes.ts:15-18`)
```typescript
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
```

### TanStack Query Default Config (`client/src/lib/queryClient.ts`)
```typescript
export async function apiRequest(
  method: string, url: string, data?: unknown
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });
  await throwIfResNotOk(res);
  return res;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
  },
});
```

### Connected Account Token Masking (`server/routes.ts`)
Tokens are stored in full but API responses mask them:
```typescript
// GET /api/accounts
const accounts = await storage.getConnectedAccounts();
const masked = accounts.map(a => ({
  ...a,
  accessToken: a.accessToken ? "••••••" + a.accessToken.slice(-4) : null,
  refreshToken: undefined,
}));
res.json(masked);
```

### X Token Verification (`server/routes.ts`)
```typescript
// POST /api/accounts/connect — verifies X Bearer Token
if (platform === "x" && accessToken) {
  const verifyRes = await fetch("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (verifyRes.ok) {
    const userData = await verifyRes.json();
    // Save verified username and display name
  } else {
    // Save anyway with warning
  }
}
```

### Database Connection (`server/db.ts`)
```typescript
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

### Frontend Routing (`client/src/App.tsx`)
```typescript
function Router() {
  return (
    <Switch>
      <Route path="/" component={GeneratePage} />
      <Route path="/calendar" component={CalendarPage} />
      <Route path="/ideas" component={IdeasPage} />
      <Route path="/templates" component={TemplatesPage} />
      <Route path="/analytics" component={AnalyticsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/articles" component={ArticlesPage} />
      <Route path="/references" component={ReferencesPage} />
      <Route path="/discover" component={DiscoverPage} />
      <Route path="/ingest" component={IngestPage} />
      <Route component={NotFound} />
    </Switch>
  );
}
```

---

## Appendix: Content Constants (`client/src/lib/constants.ts`)

```typescript
export const CONTENT_PILLARS = [
  { id: 1, name: "Data Infrastructure & MLOps", color: "#3B82F6" },
  { id: 2, name: "AI for DevOps / AIOps", color: "#8B5CF6" },
  { id: 3, name: "Cloud-Native Data Platforms", color: "#06B6D4" },
  { id: 4, name: "Infrastructure as Code for Data", color: "#10B981" },
  { id: 5, name: "Career & Leadership", color: "#F59E0B" },
  { id: 6, name: "Hot Takes & Trends", color: "#EF4444" },
];

export const POST_TYPES = ["tweet", "thread", "hot_take", "poll", "quote_template"];
export const TONES = ["technical", "conversational", "provocative", "storytelling", "educational"];
export const PLATFORMS = ["x", "threads", "both"];
export const POST_STATUSES = ["draft", "ready", "scheduled", "posted", "failed"];
export const CHAR_LIMITS = { x: 280, threads: 500 };
```
