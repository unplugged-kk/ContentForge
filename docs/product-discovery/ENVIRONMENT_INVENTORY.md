# ContentForge — Environment Inventory

**Date:** 2026-11-27  
**Branch:** `work/productization-mvp` (branched from `origin/main` @ `0dca9550d161d08a7ec82b34488ce4a022db81e0`)  
**Scope:** Local environment, agent systems, skills, memory stores, Git topology, and runtime infrastructure. No secret values are printed anywhere in this document.

---

## 1. Agent Systems & Orchestration Capabilities

| System | Installed Location | Verified Capabilities | Access & Constraints |
|---|---|---|---|
| **Wayfinder** | `/Users/kishore/.agents/skills/wayfinder/SKILL.md` (symlinked at `~/.cursor/skills/wayfinder`, `~/.codex/skills/wayfinder`) + `agents/openai.yaml` | **Verified.** Matt Pocock's wayfinding skill for decision maps (`wayfinder:map`), fog-of-war scoping, and HITL/AFK tickets. Existing repo map at `plans/wayfinder-contentforge/MAP.md` + 10 tickets (`01`–`10`). | Invoked as a dedicated strategic/challenger subagent (`Task` tool, `generalPurpose`) loaded with `wayfinder/SKILL.md` + `plans/wayfinder-contentforge/MAP.md`. No standalone CLI binary (`which wayfinder` → not found). |
| **Poteto mode (`poteto-mode` / `poteto-agent`)** | `/Users/kishore/.agents/skills/poteto-mode/SKILL.md` (symlinked at `~/.cursor/skills/poteto-mode`) + `/Users/kishore/.cursor/plugins/local/pstack/agents/poteto-agent.md` + `playbooks/`, `references/`, `scripts/` | **Verified.** Full engineering execution style with 21 leaf `principle-*` skills, playbooks (`Feature`, `Bug fix`, `Investigation`, `Autonomous run`, `Orchestrate`), `unslop`, `no-comments`, `tdd`, `interrogate`, `swarm`. Native Cursor subagent `subagent_type: "poteto-agent"`. | Directly spawnable via Cursor `Task` tool (`subagent_type: "poteto-agent"`). No standalone CLI binary (`which poteto` / `which potato` → not found). |
| **Cursor Subagent Runtime** | Native `cursor:Task` dynamic tool | **Verified.** Parallel and sequential local subagent execution (`poteto-agent`, `generalPurpose`, `explore`, `reviewer`, `implementer`, `cavecrew-*`, `bugbot`, `security-review`). | Subagents run in isolated context windows and return structured reports to the coordinator; shared state persists via Git and `docs/product-discovery/`. |
| **Graft Knowledge Graph** | `/Users/kishore/.local/bin/graft` + repo `graft/` index | **Verified.** CLI `graft map`, `graft ask "<q>" --source`, `graft skeleton <file>`, `graft callers <sym>`, `graft grep` work locally ($0, no API key; 535 files, 4,365 symbols, 12,062 edges). | MCP namespace `user-graft` requires `mcp_auth`; CLI works immediately and was used throughout discovery. |
| **code-review-graph MCP** | `user-code-review-graph` MCP | **Present, not freshly rebuilt.** Per `AGENTS.md`, requires `build_or_update_graph_tool` + `embed_graph_tool` and does not auto-update via hooks. | Graft CLI preferred for fast structural queries. |
| **claude-mem MCP** | `plugin-claude-mem-mcp-search` + `user-claude-mem` | **Partially degraded.** `search` returned `Semantic search is offline (Chroma MCP unreachable)`; `work_state_read` returned HTTP 404 from local worker. | Do not rely on `claude-mem` as sole source of truth; use Git-backed `docs/product-discovery/` as the durable knowledge base. |
| **Persistent Agent Stores** | `.../AgentStores/.../3822c0b8-.../files` (empty), `.../u306149538/files` (`grok-bot/` only) | **Verified.** No ContentForge-specific records stored there. | Readable via filesystem tools. |

---

## 2. Installed Skills Inventory (Reconciles `SKILL_INVENTORY`)

### 2.1 Repo-Local Skill Directories

| Path | Status | Contents & ContentForge Use Case |
|---|---|---|
| `.agent/skills/` | **Does not exist** | Mentioned in older ChatGPT review; actual repo directory is `.agents/skills/`. |
| `.agents/skills/` | **Exists (26 skills)** | `agent-reach`, `api-and-interface-design`, `browser-testing-with-devtools`, `ci-cd-and-automation`, `code-review-and-quality`, `code-simplification`, `context-engineering`, `debugging-and-error-recovery`, `deprecation-and-migration`, `documentation-and-adrs`, `doubt-driven-development`, `frontend-ui-engineering`, `git-workflow-and-versioning`, `graft`, `idea-refine`, `incremental-implementation`, `interview-me`, `observability-and-instrumentation`, `performance-optimization`, `planning-and-task-breakdown`, `security-and-hardening`, `shipping-and-launch`, `source-driven-development`, `spec-driven-development`, `test-driven-development`, `using-agent-skills`. Gitignored machine-local directory. |
| `.claude/skills/` | **Exists (5 items)** | `debug-issue.md`, `explore-codebase.md`, `graft/`, `refactor-safely.md`, `review-changes.md`. |
| `.grok/skills/` | **Exists (1 item)** | `graft/`. |
| `.commandcode/` | **Exists (non-skill)** | `design/`, `mods/`, `taste/`, `settings.json` (no `.commandcode/skills/`). |
| `.codex/` | **Exists (config only)** | `config.toml`, `hooks.json`. |

### 2.2 User-Level Skill Registries (High-Value Subset Selected for This Mission)

| Skill Family / Path | Relevant Skills Verified | Role in ContentForge Mission |
|---|---|---|
| **Matt Pocock Skills** (`~/.agents/skill-repos/mattpocock/`, symlinked in `~/.cursor/skills/`) | `wayfinder`, `grill-me`, `batch-grill-me`, `grill-with-docs`, `improve-codebase-architecture`, `tdd`, `to-prd`, `triage`, `ubiquitous-language`, `web-to-prd`, `ask-matt` | Product scoping (`wayfinder`), architectural review (`improve-codebase-architecture`), red-green-refactor (`tdd`). |
| **Poteto / pstack Skills** (`~/.cursor/plugins/local/pstack/skills/`) | `poteto-mode`, `principle-prove-it-works`, `principle-fix-root-causes`, `principle-boundary-discipline`, `principle-laziness-protocol`, `principle-model-the-domain`, `principle-subtract-before-you-add`, `principle-sequence-verifiable-units`, `principle-test-behavior-not-implementation`, `unslop`, `no-comments`, `technical-writing`, `tdd`, `how`, `interrogate`, `swarm`, `show-me-your-work` | Core engineering discipline, subagent orchestration, concise unslopped docs, verification. |
| **Superpowers** (`~/.agents/skill-repos/superpowers/skills/` & `~/.cursor/plugins/cache/cursor-public/superpowers/...`) | `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `subagent-driven-development`, `writing-plans`, `executing-plans`, `using-git-worktrees`, `finishing-a-development-branch` | Overlaps with pstack/repo TDD & review skills; prefer `poteto-mode` + `verification-before-completion` + `systematic-debugging` to avoid redundant ceremony. |
| **Domain / Writing / QA** (`~/.cursor/skills/`) | `humanizer`, `owasp-security`, `js-security-audit`, `database-patterns`, `ci-cd-patterns`, `browser-qa` | Consult selectively for security/SSRF audits and editorial rubric calibration (never use `humanizer` to evade AI detectors or fabricate anecdotes). |

---

## 3. Git Topology, Worktrees, Stash & Untracked Files

- **Repository:** `https://github.com/unplugged-kk/ContentForge` (GitHub visibility reported as **PUBLIC** in `AGENT_SYNC.md`; `gh` CLI returned `403 Forbidden` inside sandbox).
- **`origin/main`:** `0dca9550d161d08a7ec82b34488ce4a022db81e0` (`Feat/auth0 migration (#6)`, 2026-11-11).
- **Active execution branch:** `work/productization-mvp` created cleanly from `origin/main` (`0dca955`). `main` is untouched.
- **Collaboration branch:** `origin/collab/ai-pair-review` @ `c569ca3` (7 commits ahead, 0 behind `origin/main`; docs-only: `docs/collab/{README,AGENT_SYNC,PRODUCTIZATION_GOAL,REVIEW_ChatGPT}.md`, `docs/COLLAB_BRIEF.md`, `AGENTS.md`). Read via `git show`; **not** merged into `work/productization-mvp`.
- **Divergent remote branches (audited commit-by-commit):**
  - `origin/run60-schedule-must-be-future` (`897b935`): 13 ahead / 23 behind `origin/main`. Holds real safety/testing bug fixes (`24cb12f`, `e8c01f4`, `2b11460`, `7e4a6f8`, `5627fd9`, `8b62870`, `5cf7af6`, `75f4e99`, `897b935`, `fdb0b58`) plus 2 founder-hardcoded commits (`f421c23`, `70583fa`) to skip.
  - `origin/run58-word-safe-unit-fit` (`75f4e99`): 12 ahead / 23 behind — strict ancestor of `run60` (0 unique commits vs `run60`).
  - `origin/run57-idea-pool` (`3dab588`): 12 ahead / 23 behind — 1 unique commit (`3dab588`, legacy `autopilot.ts` idea cap/filter).
  - `origin/run56-intel-bridge` (`fb5d999`): 12 ahead / 23 behind — 1 unique commit (`fb5d999`, personal laptop `script/oci-intel-to-ideas.ts` bridge).
  - `origin/feat/copilotkit-agent-layer` (`3b13431`): **0 ahead** / 26 behind — already landed on `origin/main`.
  - `origin/ci/live-harness-blocking` (`d44ca6c`): **0 ahead** / 30 behind — already landed on `origin/main`.
- **Local branches & stash:** All `phase-33.6-*` / `phase-33.7-*` / `phase-fix-auth-gate-case` local branches are 0 ahead of `origin/main`. `stash@{0}` (`phase-33.7-discovery-ownership`) contains `0031_discovery_settings_ownership`, already landed on `origin/main` (preserved, not dropped).
- **Untracked files in working tree:** 5 dead Craft Anything files (`site/postiz-{agent,home,layout,render,styles}.ts`), documented in `docs/HANDOVER.md` §2 as unmounted; preserved untouched and never staged.
- **Prunable worktrees:** 16 historical worktrees listed under `/Users/kishore/git/cf-design/*` (marked `prunable`; untouched).

---

## 4. Runtime, Verification & Secret-Hygiene Baseline

- **Node / npm:** Node `v24.22.1`, npm `11.19.1` (note `package.json` specifies `engines.node: "20"`, CI runs Node 20).
- **TypeScript (`npx tsc --noEmit`):** **VERIFIED PASS** on `0dca955` (exit 0, zero diagnostics).
- **Unit tests (`npm run test:unit` without `DATABASE_URL`):** **VERIFIED FAIL** on `0dca955` — 15+ test files fail at module import with `Error: DATABASE_URL must be set` (`server/db.ts:6`), confirming the Nov 11 pass relied on an ambient `DATABASE_URL`.
- **PostgreSQL / Docker:** Local Postgres responds on `127.0.0.1:5432` (do not run destructive tests against an unverified database); Docker daemon socket `/Users/kishore/.dory/dory.sock` is blocked inside default sandbox (`permission denied`).
- **Secret Hygiene (Paths & Classes Only — Zero Values Printed):**
  - Tracked HEAD regex scan for AWS/GitHub/OpenAI/Google/Slack/PEM keys: **0 matches**.
  - Reachable Git objects scan (`git rev-list --all --objects`) for `.env*` (excluding `.env.example`), `local.txt`, `orig-backup`, `cookie`: **0 matches**.
  - Previously flagged residual pack objects from `phase-security-verification` (`e55efb8`: blob `a32bcae2...`, tree `9d83f21e...`): **`git cat-file -t` confirms neither object exists in the local `.git` store**.
  - `.gitignore` now covers `.env`, `.env.*`, `*.env`, `*.env.local`, `/local.txt` (gap from `e55efb8` is closed).
  - **Remaining caveat:** A full dedicated secret scanner (`gitleaks`/`trufflehog`) across all historical commits on the public GitHub remote has not been run in this environment; owner should confirm GitHub Secret Scanning is enabled.

---

## 5. Authoritative vs. Stale / Conflicting Records

| Record | Authority Status | Notes |
|---|---|---|
| Code on `origin/main` (`0dca955`) | **Authoritative** | Ground truth for all claims. |
| `docs/product-discovery/*` | **Authoritative (this mission)** | Reconciled Wayfinder + Poteto strategy, state, Q&A, roadmap, decisions. |
| `origin/collab/ai-pair-review:docs/collab/{PRODUCTIZATION_GOAL,REVIEW_ChatGPT,AGENT_SYNC}.md` | **Authoritative (collaboration contract)** | External review + execution contract; reconciled in `DECISIONS.md`. |
| `docs/HANDOVER.md`, `docs/CAPABILITY_MATRIX.md`, `docs/ROADMAP.md` (2026-11-11) | **Dated snapshot** | Valuable baseline, but predates `run56`–`run60` and overstates unit-test portability (`DATABASE_URL` trap) and `P1-1`/`P1-3` priority over core UI defects. |
| `CURRENT_ARCHITECTURE.md` (2026-10-02 + 2026-11-11 note) | **Authoritative for layering, partial drift in §6** | §6 still says "There is no decision ledger" despite `migrations/0033_jev_decisions.sql` and `server/decision/ledgerStore.ts`. |
| `plans/wayfinder-contentforge/MAP.md` | **Historical rationale** | Explains locked domain decisions (01–08); explicitly says not to plan execution from it. |
| `site/home.ts`, `site/agent.ts` | **Drifted / inaccurate marketing** | Overclaims quote cards, visual QA, topic/hook analytics, and unconditional human gating; scheduled for cleanup in Wave 1. |
| `graphify-out/` | **Stale / ignored** | Per `AGENTS.md`, unmaintained; use `graft`. |
