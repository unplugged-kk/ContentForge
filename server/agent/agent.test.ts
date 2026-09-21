import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { stripOverrideKeys, hashInput, toolIdempotencyKey, isForbiddenKey } from "./sanitize";
import { envelope, denied, notFound, invalid } from "./envelope";
import { authorizeTool, parseGrants } from "./policy";
import { AgentToolRegistry, unknownToolEnvelope } from "./registry";
import { createFixtureBackend, createOpenAiCompatibleBackend, createAguiRemoteBackend } from "./backends";
import { reconstructAguiEvents } from "./events";
import { createTimeplusSemanticTools } from "./timeplus";
import { createDisabledExternalProvider } from "./external";
import type { ToolDefinition } from "./types";

describe("agent sanitize", () => {
  it("strips owner/credential override keys from nested agent input", () => {
    const cleaned = stripOverrideKeys({
      title: "ok",
      ownerId: 99,
      userId: 2,
      nested: { apiKey: "secret", query: "k8s" },
    });
    assert.equal(cleaned.title, "ok");
    assert.equal(cleaned.ownerId, undefined);
    assert.equal(cleaned.userId, undefined);
    assert.deepEqual(cleaned.nested, { query: "k8s" });
    assert.equal(isForbiddenKey("DATABASE_URL"), true);
  });

  it("hashes equivalent inputs identically", () => {
    assert.equal(hashInput({ a: 1 }), hashInput({ a: 1 }));
    assert.notEqual(hashInput({ a: 1 }), hashInput({ a: 2 }));
    assert.match(toolIdempotencyKey(3, "get_story", "abc"), /^agent:3:get_story:/);
  });
});

describe("agent envelope + policy", () => {
  it("classifies denied / not_found / invalid", () => {
    assert.equal(denied("approve_artifact", "no").status, "denied");
    assert.equal(notFound("get_story", "story").status, "not_found");
    assert.equal(invalid("create_story", "bad").status, "invalid");
    assert.equal(envelope({ tool: "x", status: "queued", summary: "q" }).refs.missing, undefined);
  });

  it("blocks privileged tools without an explicit grant", () => {
    const def: ToolDefinition = {
      name: "approve_artifact",
      description: "x",
      inputSchema: z.object({ artifactId: z.number() }),
      access: "privileged",
      ownerScoped: true,
      idempotent: true,
      async: false,
      requiresApproval: true,
      capabilityStatus: "implemented",
      execute: async () => envelope({ tool: "approve_artifact", status: "success", summary: "no" }),
    };
    const blocked = authorizeTool(def, {
      ownerId: 1,
      agentRunId: 1,
      toolCallId: 1,
      idempotencyKey: "k",
      grants: new Set(),
    });
    assert.equal(blocked?.status, "denied");
    const allowed = authorizeTool(def, {
      ownerId: 1,
      agentRunId: 1,
      toolCallId: 1,
      idempotencyKey: "k",
      grants: parseGrants(["approve_artifact"]),
    });
    assert.equal(allowed, null);
  });
});

describe("agent registry", () => {
  it("rejects duplicate tool names and describes schemas", () => {
    const registry = new AgentToolRegistry();
    const tool: ToolDefinition = {
      name: "get_story",
      description: "read",
      inputSchema: z.object({ storyId: z.number() }),
      access: "read",
      ownerScoped: true,
      idempotent: true,
      async: false,
      requiresApproval: false,
      capabilityStatus: "implemented",
      execute: async () => envelope({ tool: "get_story", status: "success", summary: "ok" }),
    };
    registry.register(tool);
    assert.throws(() => registry.register(tool), /Duplicate/);
    const listed = registry.describe();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].access, "read");
    assert.equal(unknownToolEnvelope("nope").status, "invalid");
  });
});

describe("agent backends", () => {
  it("fixture backend walks a plan then completes", async () => {
    const backend = createFixtureBackend();
    const first = await backend.run({
      ownerId: 1,
      objective: "go",
      agentRunId: 9,
      correlationId: "c",
      tools: [],
      history: [],
      providerSnapshot: { plan: [{ tool: "get_story", arguments: { storyId: 1 } }] },
    });
    assert.equal(first.status, "waiting");
    assert.equal(first.toolRequests?.[0]?.name, "get_story");
    const done = await backend.run({
      ownerId: 1,
      objective: "go",
      agentRunId: 9,
      correlationId: "c",
      tools: [],
      history: [{ toolName: "get_story", status: "completed" }],
      providerSnapshot: { plan: [{ tool: "get_story", arguments: { storyId: 1 } }] },
    });
    assert.equal(done.status, "completed");
  });

  it("OpenAI-compatible backend maps tool_calls without ContentForge source changes", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [{ function: { name: "get_story", arguments: JSON.stringify({ storyId: 4 }) } }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      const backend = createOpenAiCompatibleBackend({
        baseUrl: "http://127.0.0.1:9/v1",
        apiKey: "k",
        model: "m",
      });
      const result = await backend.run({
        ownerId: 1,
        objective: "story",
        agentRunId: 1,
        correlationId: "c",
        tools: [{ name: "get_story", description: "x", parameters: {} }],
        history: [],
        providerSnapshot: {},
      });
      assert.equal(result.status, "waiting");
      assert.equal(result.toolRequests?.[0]?.name, "get_story");
      assert.equal(result.toolRequests?.[0]?.arguments.storyId, 4);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("AG-UI remote backend maps toolRequests from an external process", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ toolRequests: [{ name: "research_topic", arguments: { query: "k8s" } }] }),
        { status: 200 },
      )) as typeof fetch;
    try {
      const backend = createAguiRemoteBackend({ aguiUrl: "http://127.0.0.1:9/agui" });
      const result = await backend.run({
        ownerId: 1,
        objective: "research",
        agentRunId: 1,
        correlationId: "c",
        tools: [],
        history: [],
        providerSnapshot: {},
      });
      assert.equal(result.toolRequests?.[0]?.name, "research_topic");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("AG-UI event mapping", () => {
  it("reconstructs RUN/STEP/TOOL events from durable rows", () => {
    const now = new Date();
    const events = reconstructAguiEvents(
      {
        id: 7,
        userId: 1,
        backendId: "fixture",
        providerSnapshot: {},
        objective: "o",
        status: "completed",
        currentStep: 1,
        attempt: 1,
        idempotencyKey: "k",
        correlationId: "c",
        errorClass: null,
        errorMessage: null,
        cancellationRequested: false,
        startedAt: now,
        finishedAt: now,
        createdAt: now,
      },
      [
        {
          id: 11,
          userId: 1,
          agentRunId: 7,
          toolName: "get_story",
          idempotencyKey: "ik",
          inputHash: "h",
          input: { storyId: 1 },
          status: "completed",
          result: { status: "success" },
          resourceRefs: { storyId: 1 },
          errorClass: null,
          errorMessage: null,
          startedAt: now,
          finishedAt: now,
          createdAt: now,
        },
      ],
    );
    assert.equal(events[0].type, "RUN_STARTED");
    assert.ok(events.some((e) => e.type === "TOOL_CALL_START"));
    assert.equal(events[events.length - 1].type, "RUN_FINISHED");
  });
});

describe("Timeplus semantic tools", () => {
  it("does not register run_sql on the content agent by default", () => {
    const tools = createTimeplusSemanticTools({
      storage: {
        listRecentToolCalls: async () => [],
      } as never,
      provider: createDisabledExternalProvider("timeplus"),
    });
    assert.ok(tools.every((t) => t.name !== "timeplus_run_sql"));
    assert.ok(tools.some((t) => t.name === "get_agent_run_metrics"));
    assert.ok(tools.every((t) => t.access === "read"));
  });
});
