# Specialist Skill Recommendations

Part of the ContentForge UX intelligence package. Discovery only.

**Nothing has been installed or activated.** Implementation skills are switched on only after you choose which areas to pursue.

## Availability check

The account's enabled skills were listed and searched for accessibility, design-system, UX and frontend topics. None of the enabled skills targets those areas (the list covers documents, spreadsheets, slides, PDFs, memory, MCP building, skill creation, web artifacts and similar). The project folder contains one project skill, `graft`, which was not read during this audit and is not assumed relevant.

So each area below is described as a **capability to bring in**, with two possible routes: pick a specialist skill from a registry after you approve the area, or author a small ContentForge-specific skill (the skill-creator tool is available). Either route should be reviewed before use.

## Areas ranked by where the evidence is strongest

| Rank | Area | Recommendations covered | Why (evidence) | What the specialist does | How to verify | Depends on |
|---|---|---|---|---|---|---|
| 1 | **Accessibility remediation** | R07, R14 (and the naming half of R01) | axe: `button-name` critical on 88/88 runs; `document-title` 88/88; `meta-viewport` 88/88; no `nav` landmark; 25-50 controls per page under 44 px | Fix names, titles, landmarks, skip link, zoom, labels, target sizes; add axe to the existing Playwright flow so regressions fail CI | Re-run the 88-run axe crawl; targets in UX_ROADMAP.md acceptance checks | Nothing. Can start immediately |
| 2 | **Design-system foundations and state kit** | R01, R02, R03, R18 | UX-01 (utility breaks a fixed control), UX-02 (13 unconfirmed deletes; AlertDialog unused), UX-03 (no read-error state anywhere), UX-18, UX-28, UX-35 | Shared PageHeader, Banner, EmptyState, ErrorState, ConfirmDialog and undo-toast; fix the `hover-elevate` interaction; trim fonts and tokens | Forced-500 probe; delete-flow probe; component inventory shows the new shared components in use | Nothing. Should precede area 5 |
| 3 | **Agent and publishing safety UX** | R05, R06, R12 | UX-06, UX-07, UX-08, UX-09, UX-10 | Design and specify the approve / schedule / publish flow with preview and confirmation; truthful run status; approval controls for waiting runs; fix the CopilotKit 403 | Agent Workspace walkthrough (J5) against the acceptance checks | Reuses the Calendar dialog and `x-post-preview.tsx` |
| 4 | **Error-message and microcopy design** | R04, R08 | UX-04, UX-05, UX-29: raw JSON toasts, hardcoded provider status, silent disabled submit | A message catalogue mapping the app's existing error classes to plain sentences; auth form validation copy; provider status wording | Error probes show sentences; no claim in the UI that the app cannot verify | Existing `shared/agent-ui.ts` error classes |
| 5 | **Information architecture and navigation** | R09, R10, R11, R13, R15, R16 | UX-12 to UX-17, UX-19, UX-22, UX-32 | Turn the candidate structure in INFORMATION_ARCHITECTURE.md into an agreed structure; Today view; command palette; direct Generate-to-Schedule path | Sidebar and page titles match; J2 step count falls below 8; usage instrumentation for one week | **Owner answers to Q1, Q2, Q3** |
| 6 | **Responsive and mobile layout** | R12 (layout part), R19, R20 | UX-11, UX-30 | Re-layout the Agent Workspace and fix Generate, Calendar and Settings at 390 px; scope a PWA capture path | Viewport screenshots at 1440/820/390; no nested scroll traps | After area 2 |
| 7 | **UX regression testing** | Supports every area | The audit's scripts are outside the repo today | Add axe and state-probe checks to the repo's Playwright setup so fixes stay fixed | CI runs the probes | Areas 1-3 provide the assertions |
| 8 | **Surfacing hidden backend capability** | R17 | Feature matrix F35-F38: voices, generation policies, automation, learning signals have no UI | Product design for "what worked" and voice and policy settings | Each capability the owner picks has a screen | **Q1 and R10** |

## Suggested order

Areas 1 and 2 can start together and unblock everything else. Area 3 protects irreversible public actions. Areas 5 and 8 wait for your decisions. Area 7 grows alongside the others.

## What you decide

Choose any subset of the eight areas. For each one chosen, the next step is: agree the scope from the linked recommendations, activate or author the relevant skill, and implement in small reviewable changes with the acceptance checks in UX_ROADMAP.md.
