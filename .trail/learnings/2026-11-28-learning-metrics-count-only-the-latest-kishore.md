---
title: Learning metrics count only the latest measurement per post and only measured posts
author: Kishore
date: 2026-11-28
standing: true
id: l-abdfacce
scope: repo
status: active
src: init-review
---

## Watch out
- Hardening found that aggregating several snapshots of the same metric skewed the comparisons. Counting posts with no measurements also inflated sample sizes.
- In the code: In learning observations, group by `(publicationId, metric)` and take the latest by `observedAt`. Sample size N uses `measuredCount` (observed values only).

_From PR #3 here, Sep 21._
