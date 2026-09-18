# ContentForge status

Living status for Phase B work on `replit` / PR #3. Architecture detail lives in
`plans/contentforge-product/PHASE-B-IMPLEMENTATION.md`.

## Phase 22 — Agent Runtime + Agent Tool Layer

**Status:** IMPLEMENTED (Timeplus live MCP ENVIRONMENTALLY BLOCKED; Video Factory
HyperFrames render remains the Phase 21 BLOCKED boundary)

**Verification:** TypeScript 0; unit 470/470; Postgres 240/240; live E2E 154/154;
visual E2E 38/38; agent E2E 17/17.

### Architecture

```
Agent backends (fixture | OpenAI-compatible | AG-UI remote)
        ↓
Agent Runtime (durable AgentRun / AgentToolCall)
        ↓
AgentToolRegistry + authorization policy
        ├─ ContentForge tools → existing domain services → PostgreSQL + pg-boss
        └─ ExternalToolProviderPort → MCP (Timeplus semantic read-only tools)
```

PostgreSQL remains the system of record. Agents never receive SQL tools.
pg-boss remains the only queue (`agent.run` is a job type, not a second broker).

### AgentBackendPort

| Backend | Config | Status |
|---|---|---|
| `fixture` | default / `AGENT_BACKEND_ID=fixture` | IMPLEMENTED |
| `openai-compatible` | `AGENT_BACKEND_BASE_URL`, `AGENT_BACKEND_API_KEY`, `AGENT_MODEL` | IMPLEMENTED (verified against a local HTTP test endpoint) |
| `agui-remote` | `AGENT_AGUI_URL` | IMPLEMENTED (verified against a real external process) |

### Durable state

- `agent_runs` — owner, backend snapshot, objective, status, step/attempt, cancellation, failure class
- `agent_tool_calls` — tool name, idempotency key, input hash, bounded input/result, resource refs

### Tool inventory

See PHASE-B Phase 22. Privileged: `approve_artifact`, `publish_now`. Timeplus
semantic tools are read-only and do not mutate ContentForge tables.

### Timeplus

PARTIALLY IMPLEMENTED / ENVIRONMENTALLY BLOCKED — seam + semantic tools exist;
`TIMEPLUS_MCP_URL` is unset in this environment so agents read ContentForge-local
metrics (`source=contentforge`). Disabling Timeplus does not break the pipeline.

### Security

Owner identity is injected. Foreign IDs return `not_found`. Privileged tools
denied without an explicit grant. Prompt-injection research content cannot
elevate `publish_now`.

### Explicit deferrals

CopilotKit workspace UI, mass repurposing intelligence, style learning, autonomous
publishing as default, Chrome extension, YouTube/TikTok, vector memory.
