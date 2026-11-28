---
title: "Build Recent Activity from existing records, there is no event log table"
author: Kishore
date: 2026-11-28
standing: true
id: l-cf566353
scope: repo
status: active
src: init-sessions
touches:
  - client/src/pages/today.tsx
  - client/src/lib/today-schedule-state.ts
---

## Decided
- The team checked and found no domain event table. The audit_logs table only logs HTTP requests, so Today's Recent Activity is assembled on the client rather than adding a new table.
- In the code: Don't use audit_logs as an activity feed. Recent Activity in client/src/pages/today.tsx combines timestamped rows from bounded list endpoints, and the pure logic lives in client/src/lib/today-schedule-state.ts.

_From past Claude sessions here, Sep 19._
