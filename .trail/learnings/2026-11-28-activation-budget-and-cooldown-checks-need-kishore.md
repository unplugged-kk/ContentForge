---
title: Activation budget and cooldown checks need a lock or concurrent requests overspend
author: Kishore
date: 2026-11-28
standing: true
id: l-84b449b3
scope: repo
status: active
src: init-review
---

## Watch out
- An audit found that the daily and weekly activation caps were plain reads. Two concurrent requests for the same owner on different scopes could both pass before either committed.
- In the code: Budget, cooldown and rollback-oscillation gates in the autonomy controller must run under a per-owner lock or serialized transaction, not as bare SELECT counts.

_From PR #3 here, Sep 21._
