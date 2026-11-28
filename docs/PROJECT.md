# ContentForge

ContentForge is a single-operator web application that turns technical sources and a creator's own notes into a claim-checked post or thread. The creator inspects the draft against its evidence, approves it, and either exports it or publishes it through an owner-scoped channel.

The agreed strategy is [`product-discovery/PRODUCT_STRATEGY.md`](product-discovery/PRODUCT_STRATEGY.md) (2026-11-27). This page is the short identity. It does not replace that strategy.

## Who it is for

The first user to prove is a technical creator who posts about infrastructure, developer tools, or incidents and cares that the facts and the voice are theirs. That audience is a hypothesis recorded in the strategy, not a measured market.

## What it does

The product path is research, a story, one or more opportunities, a generated artifact, human approval, then export or a scheduled publication. Results can be logged and summarised. The code also contains older routes, a decision layer called Jev, and a public marketing site.

## What it is not

It is not a multi-tenant SaaS, a billing product, or a general chatbot. Video Factory, Creative Engineering Hub, and Artha are separate repositories. Jev decision flags stay off until there is a labelled set to compare them with (`DEC-08` in [`product-discovery/DECISIONS.md`](product-discovery/DECISIONS.md)). Live posting to X is not the default path. Export is.

## Maturity

The research-to-export work and the security fixes in pull request 7 are merged to `origin/main` at `ae8ced2` (2026-11-28). GitHub Actions on that commit failed. See [`STATUS.md`](STATUS.md) and [`BUGS.md`](BUGS.md). Do not describe the merge as production-ready.

Architecture, as built, is [`../CURRENT_ARCHITECTURE.md`](../CURRENT_ARCHITECTURE.md). How the pieces behave in plain language is [`MENTAL-MODEL.md`](MENTAL-MODEL.md).
