# Ticket: Inventory existing X/content machinery

Type: `wayfinder:research` (AFK) | Status: closed | Blocks: none
Blocked by: none (frontier)

## Question

What X/content-creation machinery already exists in this repo, and how mature is
each piece? Cover `server/social/x.ts`, `server/autopilot.ts` (hardcoded
`targetPlatform = "x"`), `server/utils/threadUtils.ts`, the `posts`/`tweets`
tables and their lifecycle in `server/storage.ts` + `server/routes.ts`,
`PLAN_X_FEATURES.md`, and `shared/xDeveloperRisk.ts`. For each: what it does,
what state it tracks, what is X-specific vs. already generic.

## Resolution

FINDINGS (subagent ses_f765dba15ffeA1PO7OamVEjHZG, 2026-09-10, recorded here —
full report in session transcript): X publish/threads/analytics via xQuick
working; autopilot hardcodes `targetPlatform="x"` at 4 sites; schema/storage/
routes already generic (`targetPlatform` string, per-platform
`externalIds`/`externalUrls`, `analytics.platform`); `assertEligibleForXPublish`
pattern worth cloning per platform; direct-OAuth code dead (replaced by xQuick);
`targetPlatform="both"` default legacy; X articles gated (`canPublish:false`).
Status: findings ready for [Lock the core domain model](03-domain-model.md).
