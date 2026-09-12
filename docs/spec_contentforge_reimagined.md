# Spec: ContentForge Reimagined (Social Growth Engine for SREs)

## Objective

ContentForge is a personal social media management and AI-generation tool designed specifically for Kishore (11+ year SRE / DevOps Infra Lead) to automate personal branding and audience growth on X (Twitter). The goal is to unlock a second income stream through **X Ads Revenue Sharing** with minimal daily effort (max 5 minutes/day).

To achieve X Ads Revenue Sharing eligibility (5M impressions/90 days + 500 followers) and maximize payouts, we are shifting the product focus from a simple post-broadcaster to a **Targeted Premium Engagement & Content Synthesis Engine**.

### Key Reimagined Features:
1. **Targeted Premium Engagement Hub**:
   - Track a curated list of DevOps/SRE/Cloud influencers.
   - Monitor their latest tweets in real-time (via X scraping/polling APIs).
   - Use AI to generate highly-insightful, context-aware comments within minutes of posting to capture visibility from their premium followers.
2. **Comment & Discussion Mining**:
   - Extract discussion threads and user replies from viral posts.
   - Synthesize these comments into new, unique, high-signal draft ideas (focusing on pain points, questions, and arguments raised by the community).
3. **War Story Composer (Bullet-to-Thread)**:
   - A simplified composer where Kishore writes quick bullet-point "war stories" (e.g., outages, cost savings, migration hurdles).
   - The AI uses SRE-tailored high-engagement templates to write structured threads.
4. **Daily Morning Briefing Dashboard**:
   - A single, keyboard-navigable page showing today's 3-post pack.
   - Review, edit (via a distraction-free Markdown editor), and approve/schedule in under 2 minutes.
5. **Installable PWA**:
   - Fully optimized mobile PWA so Kishore can review and schedule posts during his morning commute.
6. **AI Cost Tracking & Model Selection**:
   - Pick OpenRouter models for different tasks (e.g., Llama 3 for initial drafts, Claude Haiku for polish, GPT-4o for premium edits) and track cumulative generation costs.

---

## Tech Stack

1. **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
2. **Backend**: Express + Node.js (v20) + TypeScript + Drizzle ORM (Postgres)
3. **Database**: PostgreSQL (Docker Compose locally, Neon Serverless in production)
4. **AI integration**: OpenAI SDK (centralized in `server/ai/config.ts`) configured to support OpenAI / OpenRouter
5. **Social Publishing**: xQuick API (`https://xquik.com/api/v1`)
6. **Task Scheduling**: `node-cron`
7. **PWA Integration**: `vite-plugin-pwa`

---

## Commands

- **Local Development**:
  ```bash
  npm run dev
  ```
- **Build Client & Server**:
  ```bash
  npm run build
  ```
- **Type Check**:
  ```bash
  npm run check
  ```
- **Run E2E Tests**:
  ```bash
  npx playwright test
  ```
- **Verify inside Docker**:
  ```bash
  npm run build:verify:docker
  ```
- **Drizzle Database Operations**:
  ```bash
  npm run db:generate   # Generate migrations
  npm run db:push       # Push schema to DB (development)
  npm run db:migrate    # Apply migrations (production)
  ```

---

## Project Structure

```
.agents/
  skills/             → Installed agent-skills for workflow guidance
client/
  src/
    components/       → Shared UI elements (Badge, Button, Dialog)
    pages/
      discover.tsx    → Discover feed + Comment Mining triggers
      settings.tsx    → Connect xQuick + Model config settings
      briefing.tsx    → Reimagined Daily Morning Briefing
      engagement.tsx  → Reimagined Premium Engagement Hub
      composer.tsx    → War Story Composer (Bullet-to-Thread)
server/
  ai/
    config.ts         → Central OpenAI/OpenRouter client + Model cost tracking
  social/
    x.ts              → xQuick API adapter (Tweets, Write Actions, Accounts)
  routes.ts           → REST API routing
  storage.ts          → Drizzle database query implementations
  scheduler.ts        → Background node-cron runners
shared/
  schema.ts           → Database table definitions & TS types
```

---

## Code Style

### Backend (TypeScript)
Use async/await with clean error boundaries. Always type database payloads and query parameters using schemas from `shared/schema.ts`.
```typescript
app.post("/api/posts/:id/publish", async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const result = await tryPublishPostById(postId, { invokedBy: "user" });
    return res.json(result);
  } catch (err: any) {
    console.error(`[publish] Failed post=${req.params.id}:`, err);
    return res.status(500).json({ message: err.message });
  }
});
```

### Frontend (React + TSX)
Use Tailwind CSS for styling. Keep state operations close to the components via TanStack Query.
```tsx
export function BriefingCard({ post }: { post: Post }) {
  const queryClient = useQueryClient();
  const publishMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/posts/${post.id}/publish`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
    },
  });

  return (
    <Card className="p-4 flex flex-col justify-between">
      <h3 className="text-sm font-medium">{post.title}</h3>
      <Button onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending}>
        Publish Now
      </Button>
    </Card>
  );
}
```

---

## Testing Strategy

1. **Unit & Integration Tests**:
   - Write tests for core utilities (e.g., thread numbering, time slot calculators) using Jest/TS-Jest.
2. **End-to-End Tests**:
   - Use Playwright to test full content flows: Auth -> Ingest RSS -> Generate Draft -> Schedule -> Mock xQuick post -> Sync Analytics.
   - Run verification tests inside the isolated Docker PostgreSQL test runner (`npm run build:verify:docker`).
3. **Mocking External APIs**:
   - Keep xQuick API calls mocked or environment-gated during test cycles to avoid eating credentials/rate limits.

---

## Boundaries

- **Always do**:
  - Keep migrations idempotent and let them apply automatically on startup.
  - Track AI generation token counts and estimated costs inside the `ai_usage_log` table.
  - Restrict failed scheduler retries via `XQUIK_ALLOW_WRITE_RETRIES=0` to prevent duplicate publishing.
- **Ask first**:
  - Changing the columns in database tables (`shared/schema.ts`) that might affect existing production data.
  - Adding heavy external client packages.
- **Never do**:
  - Commit private tokens or `.env` files.
  - Remove existing verification tests or disable ESLint rules without explanation.

---

## Success Criteria

1. **Engagement Hub**: Kishore can track at least 10 SRE/DevOps influencer accounts, view their latest tweets, and generate an AI reply suggestion with 1 click.
2. **Comment Mining**: Inserting a viral tweet URL fetches replies, extracts at least 3 discussion themes, and synthesizes 1 draft post.
3. **PWA Capability**: The app compiles, generates a service worker, and can be installed via Chrome on a mobile device.
4. **Performance**: Initial load of the Morning Briefing dashboard takes `< 1s` in the browser, and RSS discovery is pre-cached.
5. **Cost Safety**: Model selection dashboard shows the estimated cost in USD of all AI requests made in the last 30 days.

---

## Open Questions

> [!IMPORTANT]
> - Do we have access to a scraper/API for reading X comments for **Comment Mining**, or should we simulate this using public RSS/JSON proxies or OpenAI summaries of pasteable text?
> - For tracking competitor/influencer tweets in the **Premium Engagement Hub**, do we want to configure an external scraper service (e.g., `twitterapi.io`) or use a simple webhook/polling setup?
