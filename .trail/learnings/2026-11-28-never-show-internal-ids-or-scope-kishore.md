---
title: Never show internal IDs or scope codes to users; translate them to plain labels
author: Kishore
date: 2026-11-28
standing: true
id: l-1017da25
scope: repo
status: active
src: init-review
---

## Watch out
- UX audits kept finding raw internal tokens in the interface, such as raw scope strings and internal record labels. Each one had to be cleaned up afterward.
- In the code: Format `targetScope` (e.g. `channel:linkedin;format:carousel`) and entity refs (`opp_12`, `ResearchJob 1`) into human labels before rendering in client cards.

_From PR #3 here, Sep 21._
