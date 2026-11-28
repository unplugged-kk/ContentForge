---
title: Automated optimization can never change live generation settings except through the human…
author: Kishore
date: 2026-11-28
standing: true
id: l-3dc3afbb
scope: repo
status: active
src: init-review
---

## Decided
- The experiment and autonomy phases were built so that nothing writes production generation policies directly. Activation is explicit, and the autonomous controller calls the same activation service a human uses.
- In the code: Never add a write path to `generation_policies`. Autonomy in `server/content/autonomy/` must call the Phase 29.3 activation service (`POST /api/policy-candidates/:id/activate`). DB and live E2E tests assert the production policy count stays unchanged.

_From PR #3 here, Sep 21._
