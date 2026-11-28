---
title: The chat UI is display only and the database stays the source of truth
author: Kishore
date: 2026-11-28
standing: true
id: l-1c6915df
scope: repo
status: active
src: init-review
---

## Decided
- When CopilotKit was added, the team kept it as presentation only. AG-UI handles transport, ContentForge executes the tools, and Postgres holds the records.
- In the code: CopilotKit posts to `/api/agent/agui` with the session cookie and CSRF token. Approve, schedule and publish go through the existing ContentForge APIs, and review edits create new immutable revisions.

_From PRs #5, #3 here, Oct 7._
