# How ContentForge fits together

Read this once, then use [`../CURRENT_ARCHITECTURE.md`](../CURRENT_ARCHITECTURE.md) for module paths. That architecture note is dated 2026-10-02 and was checked again on 2026-11-11. Product behavior added after `0dca955` is recorded in [`product-discovery/DECISIONS.md`](product-discovery/DECISIONS.md) and in git, not in a new architecture audit.

## One process

Express serves the React app and the API. The same process runs the queue workers and the schedulers. A second worker process would run those jobs twice. Postgres holds the records. Drizzle maps them. pg-boss and node-cron carry background work.

## Three jobs that stay separate

Intelligence code gathers and ranks sources. It does not decide to publish. Jev, in `server/decision/`, can score or gate a step when its flag is on. Flags default off. Execution code creates stories, artifacts, schedules, and publications, and it checks its own rules again. A Jev result does not by itself authorise a post.

## What a creator does

1. Research runs against allowed providers and stores sources and short evidence excerpts.
2. A story is created from a finished research job, from the creator's own notes, or from both. The story kinds recorded for that choice are `first_hand`, `researched`, and `hybrid`.
3. An opportunity picks a format and a channel that the adapters allow.
4. Generation writes copy into an artifact. The artifact revision is immutable. An edit is a new revision.
5. A person approves or rejects the artifact. Unattended approval stays off unless `ALLOW_TRUSTED_AUTOMATION=1`.
6. From an approved artifact the creator can copy text, copy a thread, or export markdown with citations. That path does not need a social account.
7. A schedule can still publish through an owner-scoped channel adapter. If the provider call is ambiguous, the result is `unknown` and is not blindly retried.

## What "owner" means

Rows and channel credentials belong to the signed-in user. Password, Google, and Auth0 can all establish the session. Auth0 details are in [`AUTH0.md`](AUTH0.md). API routes sit behind the auth gate, with CSRF on cookie sessions. A missing connected account does not fall back to a deployment-wide token unless `ALLOW_ENV_CHANNEL_FALLBACK=1` is set on purpose.

## Where the loop is still thin

Performance signals and a weekly digest exist in the productization commits. Per-topic prediction against what actually happened is still the gap named in the 2026-11-11 handover. Do not treat a green unit fixture as a live post. No live external publish was authorised for that work.
