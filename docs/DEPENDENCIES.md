# Dependencies

`package.json` and `package-lock.json` are the list. This page is the policy. Do not copy the lockfile into docs.

## How to add or upgrade

1. Prefer a package already in the lockfile.
2. If you need a new runtime dependency, stop and ask the owner. Name the package, the licence, and what existing code it replaces.
3. Pin through the lockfile. Commit `package.json` and `package-lock.json` together.
4. Run `npm run test:unit` after the change. If the package touches SQL, sessions, or HTTP clients, say which test covers it.

The licence field in `package.json` is `MIT`. A new dependency with a non-commercial or unknown licence needs the owner to accept it before it is added.

## Security

Do not add a package to call a paid model, a social network, or a scraping service without an owner approval recorded in [`product-discovery/DECISIONS.md`](product-discovery/DECISIONS.md). Provider calls go through the existing AI and social modules so tests can strip the credentials.

`engines.node` is 20. CI still warns that some GitHub Actions run on Node 24. That warning is not a decision to move the app to Node 24.

## Stack already in use

Confirmed from `package.json` and [`../CURRENT_ARCHITECTURE.md`](../CURRENT_ARCHITECTURE.md). Versions live in the manifest.

- React 18 client, Express 5 server, Vite build.
- PostgreSQL via Drizzle and `pg`.
- Auth0 browser SDK, plus password and Google session paths.
- Zod for request bodies. TipTap for editing. Recharts for charts.
- Playwright for browser tests. `tsx` and TypeScript for the server and the test runner.
- CopilotKit packages are present. They are not the current product path. Do not extend them as part of CF-CI.

Transitive packages are owned by the direct dependency that pulled them in. Upgrade a transitive package by upgrading or overriding that parent on purpose, not by editing `node_modules`.
