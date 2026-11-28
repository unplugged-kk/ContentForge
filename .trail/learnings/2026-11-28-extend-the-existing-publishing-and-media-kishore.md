---
title: Extend the existing publishing and media pipelines instead of building parallel systems
author: Kishore
date: 2026-11-28
standing: true
id: l-4eaf1340
scope: repo
status: active
src: init-review
---

## Decided
- Every new channel (Threads, Instagram, Reels, YouTube) and media kind (video, audio) was added as an adapter or kind on the existing pipeline. The work stated explicitly that it added no second publication or media architecture.
- In the code: New channels: register a `ChannelAdapter` on Artifact -> Publication -> Result. New media: extend `VisualProviderPort`/`AssetStoragePort` and the `visual.run` pg-boss queue. Do not add provider-specific tables or queues.

_From PR #3 here, Sep 21._
