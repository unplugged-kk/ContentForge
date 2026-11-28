---
title: "Parallel browser test failures are usually contention, confirm with a serial rerun"
author: Kishore
date: 2026-11-28
standing: true
id: l-fc1f8272
scope: repo
status: active
src: init-sessions
---

## Watch out
- Several phases saw about 10 full-suite end-to-end failures in parallel runs (routes, insights specs) that all passed when run serially. These were tracked to the dev server and workers competing, not to code regressions.
- In the code: When the full Playwright chromium run fails in parallel, rerun with workers=1 before you debug. Treat a failure that repeats in the serial run as real. Before running, kill any stale server on the port, because Playwright reuses an old build otherwise.

_From past Claude sessions here, Sep 19._
