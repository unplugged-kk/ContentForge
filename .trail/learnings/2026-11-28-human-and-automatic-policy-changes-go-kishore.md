---
title: Human and automatic policy changes go through one shared activation path
author: Kishore
date: 2026-11-28
standing: true
id: l-7152ba1d
scope: repo
status: active
src: init-sessions
---

## Decided
- Phase 29.4 autonomy was built to call the existing 29.3 human activation service rather than its own writer. That keeps a single production mutation path, and an actor column records who made each change.
- In the code: Any policy activation or rollback must go through activatePolicyCandidate/rollbackPolicyForCandidate in server/content/policyActivation and pass actor. Explicit caller input to createGenerationJob always overrides the active policy. Agent tools must never be able to reach activation, and policyActivationDenial.test.ts checks this.

_From past Claude sessions here, Sep 19._
