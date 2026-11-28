---
title: Database test run looks green while silently skipping almost every suite
author: Kishore
date: 2026-11-28
standing: true
id: l-54b1d33e
scope: repo
status: active
src: init-sessions
touches:
  - server/research/migration.dbtest.ts
---

## Watch out
- Without the test database URL set, the DB test command skips 32 of 33 suites and still reports success. Unit tests also fail without a database URL, and those failures come from the environment, not the code.
- In the code: Set TEST_DATABASE_URL (and DATABASE_URL) before `test:db` and check the suite count (about 37 suites, 320+ tests). Apply new migrations to the local test DB first. Update table and migration counts in server/research/migration.dbtest.ts for each new migration.

_From past Claude sessions here, Sep 19._
