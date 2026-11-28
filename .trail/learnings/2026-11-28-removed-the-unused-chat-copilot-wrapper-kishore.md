---
title: Removed the unused chat copilot wrapper that caused permission errors
author: Kishore
date: 2026-11-28
standing: true
id: l-8c172cd6
scope: repo
status: active
src: init-sessions
---

## Tried and ruled out
- The CopilotKit provider had no consumers anywhere in the client and caused 403 errors on the agent endpoint, so it was deleted instead of fixed.
- In the code: Don't reintroduce AgentCopilotProvider/CopilotKit. The e2e checks that /api/agent/agui returns no 403.

_From past Claude sessions here, Sep 19._
