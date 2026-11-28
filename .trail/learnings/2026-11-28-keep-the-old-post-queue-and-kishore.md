---
title: "Keep the old post queue and new content pipeline separate, show both side by side"
author: Kishore
date: 2026-11-28
standing: true
id: l-227ec537
scope: repo
status: active
src: init-sessions
---

## Decided
- Queue and Calendar read old posts/tweets tables, while Create Studio and Agent write to a separate Story to Artifact to Publication model with no link between them. The owner was asked and chose not to merge them, so a Publications tab was added instead.
- In the code: Don't migrate Queue/Calendar off posts/tweets. That merge (audit R10) is the owner's call. Canonical items show up through GET /api/artifacts, /api/schedule-occurrences, /api/publications and in the Schedule Publications tab. Today merges both sources by time on the client.

_From past Claude sessions here, Sep 19._
