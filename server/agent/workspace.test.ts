import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyAgentError,
  compileWorkspaceIntent,
  formatSse,
  mapCapabilities,
  parseSseBlock,
  reduceAgentEvents,
  resolvePlanArguments,
  selectToolRenderer,
  toAguiProtocolEvents,
} from "@shared/agent-ui";
import { extractAguiObjective } from "./agui-sse";
import { createFixtureBackend } from "./backends";

describe("workspace intent compiler", () => {
  it("compiles research + story + x post without privileged tools", () => {
    const plan = compileWorkspaceIntent("Research AI agents this week and prepare an X post.");
    assert.equal(plan[0]?.tool, "research_topic");
    assert.equal(plan[1]?.tool, "create_story");
    assert.equal(plan[2]?.tool, "repurpose_story");
    assert.ok(plan.every((step) => step.tool !== "approve_artifact" && step.tool !== "publish_now"));
  });

  it("uses an existing story id for multi-channel variants", () => {
    const plan = compileWorkspaceIntent("Take story 42 and create X, LinkedIn and Instagram variants.");
    assert.equal(plan[0]?.tool, "get_story");
    assert.equal((plan[0]?.arguments as { storyId: number }).storyId, 42);
    const repurpose = plan.find((step) => step.tool === "repurpose_story");
    assert.ok(repurpose);
    const targets = (repurpose?.arguments as { targets: Array<{ channel: string }> }).targets;
    assert.ok(targets.some((t) => t.channel === "x"));
    assert.ok(targets.some((t) => t.channel === "linkedin"));
    assert.ok(targets.some((t) => t.channel === "instagram"));
  });

  it("parses bounded counts for a mass-repurpose objective", () => {
    const plan = compileWorkspaceIntent(
      "Turn this Story 42 into 3 X posts, 1 thread and 2 LinkedIn posts.",
    );
    const repurpose = plan.find((step) => step.tool === "repurpose_story");
    const targets = (repurpose?.arguments as { targets: Array<{ format: string; count?: number }> }).targets;
    assert.equal(targets.find((t) => t.format === "x_post")?.count, 3);
    assert.equal(targets.find((t) => t.format === "x_thread")?.count, 1);
    assert.equal(targets.find((t) => t.format === "linkedin_post")?.count, 2);
  });

  it("passes a last_30d window into research_topic", () => {
    const plan = compileWorkspaceIntent("Research AI agents from the last 30 days.");
    assert.equal(plan[0]?.tool, "research_topic");
    assert.equal((plan[0]?.arguments as { windowPreset?: string }).windowPreset, "last_30d");
  });

  it("requests SEO enrichment when the objective asks for it", () => {
    const plan = compileWorkspaceIntent("Research AI agents from the last 30 days and include SEO context.");
    assert.equal((plan[0]?.arguments as { seo?: boolean }).seo, true);
  });

  it("compiles image and video intents", () => {
    assert.ok(compileWorkspaceIntent("Create an image for this post.").some((s) => s.tool === "generate_image"));
    assert.ok(compileWorkspaceIntent("Create a video for this story.").some((s) => s.tool === "generate_video"));
    assert.ok(compileWorkspaceIntent("Give me three short clips from this video.").some((s) => s.tool === "repurpose_video"));
  });
});

describe("workspace argument binding", () => {
  it("resolves $refs from prior tool results", () => {
    const bound = resolvePlanArguments(
      { researchJobId: "$researchJobId", insightBody: "$insightBody" },
      { researchJobId: 9 },
      "Research AI agents",
    );
    assert.equal(bound.researchJobId, 9);
    assert.match(String(bound.insightBody), /Research AI agents/);
  });
});

describe("tool renderer selection", () => {
  it("maps ContentForge tools to controlled renderers", () => {
    assert.equal(selectToolRenderer("research_topic"), "research_topic");
    assert.equal(selectToolRenderer("generate_artifact"), "generate_artifact");
    assert.equal(selectToolRenderer("generate_image"), "generate_image");
    assert.equal(selectToolRenderer("not_a_tool"), "generic");
  });
});

describe("agent state reducer", () => {
  it("reduces AG-UI events into activity and tool cards", () => {
    const view = reduceAgentEvents([
      { type: "RUN_STARTED", runId: 3, payload: { backendId: "fixture", threadId: "3", runId: 3 } },
      { type: "TOOL_CALL_START", payload: { toolCallId: "11", toolCallName: "research_topic" } },
      { type: "TOOL_CALL_ARGS", payload: { toolCallId: "11", delta: { query: "AI agents" } } },
      {
        type: "TOOL_CALL_RESULT",
        payload: {
          toolCallId: "11",
          status: "completed",
          result: { status: "queued", summary: "ResearchJob queued", refs: { researchJobId: 4 }, data: { sourceCount: 12 } },
        },
      },
      { type: "RUN_FINISHED", payload: { result: "completed" } },
    ]);
    assert.equal(view.status, "completed");
    assert.equal(view.toolCalls[0]?.renderer, "research_topic");
    assert.ok(view.activity.includes("Researching…"));
    assert.equal(view.refs.researchJobId, 4);
  });
});

describe("error and capability mapping", () => {
  it("classifies structured errors", () => {
    assert.equal(classifyAgentError({ envelopeStatus: "denied" }).class, "permission_denied");
    assert.equal(classifyAgentError({ status: 404 }).class, "not_found");
    assert.equal(classifyAgentError({ failureClass: "transient" }).retrySafe, true);
    assert.equal(classifyAgentError({ envelopeStatus: "invalid" }).class, "validation_error");
  });

  it("maps backend tool metadata into capability rows", () => {
    const rows = mapCapabilities([
      { name: "research_topic", capabilityStatus: "implemented" },
      { name: "generate_image", capabilityStatus: "implemented" },
      { name: "publish_now", access: "privileged", requiresApproval: true, capabilityStatus: "implemented" },
      { name: "get_analytics", capabilityStatus: "partial" },
    ]);
    assert.equal(rows.find((r) => r.group === "Research")?.available, true);
    assert.equal(rows.find((r) => r.group === "Publishing")?.approvalRequired, true);
    assert.equal(rows.find((r) => r.group === "Analytics")?.status, "partial");
  });
});

describe("AG-UI SSE encoding", () => {
  it("round-trips protocol events", () => {
    const sse = formatSse(
      toAguiProtocolEvents([
        { type: "RUN_STARTED", runId: 1, payload: { threadId: "1", runId: 1 } },
        { type: "TOOL_CALL_START", payload: { toolCallId: "2", toolCallName: "get_analytics" } },
      ]),
    );
    assert.match(sse, /event: RUN_STARTED/);
    const parsed = parseSseBlock(sse);
    assert.equal(parsed[0]?.type, "RUN_STARTED");
  });

  it("extracts the last user message as the AG-UI objective", () => {
    assert.equal(
      extractAguiObjective({
        messages: [
          { role: "assistant", content: "hi" },
          { role: "user", content: "Research AI agents" },
        ],
      }),
      "Research AI agents",
    );
  });
});

describe("fixture backend $ref resolution", () => {
  it("binds the next plan step from history refs", async () => {
    const backend = createFixtureBackend();
    const result = await backend.run({
      ownerId: 1,
      objective: "go",
      agentRunId: 1,
      correlationId: "c",
      tools: [],
      history: [{ toolName: "research_topic", status: "completed", refs: { researchJobId: 8 } }],
      providerSnapshot: {
        plan: [
          { tool: "research_topic", arguments: { query: "x" } },
          { tool: "create_story", arguments: { researchJobId: "$researchJobId", title: "t", insightBody: "b" } },
        ],
      },
    });
    assert.equal(result.status, "waiting");
    assert.equal(result.toolRequests?.[0]?.name, "create_story");
    assert.equal(result.toolRequests?.[0]?.arguments.researchJobId, 8);
  });
});
