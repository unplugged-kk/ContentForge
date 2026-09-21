# Ticket: Inventory scheduler, publish path, and research inputs

Type: `wayfinder:research` (AFK) | Status: closed | Blocks: none
Blocked by: none (frontier)

## Question

What already exists for (a) scheduling (`server/scheduler.ts` node-cron jobs,
`rssAutopost.ts`, `discoverRefresh.ts`, publish loop behavior), (b) the publish
path and result recording (`publishing` states, `analytics` table, idempotency —
is double-publish possible?), and (c) research inputs (`rssSources`,
`youtube_channels`, `monitoredAccounts`, `discoveredIdeas`, `discoverySettings`,
`marketPulse.ts`, `viralScores`)? Report mechanics as-is: triggers, states,
retry behavior (if any), gaps vs. a durable-queue scheduler.

## Resolution

FINDINGS (subagent ses_f765dba14ffeWaWoIO8YFsrtQC, 2026-09-10, recorded here):
all jobs in-process node-cron (Asia/Kolkata), execute-inline with no
persistence/resume; publish loop full-scans posts each minute; failed-post retry
exists but OFF by default, max 3, no DLQ; double-publish IS possible (no
`publishing` lease state, no idempotency key, check-then-act without lock);
`analytics` has no unique `(postId,platform)`; `discoverySettings`
enabledSources/minViralScore/customKeywords and `monitored_accounts` are
write-only (pipeline ignores them); `discoverRefresh` uses 14-day in-memory
dedupe + AI top-20 rank. Status: findings ready for
[Lock the core domain model](03-domain-model.md).
