# Copilot Code Review Instructions

## Project Context
ContentForge is a full-stack TypeScript app (React + Express + PostgreSQL + Drizzle ORM) for creating and scheduling social media content about Data & AI. AI features use OpenAI gpt-4o-mini via Replit integrations.

## Review Priorities

### 1. Security
- **Token handling**: `connected_accounts.accessToken` must NEVER be returned unmasked in API responses. All GET endpoints must mask tokens (show only last 4 chars).
- **Input validation**: Every POST/PUT/PATCH route must validate the request body with a Zod schema before passing to storage.
- **SQL injection**: All database access must go through Drizzle ORM (never raw SQL strings with user input).
- **File uploads**: `multer` config must enforce `fileSize` limits and validate file types.
- **No secrets in code**: Environment variables (`DATABASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `SESSION_SECRET`) must never be hardcoded.

### 2. Data Integrity
- **Drizzle schema changes**: Any change to `shared/schema.ts` must be followed by `npm run db:push`. Never change primary key ID column types (serial ↔ varchar).
- **Foreign keys**: When deleting a parent (post, reference), ensure child records (tweets, reference_content, analytics) are handled (cascade or manual delete).
- **Upsert logic**: `connected_accounts` uses upsert on platform — verify conflict resolution is correct.

### 3. API Design
- **Consistent error handling**: All routes must return proper HTTP status codes (400 for validation, 404 for not found, 500 for server errors).
- **Response format**: API responses must be JSON. Lists return arrays, single items return objects.
- **Zod validation**: Use `z.union([z.number(), z.string().transform(Number)])` for IDs that might come from form inputs as strings.

### 4. Frontend Patterns
- **TanStack Query v5**: Only use object form: `useQuery({ queryKey: [...] })`. Never use the array form.
- **Cache invalidation**: After every mutation, invalidate relevant query keys using `queryClient.invalidateQueries()`.
- **Form validation**: Use `react-hook-form` with `zodResolver` and Drizzle insert schemas.
- **No explicit React import**: Vite JSX transform handles it.
- **Env vars**: Frontend must use `import.meta.env.VITE_*`, backend uses `process.env.*`.

### 5. AI Integration
- **Always log usage**: Every `aiCall()` must be followed by `logAiUsage()` to track token consumption.
- **JSON mode**: When expecting structured AI output, pass `jsonMode: true` to `aiCall()` and use `safeJsonParse()` on the response.
- **Token limits**: `max_completion_tokens: 8192` — ensure prompts don't exceed context window.
- **Error handling**: AI calls can fail (rate limits, timeouts). Wrap in try/catch with user-friendly error messages.

### 6. TypeScript
- **Shared types**: All data types must be defined in `shared/schema.ts` using Drizzle's `$inferSelect` and `z.infer`.
- **No `any` in storage interface**: `IStorage` methods should use proper types from schema.
- **Strict null checks**: Handle `undefined` returns from `getPost()`, `getArticle()`, etc.

## Team Best Practices

### Code Organization
- Backend routes in `server/routes.ts`, storage in `server/storage.ts` — keep routes thin, logic in storage.
- Frontend pages in `client/src/pages/`, reusable components in `client/src/components/`.
- Constants (pillars, tones, post types) in `client/src/lib/constants.ts` — not scattered across components.

### Naming Conventions
- Database columns: camelCase in TypeScript, Drizzle handles snake_case mapping.
- API routes: RESTful (`/api/posts`, `/api/posts/:id`, `/api/posts/:id/status`).
- Component files: kebab-case (`app-sidebar.tsx`, `quick-capture.tsx`).
- Data test IDs: `{action}-{target}` for interactive, `{type}-{content}` for display elements.

### Performance
- `staleTime: Infinity` on queries — data only refreshes on explicit invalidation.
- Avoid N+1 queries in storage methods — use joins where possible.
- AI calls are expensive — don't retry automatically, let the user decide.

### Styling
- Tailwind CSS with shadcn/ui components. Use utility classes, not inline styles.
- Dark mode via CSS variables in `index.css`. Always provide both light and dark variants.
- Icons from `lucide-react` for actions, `react-icons/si` for brand logos.

## Repo-Specific Rules
1. **Never modify** `vite.config.ts`, `server/vite.ts`, or `drizzle.config.ts` unless absolutely necessary.
2. **Never modify** `package.json` scripts without explicit approval.
3. **Always update** `replit.md` when making architectural changes.
4. **Storage interface**: Any new CRUD operation needs a method in `IStorage` and implementation in `DatabaseStorage`.
5. **Seed data**: Keep `server/seed.ts` idempotent — always check for existing data before inserting.
6. **AI system prompt**: Changes to `SYSTEM_PROMPT` affect ALL generated content — review carefully.

<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
