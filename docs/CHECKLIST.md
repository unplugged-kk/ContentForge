# Check before you call a change done

Run the checks that the change can affect. Do not skip a check in the required set. Do not run live publishes or paid providers.

## Required for any application change

1. `npx tsc --noEmit`
2. `npm run test:unit`
3. Update `docs/STATUS.md`, `docs/ACTIVE_WORK.md`, and `docs/HANDOVER.md` with the command output you saw, including counts and the commit.

## Add when the change touches them

| Change | Also run |
|---|---|
| SQL, Drizzle schema, or `migrations/` | `npm run db:generate` only to create a new file. Review the SQL. `npm run test:db` against disposable Postgres. Migration Guard workflow on the pull request. |
| Auth, CSRF, ownership, or encryption | The existing owner-isolation tests, plus `npm run test:db` if a row is read through Postgres. |
| A route or page a Playwright spec covers | The matching spec, or say which spec you could not run and why. |
| CI workflow files | The workflow on a pull request. A local unit run does not prove the Actions job. |
| Docs only | `script/agent-context.sh sync`. No test suite. Check that every commit SHA and Actions URL in the doc exists. |

## Not a substitute

- A unit test passing on a fixture does not mean a channel published.
- A merged pull request does not mean Actions passed. Pull request 7 is the example.
- `docs/CAPABILITY_MATRIX.md` saying IMPLEMENTED does not mean VERIFIED LIVE.

## Review

Someone other than the author reads the diff for product changes. In this repo that role has been a fresh Wayfinder review against the diff and the test output, recorded in [`product-discovery/AGENT_COLLABORATION.md`](product-discovery/AGENT_COLLABORATION.md). The author does not mark the review done.
