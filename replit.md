# ContentForge - Personal Content Creation & Publishing Tool

## Overview
ContentForge is a full-stack web application for creating, managing, and scheduling social media content about Data & AI topics. It features AI-powered content generation, a content calendar, ideas bank, template library, and analytics dashboard.

## Tech Stack
- **Frontend**: React + TypeScript + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js (Node.js)
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: OpenAI via Replit AI Integrations (gpt-4o-mini)
- **Routing**: wouter (frontend), Express (backend)
- **State Management**: TanStack React Query

## Project Structure
```
client/src/
  App.tsx           - Main app with sidebar layout
  pages/
    generate.tsx    - AI content generation page
    calendar.tsx    - Content calendar view
    ideas.tsx       - Ideas bank
    templates.tsx   - Template library
    analytics.tsx   - Analytics dashboard
    settings.tsx    - Settings page
  components/
    app-sidebar.tsx - Navigation sidebar
    theme-provider.tsx - Dark/light theme
    theme-toggle.tsx   - Theme toggle button
    ui/             - shadcn/ui components
  lib/
    constants.ts    - Content pillars, post types, tones
    queryClient.ts  - TanStack Query setup

server/
  index.ts          - Express server entry
  routes.ts         - All API routes
  storage.ts        - Database storage interface
  db.ts             - Database connection
  seed.ts           - Seed data

shared/
  schema.ts         - Drizzle schema (pillars, posts, tweets, ideas, templates, analytics, ai_usage_log)
```

## Key Features
1. **Content Generation** - AI generates 3 variations based on pillar, tone, post type, platform
2. **Content Calendar** - Month view with posts color-coded by status/pillar
3. **Ideas Bank** - Capture ideas, AI-expand into drafts
4. **Template Library** - Pre-built templates with AI fill
5. **Analytics** - Charts for posts by pillar, platform, engagement metrics
6. **Settings** - AI provider config, connected accounts, content pillars

## API Endpoints
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
