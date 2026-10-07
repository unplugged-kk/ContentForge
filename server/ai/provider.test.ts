import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { describe, it } from "node:test";
import { probeProvider } from "./probe";
import { selectProvider, type ProviderCandidate } from "./select-provider";
import { assertPublicProviderHasNoSecret, toPublicProvider } from "./provider-view";
import type { AiProviderRow } from "@shared/schema";

function provider(partial: Partial<ProviderCandidate> & Pick<ProviderCandidate, "id" | "name">): ProviderCandidate {
  return {
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: null,
    model: "local",
    transport: "chat_completions",
    enabled: true,
    isDefault: false,
    headers: {},
    ...partial,
  };
}

async function listen(handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

describe("provider selection", () => {
  it("skips a disabled provider and refuses a silent fallback", () => {
    const selected = selectProvider({
      purpose: "agent",
      providers: [
        provider({ id: 1, name: "primary", enabled: false, model: "gpt-a" }),
        provider({ id: 2, name: "local", model: "llama" }),
      ],
      routes: [
        {
          purpose: "agent",
          providerId: 1,
          model: "gpt-a",
          priority: 0,
          enabled: true,
          allowFallback: false,
          fallbackProviderId: 2,
          fallbackModel: "llama",
        },
      ],
    });
    assert.equal("error" in selected, true);
  });

  it("uses the named fallback only when the route allows it", () => {
    const selected = selectProvider({
      purpose: "agent",
      providers: [
        provider({ id: 1, name: "primary", enabled: false }),
        provider({ id: 2, name: "local", model: "llama", transport: "chat_completions" }),
      ],
      routes: [
        {
          purpose: "agent",
          providerId: 1,
          model: "gpt-a",
          priority: 0,
          enabled: true,
          allowFallback: true,
          fallbackProviderId: 2,
          fallbackModel: "llama",
        },
      ],
    });
    assert.ok(!("error" in selected));
    if ("error" in selected) return;
    assert.equal(selected.provider.name, "local");
    assert.equal(selected.model, "llama");
    assert.equal(selected.fallbackUsed, true);
    assert.equal(selected.provider.transport, "chat_completions");
  });
});

describe("provider probe", () => {
  it("accepts a chat-completions endpoint that has no responses API", async () => {
    const { server, baseUrl } = await listen((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "local-model" }] }));
        return;
      }
      if (req.url === "/v1/responses") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "no responses" }));
        return;
      }
      if (req.url === "/v1/chat/completions") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          const json = JSON.parse(body) as { stream?: boolean; response_format?: unknown; tools?: unknown };
          if (json.stream) {
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.end("data: {\"choices\":[]}\n\n");
            return;
          }
          if (json.response_format) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "unsupported" }));
            return;
          }
          const auth = req.headers.authorization;
          if (auth !== "Bearer secret-key") {
            res.writeHead(401);
            res.end("no");
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [{ message: { tool_calls: [{ function: { name: json.tools ? "ping" : "x", arguments: "{}" } }] } }],
            }),
          );
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    try {
      const result = await probeProvider({
        baseUrl,
        apiKey: "secret-key",
        model: "local-model",
        transport: "auto",
      });
      assert.equal(result.ok, true);
      assert.equal(result.transport, "chat_completions");
      assert.equal(result.capabilities.responses, false);
      assert.equal(result.capabilities.chatCompletions, true);
      assert.equal(result.capabilities.tools, true);
      assert.equal(result.capabilities.streaming, true);
      assert.equal(result.capabilities.structuredOutput, false);
      assert.deepEqual(result.models, ["local-model"]);
      assert.equal(JSON.stringify(result).includes("secret-key"), false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("records an authentication failure without echoing the key", async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad key secret-key" }));
    });
    try {
      const result = await probeProvider({
        baseUrl,
        apiKey: "secret-key",
        model: "m",
        transport: "chat_completions",
      });
      assert.equal(result.ok, false);
      assert.equal(result.errorCategory, "auth");
      assert.equal(result.error?.includes("secret-key"), false);
      assert.match(result.error ?? "", /\[redacted\]/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("detects a responses endpoint when chat completions is absent", async () => {
    const { server, baseUrl } = await listen((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "resp-model" }] }));
        return;
      }
      if (req.url === "/v1/chat/completions") {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.url === "/v1/responses") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ output: [] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    try {
      const result = await probeProvider({
        baseUrl,
        apiKey: null,
        model: "resp-model",
        transport: "auto",
      });
      assert.equal(result.ok, true);
      assert.equal(result.transport, "responses");
      assert.equal(result.capabilities.chatCompletions, false);
      assert.equal(result.capabilities.responses, true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("provider public view", () => {
  it("does not include the ciphertext or the API key", () => {
    const row = {
      id: 1,
      userId: 2,
      name: "Local",
      type: "openai-compatible",
      baseUrl: "http://127.0.0.1:9/v1",
      secretCiphertext: "enc:v1:aaaa:bbbb:cccc",
      organization: null,
      project: null,
      extraHeaders: {},
      transport: "auto",
      detectedTransport: "chat_completions",
      defaultModel: "local",
      models: ["local"],
      enabled: true,
      isDefault: true,
      capabilities: { chatCompletions: true },
      lastHealthAt: null,
      lastHealthOk: true,
      lastHealthError: null,
      createdAt: new Date("2026-10-07T00:00:00Z"),
      updatedAt: new Date("2026-10-07T00:00:00Z"),
    } as AiProviderRow;
    const view = toPublicProvider(row);
    assert.equal(view.hasSecret, true);
    assert.equal("secretCiphertext" in view, false);
    assertPublicProviderHasNoSecret(view, "super-secret-key");
    assert.equal(JSON.stringify(view).includes("enc:v1"), false);
  });
});
