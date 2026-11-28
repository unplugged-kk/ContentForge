---
title: Live end-to-end test failures now fail the build
author: Kishore
date: 2026-11-28
standing: true
id: l-8b63c02e
scope: repo
status: active
src: init-review
---

## Decided
- The live harness job used to be allowed to fail. After a local run passed fully, the team removed the allowance so regressions block merges.
- In the code: Do not re-add `continue-on-error` to the live E2E job in GitHub Actions. Run it locally with `make e2e-live`.

_From PR #4 here, Oct 7._
