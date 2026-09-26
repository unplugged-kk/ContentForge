# AI / Agent / Autonomy UX Audit — Worktree 4

**Mode:** design review (report only)
**Register:** Product — authenticated single-operator tool (`.commandcode/design/brief.md:11-19`)
**Surfaces audited:** Agent Workspace (`client/src/pages/agent.tsx`, `client/src/components/agent/`),
Insights Learning / experiments / evaluation / policy candidates / activation / rollback
(`client/src/components/insights/learning-view.tsx`, `client/src/components/insights/automated-optimization-panel.tsx`,
`client/src/pages/insights.tsx`), Scheduler (`client/src/pages/schedule.tsx`, `client/src/components/schedule/`).
**Shared primitives read:** `client/src/components/ui-shared/{status-badge,actor-badge,announcer,confirm-dialog,error-state,channel-icon}.tsx`,
`client/src/lib/{agent-workspace-state,queryClient}.ts`, `client/src/index.css`.
**Worktree:** `/Users/kishore/git/cf-design/wt-04` (branch `design/wt-04`). Read-only; nothing was modified.
**Date:** 2026-09-26.
**Deliberately not reported** (already landed in Phase 33.2): `rejected` as a distinct `StatusBadge` status,
`ActorBadge`, `ChannelIcon`, and the existence of the live-region `announcer`.

---

## Composition read

The three surfaces serve different work patterns and mostly compose correctly.

- **Agent = Operate.** Composer → active-run status → execution timeline → approval callout → artifacts, in one column.
  Technical subsystems (research, video, audio, repurpose, style) are correctly moved into a "Diagnostics" sheet
  (`agent.tsx:463`) and the raw AG-UI event stream sits inside a `<details>` (`agent.tsx:783-793`). That is genuine
  progressive disclosure and is the model the remaining leaks below should follow.
- **Insights > Learning = Compare + Monitor.** Stable lanes with tiered headings; the policy-candidate tier is where
  human-vs-automatic authority is expressed, via `ActorBadge` at `learning-view.tsx:1754-1764`.
- **Schedule = Operate.** The Publications tab is truthful about the `unknown`/`failed` publication outcomes
  (`publications-view.tsx:76-84`) — an example to keep.

The composition is sound. The defects are state-truthfulness and vocabulary, not structure.

---

## Findings

Ordered by severity, then by reach and leverage. `Before` is the current implementation.

| # | Severity | Discipline | Location (file:line) | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | HIGH | Surface | `client/src/components/insights/learning-view.tsx:555-565`, branch at `:1754` | `const { data: activatedIdsData } = useQuery<{ activatedCandidateIds: number[]; activatedCandidateActors: … }>({ queryKey: ["/api/policy-candidates/activated-ids"] });` — `data` only, no `isError`/`error`; the act/roll-back branch keys off `activatedCandidateIds.has(candidate.id)`, which is an empty `Set` by default | Destructure `isError` and, when set, render an `ErrorState` ("Couldn't load activation state", retry) in place of the Activate/Roll-Back controls — mirroring the sibling list at `:1647-1652` | A failed read of the activation table rounds down to "nothing is active", so an already-live policy renders an **Activate for Future Generations** button. Read failure is not an empty state (`docs/agent-workspace-ux.md:35-36`; brief Truthfulness #5) |
| 2 | HIGH | Interaction | `client/src/pages/agent.tsx:705-706` | `onClick={() => setView((prev) => ({ ...prev, waitingForApproval: false }))}` on the `Dismiss` button (`data-testid="button-run-dismiss"`) — no request, no toast, no persistence | Make the control truthfully scoped: either relabel it to disclose ("Hide") and leave the run status untouched, or send the decision to the server and keep the blocked state until the server confirms | `view.waitingForApproval` feeds `deriveRunDisplayStatus` (`client/src/lib/agent-workspace-state.ts:54`), so Dismiss silently removes "Waiting for approval" while the privileged action is still unauthorized. A reload restores it. It misleads the operator about a human-authority gate (brief Truthfulness #7) |
| 3 | MEDIUM | Color | `client/src/components/insights/learning-view.tsx:829-830` and `:1420-1424`; correct counter-example at `:1090-1101` | `+{prop.evidenceSummary?.differencePercentage}%` inside `<span className="font-semibold text-emerald-600 dark:text-emerald-400 …">`; observation delta likewise always `text-emerald-600` | Branch on sign exactly as `:1090-1101` does (emerald for positive, rose for negative, muted for zero) and drop the hardcoded `+` prefix | A regression is rendered in success green, and at `:829` a negative value renders literally as `+-12%`. Colour contradicts the number and the sign is fabricated (brief Truthfulness rules 1 and 3) |
| 4 | MEDIUM | Writing | `client/src/components/agent/workspace-cards.tsx:32-35`; same pattern at `:76-78` | `<Badge variant={call.status === "denied" ? "destructive" : "secondary"} …>{call.status}</Badge>`; run cards render `{run.status}` in a fixed `secondary` badge | Use the shared `StatusBadge` (humanized labels, per-state variant) and give `failed` its own variant, not the `completed` grey | Raw enums (`completed_with_errors`, `denied`, `running`) leak into the primary execution timeline, and a **failed** tool call is visually identical to a completed one. Two status vocabularies (this and `StatusBadge`) live on the same page |
| 5 | MEDIUM | Surface | `client/src/components/agent/workspace-cards.tsx:129-168`, `:125-134`, `:144-151`; `client/src/pages/agent.tsx:623` | Card titles `VisualAsset`, `VideoAsset`, `AudioAsset`, `VideoRepurposingJob`; raw `hash {contentHash}`; `Provider:`; developer strings "Identity only — no binary in agent messages." / "…or credentials in agent messages."; the run header prints raw `{activeRun.backendId}` | Humanize to the user-facing vocabulary ("Visual", "Video", "Audio"; Content/Version per `docs/ui-information-architecture.md:149-158`), move hashes, provider and backend id into the Diagnostics sheet, and drop the developer notes from operator copy | Technical execution detail competes with the primary workflow instead of being progressively disclosed, and internal nouns contradict the product's own translation table |
| 6 | MEDIUM | Writing | `client/src/components/insights/learning-view.tsx:583-589` and `:608-614`; root cause `client/src/lib/queryClient.ts:7` | `description: err?.message \|\| "Could not activate this policy candidate."` where `apiRequest` throws `new Error(\`${res.status}: ${text}\`)` and the server returns machine codes (`CONCURRENT_ACTIVATION`, `NO_PRIOR_REVISION`, `INSUFFICIENT_EVIDENCE` — `docs/phase-29.3-policy-activation-architecture.md`, API section) | Map the known codes to plain language ("Another activation finished first; reload to see the current policy.") and demote the code to secondary detail | On the one surface where trust in the autonomy gate is decided, a failed activation/rollback shows a raw status number and an error code |
| 7 | MEDIUM | Accessibility | `client/src/components/ui-shared/announcer.tsx:68` used only at `client/src/components/quick-capture.tsx:14`; absent from `agent.tsx`, `learning-view.tsx`, `publications-view.tsx` | Agent-run completion, policy activation/rollback (`learning-view.tsx:578-581`, `:603-606`) and publication results resolve into visual state and toasts only; nothing is announced | Call `announce(…)` in those success and failure handlers | The live-region mechanism exists but is not wired into any audited surface, so a run or an activation completes silently for a screen reader (brief Open work #3: completion is not announced) |
| 8 | MEDIUM | Accessibility | `client/src/components/ui-shared/status-badge.tsx:66-68`; `client/src/index.css:425-428` | `generating` and `running` share byte-identical classes (`text-blue-600 dark:text-blue-400 border-blue-500/30 pulse-live`); `waiting_for_approval` differs only by an amber tint plus `pulse-live`; `prefers-reduced-motion` sets `animation: none` on `.pulse-live` | Give each in-flight state a distinct non-colour, non-motion glyph (spinner for generating/running, clock/pause for waiting) and keep the pulse as reinforcement only | The only signals beyond the text token are a hue and a pulse that is removed under reduced motion, so the in-flight states collapse visually. Corroborated by brief Open work #2 and `smell-report.md` finding #4; the Phase 33.2 change added `rejected` only, so this remains open |
| 9 | LOW | Voice | `client/src/components/insights/learning-view.tsx:1863, 1866, 1871`; `client/src/pages/agent.tsx:555` | Section heading "Ask Agent"; body "Consult the Agent to analyze patterns or suggest new content angles."; button "Consult Agent"; composer placeholder "Ask ContentForge… e.g. Research latest developments…" | Name the operation, not a counterpart: "Run pattern analysis" / "Open Agent workspace"; placeholder "Describe the objective, e.g. research recent developments and draft an X post." | "Ask"/"consult" frames the orchestrator as a conversational entity, against the orchestrator-not-chatbot principle (`docs/agent-workspace-ux.md:25-27`) |

**Counts: HIGH 2 · MEDIUM 6 · LOW 1 — 9 findings.**

---

## Answers to the specific questions

**1. Can the operator tell at a glance whether the system acted or a human acted, and whether an action is reversible?**
Largely yes, and this is the strongest part of the surface. `ActorBadge` renders "Activated by You" / "Activated Automatically"
with distinct icon **and** word (`actor-badge.tsx:38-58`), wired from the server-derived `activatedCandidateActors` map
(`learning-view.tsx:1754-1764`), and Roll Back appears in the same slot. The gap is on the **Agent Workspace**, where the
run status is shown but nothing states that all runs here are operator-initiated, and the `Dismiss` defect (finding #2)
means the one human-authority gate on the page is not truthfully represented. Reversibility is legible on Learning
(Roll Back) but there is no reversibility statement on a manual publish from `artifact-review.tsx:335` ("Publish Now"
after a preview) — acceptable, since the preview is the confirm step.

**2. Is a failed rollback or an unknown/partial activation state represented truthfully, or does it round down to a clean state?**
A failed rollback is handled acceptably (destructive toast, badge unchanged). The **unknown** case is not: the
`activated-ids` query has no error branch (finding #1), so an unreadable activation state renders as a fully clean,
un-activated list. That is the single most important defect in this scope.

**3. Are technical execution details progressively disclosed, or do they compete with the primary workflow?**
Mostly disclosed (Diagnostics sheet; `<details>` event stream; `ToolCallCard` "View Details"). Three leaks compete:
raw tool-call status enums and names in the primary timeline (finding #4), internal asset nouns + developer notes + raw
hash/provider (finding #5), and the raw `backendId` in the run header. The pattern is right; the leaks are localized.

**4. Is any autonomy state communicated only by colour or only by animation (which dies under reduced motion)?**
Nothing is colour-**only** — every state also carries a word. The weakest case is the in-flight `StatusBadge` trio
(finding #8), where the only differentiators beyond the text token are a hue and a pulse that `prefers-reduced-motion`
removes (`index.css:425-428`). The `automated-optimization-panel.tsx` avoids the trap entirely: circuit-breaker,
mode and outcome all carry text.

**5. Does any copy anthropomorphize the system?**
One in-scope instance (finding #9): "Ask Agent" / "Consult Agent". `<ActorBadge kind="automatic">` ("Activated
Automatically") and `automated-optimization-panel.tsx` are correctly non-anthropomorphic.

---

## Verification

### Checks run

| Check | Command / interaction | Observed |
|---|---|---|
| Activation-state error handling | Read `learning-view.tsx:555-565`; grep `isError|error` around the query | `data` only, no error branch → **finding #1 confirmed** |
| Dismiss behaviour | Read `agent.tsx:695-710`; traced `view.waitingForApproval` → `deriveRunDisplayStatus` | Local-state-only mutation, no request → **finding #2 confirmed** |
| Sign/colour of deltas | Read `learning-view.tsx:829-830`, `:1090-1101`, `:1420-1424` | `:829` fixed `+` + emerald; `:1090` sign-branched; `:1420` fixed emerald → **finding #3 confirmed** |
| Announcer wiring | `grep -rn "useAnnouncer\|announce(" client/src` | Only `quick-capture.tsx:14,37,42`; zero in agent/insights/schedule → **finding #7 confirmed** |
| Status vocabulary duplication | Read `workspace-cards.tsx:32-33,76` vs `status-badge.tsx` | Raw `call.status`/`run.status` badges alongside `StatusBadge` → **finding #4 confirmed** |
| Reduced-motion handling of pulse | Read `index.css:411-429` | `.pulse-live { animation: none !important }` under `reduce` → **finding #8 confirmed** |
| Raw code surfacing | Read `queryClient.ts:6-7` | `throw new Error(\`${res.status}: ${text}\`)` → **finding #6 confirmed** |
| Domain-noun/developer copy | Read `workspace-cards.tsx:125-215` | `VisualAsset`/`VideoAsset`/`AudioAsset`, `hash …`, "Identity only — no binary in agent messages." → **finding #5 confirmed** |

### Not verified

- **Rendered appearance.** No dev server was started and no screenshot taken (per the task's no-server rule). All
  findings are read from source; the compiled-CSS behaviour of the pulse is inferred from `index.css`, not observed.
- **Reduced-motion in the browser.** `e2e/accessibility.e2e.spec.ts` was not run; the collapse of the in-flight bad
  trio under `reduce` is read from the stylesheet, not executed.
- **Actual server error payloads.** Whether a failed activation returns a bare code in the response body is taken from
  `docs/phase-29.3-policy-activation-architecture.md`; the client string that reaches the toast is from `queryClient.ts:7`.
- **Autonomy controller activation *through the UI.*** The 29.4 controller activates via `POST /api/autonomy/run`, not
  the Learning button, so the `ActorBadge kind="automatic"` path is exercised only when the server reports an
  autonomous actor; that path was not exercised live.

---

## Considered but rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `learning-view.tsx:1647-1652` | Policy-candidate list "couldn't load" `ErrorState` | Already correct — this is the pattern finding #1 should copy |
| `publications-view.tsx:76-84` | `unknown`/`failed` publication copy | Truthful and specific ("We couldn't confirm what happened with the platform."). Keep |
| `agent.tsx` (approval callout, `agent.tsx:700-706`) | The whole "Authorization Required" callout | The callout itself is correct and well-evidenced; only the Dismiss control is defective (finding #2), so it is reported once |
| `workspace-cards.tsx:106-117` | `PublicationCard` "UNKNOWN" badge | Truthful — it names the unknown rather than rounding down, and carries a word plus an `outline` variant distinct from `published` |
| `automated-optimization-panel.tsx:114-121` | Circuit-breaker / mode / enabled badges | Non-anthropomorphic, all text-bearing, destructive variant when open. No finding |
| `learning-view.tsx:1877-1906` | Activation/Rollback `ConfirmDialog` copy | States scope, reason, irreversibility and reversibility; buttons restate the action ("Roll Back"). No finding |
| Status badge rendered twice on Agent (`agent.tsx:633` and the timeline header) | Redundancy | A repetition, not harm; not worth a row |

---

## Out of scope, flagged for the owning agent

`client/src/pages/chat.tsx:148` ("…I'll help you refine it into a post.") and `:182` (a literal "Thinking..." state) are the
clearest anthropomorphic copy in the client, but `chat.tsx` is outside this worktree's surfaces (Chat > Post). Flagged so
it is not mistaken for an oversight.

---

## Verdict

**Block.** Two `HIGH` findings are standing: a read failure on the activation table rounds down to a clean, un-activated
list (finding #1 — the truthfulness rule this product treats as non-negotiable), and the Agent Workspace `Dismiss` control
(finding #2) mutates the displayed run status without any server action. Six `MEDIUM` and one `LOW` finding remain
outstanding; none requires restructuring, only truthful state and vocabulary.

**Highest-leverage single action:** give the `activated-ids` query an `ErrorState` branch (finding #1). It is one
component slot, mirrors an existing pattern twenty lines away, and it is the one place where the autonomy UI can tell the
operator something that is not true.
