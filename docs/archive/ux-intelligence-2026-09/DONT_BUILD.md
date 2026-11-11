# DON'T BUILD

Part of the ContentForge UX intelligence package. Discovery only.

A discovery exercise finds things to build. It should also name what not to build, because ContentForge already has more surface than its daily ritual needs (21 destinations, about 270 backend routes, 127 client API paths). Each item states why, the evidence, and the condition under which it should be reconsidered.

Two categories: **Don't build** (conflicts with the product's scope or stance) and **Defer** (may be right later, but there is no evidence yet).

## Don't build

| # | Item | Why not | Evidence | Reconsider when |
|---|---|---|---|---|
| D1 | Auto-DM, auto-reply and auto-like automation, and by extension auto-plug and auto-repost (as advertised by Hypefury and Typefully) | The app states "no auto-replies, DMs, or auto-posting from draft. Only you (or your schedule) sends to X", and the repo's own compliance document lists auto-replies, keyword replies, auto-DMs, auto-likes and bulk follow as required exclusions. Auto-plug and auto-repost are not named there, so they need an explicit owner decision. X's rules were not independently checked in this audit | Queue, Discover, Ingest and References banners; `docs/X_API_COMPLIANCE_AND_RISK.md` lines 28 and 72-74; COMPETITIVE_RESEARCH.md | The owner explicitly changes the stance |
| D2 | Multi-user roles, team comments, client approval, agency workspaces | Single operator; multi-tenant and billing are explicitly deferred | Product notes; Postiz, Buffer, Publer and Typefully advertise these | Multi-tenant work is scheduled |
| D3 | Billing, plans and usage-limit screens | Deferred by the product notes. The existing AI Usage page already covers cost visibility | Product notes; `ai-usage.tsx` | Multi-tenant work is scheduled |
| D4 | Support for 30+ social networks | The goal is X, with Threads, LinkedIn and YouTube. Backend adapters for other networks exist (Instagram, LinkedIn, Threads tests are present) but UI breadth adds nav weight | Postiz advertises 30+; Feature matrix F23, F24 | A network becomes part of the stated brand plan |
| D5 | A Canva-like design tool | AI Images and the carousel builder exist; a design editor is a different product | Postiz advertises one | Visual output becomes the bottleneck |
| D6 | Link-in-bio or landing pages | Unrelated to the daily ritual | Buffer (Start Page) and Publer advertise them | Never for this goal |
| D7 | Another standalone content generator page | Create already has 11 items; new formats should be modes, not destinations | UX-12, IA doc | A format needs a genuinely different workflow |
| D8 | A general chat sidebar (CopilotChat or similar) as a third interaction paradigm | The app already has the Agent composer and a Chat > Post page; CopilotKit is mounted as a provider with no UI and causes a 403. Adding a chat surface before deciding the agent model (Q1) multiplies entry points | UX-09, UX-14 | Q1 chooses the agent as the primary loop and a conversational surface is needed |
| D9 | A visual redesign or re-skin | Tokens, contrast and typography are sound. The defects are behavioural and structural | DESIGN_SYSTEM_AUDIT.md section 1 | Owner wants a brand change, independent of this audit |
| D10 | A native mobile app | No evidence of need; a fixed capture button and a PWA are the smaller steps (R01, R20) | Feature matrix F48 | PWA proves insufficient |
| D11 | More dashboards or widget builders | The learning signals already in the backend have no screen; surface those first | F38 | After R17 |

## Defer

| # | Item | Why wait | Evidence | Reconsider when |
|---|---|---|---|---|
| E1 | Bulk or CSV scheduling (Publer) | No evidence the operator posts at bulk volume; the ritual is daily | Feature matrix F50 | Queue depth or repeated manual scheduling shows up |
| E2 | Evergreen recycling (Hypefury, Publer) | Needs performance data to pick posts; that data is unsurfaced today | F38, F51 | After R17 and enough history |
| E3 | Drag-and-drop calendar rescheduling (Publer) | The calendar dialog already reschedules with a picker | F53 | If dialog rescheduling proves slow |
| E4 | Engagement surface (spec-planned `engagement.tsx`) | Not part of create-review-schedule; depends on a working Today view | F46 | After R16 |
| E5 | Composer page (spec-planned `composer.tsx`) | Generate is the composer; depends on Q1 | F47 | After R10 |
| E6 | Morning briefing as a rich feature | Start with a plain Today view; the briefing is HYPOTHESIS until Today exists | F45, R16 | After R09 |
| E7 | Exposing ContentForge to outside agents through MCP or API (Postiz, Taplio, Typefully do) | Not investigated; the internal agent runtime is not yet coherent in the UI | COMPETITIVE_RESEARCH.md | Q5 answered yes |
| E8 | Threads and LinkedIn publishing UI beyond fixing the dead-end copy | Depends on the roadmap for those channels | UX-20 | Q7 answered |
| E9 | New AI features (more providers, more media types) | Backend is ahead of the UI already | F31-F34 | After R17 |

## Guardrails for future scope

1. A new feature needs a named step in the daily ritual (capture, create, review, schedule, learn) and evidence that the current path fails there.
2. New public-facing actions need the confirm-and-preview pattern (R05) before shipping.
3. New destinations need an IA decision first (R09). New formats default to modes.
4. Anything that acts without a person present needs an explicit owner decision recorded (D1).
