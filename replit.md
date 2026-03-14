# ContentForge - Personal Content Creation & Publishing Tool

## Overview
ContentForge is a full-stack web application for creating, managing, and scheduling social media content about Data & AI topics. It features authentication, AI-powered content generation, AI image generation, a content calendar with smart scheduling, ideas bank, template library, analytics dashboard, and a personalized brand memory profile.

## Tech Stack
- **Frontend**: React + TypeScript + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js (Node.js)
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: OpenAI via Replit AI Integrations (gpt-4o-mini + dall-e-3 for images)
- **Auth**: express-session + connect-pg-simple (custom session auth with scrypt password hashing)
- **Routing**: wouter (frontend), Express (backend)
- **State Management**: TanStack React Query

## Project Structure
```
client/src/
  App.tsx           - Main app; checks auth and shows login or app shell
  pages/
    auth.tsx        - Login/Registration page (tabbed)
    generate.tsx    - AI content generation page
    imagegen.tsx    - AI image generation page (DALL-E 3)
    calendar.tsx    - Content calendar view with smart scheduling
    ideas.tsx       - Ideas bank
    templates.tsx   - Template library
    analytics.tsx   - Analytics dashboard
    settings.tsx    - Settings (accounts, AI, pillars, brand profile)
  components/
    app-sidebar.tsx - Navigation sidebar with user info + logout
    theme-provider.tsx - Dark/light theme
    theme-toggle.tsx   - Theme toggle button
    ui/             - shadcn/ui components
  lib/
    constants.ts    - Content pillars, post types, tones
    queryClient.ts  - TanStack Query setup

server/
  index.ts          - Express server entry + session middleware
  auth.ts           - Password hashing (scrypt), user helpers, requireAuth middleware
  routes.ts         - All API routes
  storage.ts        - Database storage interface
  db.ts             - Database connection (exports pool + db)
  seed.ts           - Seed data

shared/
  schema.ts         - Drizzle schema (users, userProfile, generatedImages, posts, tweets, ideas, templates, analytics, ai_usage_log, ...)
```

## Key Features
1. **Authentication** - Register/Login with email+password (session-based, custom scrypt hashing)
2. **Content Generation** - AI generates 3 variations based on pillar, tone, post type, platform
3. **AI Image Generation** - DALL-E 3 generates on-brand images with style/aspect ratio control
4. **Content Calendar** - Month view with posts color-coded by status/pillar + Smart Scheduling best-times panel
5. **Ideas Bank** - Capture ideas, AI-expand into drafts
6. **Template Library** - Pre-built templates with AI fill
7. **Analytics** - Charts for posts by pillar, platform, engagement metrics
8. **Brand Memory Profile** - Second brain for personalizing AI (brand voice, style notes, audience, goals)
9. **Settings** - Connected accounts (X/Threads), AI provider, content pillars, brand profile

## API Endpoints
### Auth
- POST /api/auth/register - Create account + auto-login
- POST /api/auth/login - Login
- POST /api/auth/logout - Logout
- GET /api/auth/me - Current user
- PUT /api/auth/me - Update profile

### Profile / Memory
- GET/PUT /api/profile/memory - Brand memory profile
- GET/PUT /api/profile/branding - Branding JSON
- POST /api/profile/memory/ai-learn - AI analyzes posts to learn brand voice

### Images
- GET /api/images - List generated images
- POST /api/images/generate - Generate image with DALL-E 3
- POST /api/images/:id/favorite - Toggle favorite
- DELETE /api/images/:id - Delete image
- POST /api/images/generate-for-post - AI suggests image prompt from post content

### Scheduling
- POST /api/schedule/suggest - AI suggests optimal posting times
- GET /api/schedule/best-times - Static best times by platform

### Content
- GET/POST /api/posts - CRUD for posts
- PATCH /api/posts/:id/status - Update post status
- GET/POST /api/ideas - CRUD for ideas
- POST /api/ideas/:id/expand - AI expand idea
- GET /api/templates - List templates
- POST /api/templates/fill - AI fill template
- POST /api/generate - Generate content variations
- GET /api/analytics/summary - Analytics data
- GET /api/pillars - List content pillars

## Content Pillars
1. Data Infrastructure & MLOps
2. AI for DevOps / AIOps
3. Cloud-Native Data Platforms
4. Infrastructure as Code for Data
5. Career & Leadership
6. Hot Takes & Trends

## Running
`npm run dev` starts both backend (Express) and frontend (Vite) on port 5000.

## Database
PostgreSQL with Drizzle ORM. Schema push: `npm run db:push`

## Auth Flow
- App.tsx queries GET /api/auth/me on load
- If 401 → shows AuthPage (login/register tabs)
- If authenticated → shows full app with sidebar
- Sidebar footer shows user name, title, and logout button
