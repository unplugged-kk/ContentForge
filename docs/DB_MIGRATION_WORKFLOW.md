# Database Migration Workflow (Production-Safe)

This project uses **versioned Drizzle SQL migrations** committed to `migrations/`.

## Principle

- Change schema in `shared/schema.ts`
- Generate migration file(s)
- Commit migration SQL + meta files
- Apply migrations in order with `db:migrate`
- Never rely on ad-hoc schema drift in production

## Commands

- `npm run db:generate` — create a new SQL migration from schema changes
- `npm run db:migrate` — apply pending migration files in order
- `npm run db:deploy` — alias of `db:migrate` (deployment-friendly name)

## Local flow

1. Edit `shared/schema.ts`
2. Run `DATABASE_URL=... npm run db:generate`
3. Review generated SQL in `migrations/*.sql`
4. Run `DATABASE_URL=... npm run db:migrate`
5. Run checks/tests
6. Commit schema + migration files together

## Railway / production flow

- App startup already runs `migrate(...)` in `server/index.ts`.
- CI and E2E use `db:migrate`, not `db:push`.
- Deployment should apply migrations before traffic (startup migration or release phase).
- Optional GitHub automation: `.github/workflows/prod-migrate.yml` runs `db:migrate`
  on push using `secrets.RAILWAY_DATABASE_URL` (set once in repo secrets).

## Notes

- `db:push` can still be useful for fast local prototyping, but **production path is `db:migrate`**.
- Keep migration files immutable after commit; create a new migration for corrections.
