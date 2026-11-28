---
title: Stored AI providers use the most widely supported API unless a probe confirms more
author: Kishore
date: 2026-11-28
standing: true
id: l-cc86b618
scope: repo
status: active
src: init-review
---

## Decided
- OpenAI-compatible providers vary in what they support. The newer Responses API is used only when a probe has detected it, and fallback to another backend is never silent.
- In the code: Chat completions is the default transport for stored `ai_providers`. Use Responses only if the probe flagged it. Fallback must be explicit on the `ai_model_routes` route and refused when the route disallows it. Never return the API key to the browser.

_From PR #5 here, Oct 7._
