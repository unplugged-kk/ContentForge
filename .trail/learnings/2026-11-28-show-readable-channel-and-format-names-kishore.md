---
title: "Show readable channel and format names in the interface, never raw internal codes"
author: Kishore
date: 2026-11-28
standing: true
id: l-bd68c449
scope: repo
status: active
src: init-sessions
---

## Watch out
- Internal scope strings like channel:linkedin;format:carousel showed up word for word in the learning, experiment, candidate and autonomy screens, some in code tags. This repeated an issue the original UX audit had already flagged.
- In the code: Display every targetScope through humanizeScope() (for example 'LinkedIn · Carousel'). Map snake_case statuses like not_available to labels. E2E tests now assert the humanized text.

_From past Claude sessions here, Sep 19._
