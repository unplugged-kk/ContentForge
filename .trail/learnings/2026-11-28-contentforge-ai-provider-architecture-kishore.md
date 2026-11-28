---
title: ContentForge AI Provider Architecture
author: Kishore
date: 2026-11-28
id: l-86ec930c
scope: repo
status: active
touches:
  - server/routes.ts
  - "server/ai/chat.ts#aiCall"
---

## Decided
**Current state**: Single OpenAI client in `server/routes.ts:17` and `server/replit_integrations/*/routes.ts`. Uses Replit env vars `AI_INTEGRATIONS_OPENAI_API_KEY` + `AI_INTEGRATIONS_OPENAI_BASE_URL`. Model hardcoded to `gpt-4o-mini` in `aiCall()` at line 87.

**Planned**: Create `server/ai-provider.ts` — unified `aiCall(messages, opts)` interface that dispatches to: OpenAI, Anthropic Claude (via @anthropic-ai/sdk), Ollama (local HTTP, points to home server), LlamaCloud (optional). Provider + model selectable via settings page stored in `user_profile.memoryJson` or a new `ai_settings` table.

**Ollama endpoint**: Will point to home server IP/hostname running Ollama. Ollama exposes OpenAI-compatible API at `/v1` so can use the OpenAI SDK with custom baseURL.

**Cost strategy**: Use Ollama/local for brainstorming/drafts, Claude Haiku for bulk generation, Claude Sonnet/OpenAI GPT-4o for final polish and high-stakes content.

**Why:** User doesn't want to pay for scheduling. Wants to control AI costs. Local models reduce OpenAI spend, Claude API gives quality/cost balance, Ollama free for home use.

_From Claude Code's memory of this repo, last updated Apr 27._
