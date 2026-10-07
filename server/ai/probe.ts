import { redactSecrets } from "./redact";

export type TransportPreference = "auto" | "chat_completions" | "responses";
export type DetectedTransport = "chat_completions" | "responses" | "unknown";

export type ProbeCapabilities = {
  models: boolean;
  auth: boolean;
  chatCompletions: boolean;
  responses: boolean;
  tools: boolean;
  streaming: boolean;
  structuredOutput: boolean;
};

export type ProbeResult = {
  ok: boolean;
  transport: DetectedTransport;
  models: string[];
  capabilities: ProbeCapabilities;
  error: string | null;
  errorCategory: string | null;
  latencyMs: number;
};

type FetchLike = typeof fetch;

const EMPTY: ProbeCapabilities = {
  models: false,
  auth: false,
  chatCompletions: false,
  responses: false,
  tools: false,
  streaming: false,
  structuredOutput: false,
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function headersFor(input: {
  apiKey: string | null;
  organization?: string | null;
  project?: string | null;
  extraHeaders?: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;
  if (input.organization) headers["openai-organization"] = input.organization;
  if (input.project) headers["openai-project"] = input.project;
  for (const [key, value] of Object.entries(input.extraHeaders ?? {})) {
    if (/^authorization$|^cookie$|^set-cookie$/i.test(key)) continue;
    headers[key] = value;
  }
  return headers;
}

async function readError(response: Response, secrets: string[]): Promise<string> {
  const body = await response.text().catch(() => "");
  return redactSecrets(`HTTP ${response.status}: ${body.slice(0, 300)}`, secrets);
}

export async function probeProvider(input: {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  organization?: string | null;
  project?: string | null;
  extraHeaders?: Record<string, string>;
  transport: TransportPreference;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<ProbeResult> {
  const started = Date.now();
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 8000;
  const secrets = [input.apiKey].filter((value): value is string => Boolean(value));
  const headers = headersFor(input);
  const capabilities: ProbeCapabilities = { ...EMPTY };
  const models: string[] = [];

  const finish = (partial: Omit<ProbeResult, "latencyMs">): ProbeResult => ({
    ...partial,
    latencyMs: Date.now() - started,
  });

  const call = async (path: string, init: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(joinUrl(input.baseUrl, path), { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const listed = await call("/models", { method: "GET", headers });
    if (listed.status === 401 || listed.status === 403) {
      return finish({
        ok: false,
        transport: "unknown",
        models,
        capabilities,
        error: await readError(listed, secrets),
        errorCategory: "auth",
      });
    }
    if (listed.ok) {
      capabilities.auth = true;
      capabilities.models = true;
      const json = (await listed.json()) as { data?: Array<{ id?: string }> };
      for (const row of json.data ?? []) {
        if (typeof row.id === "string" && row.id.trim()) models.push(row.id);
      }
    } else if (listed.status !== 404) {
      return finish({
        ok: false,
        transport: "unknown",
        models,
        capabilities,
        error: await readError(listed, secrets),
        errorCategory: "http",
      });
    } else {
      // Some compatible servers do not implement /models. Chat or responses still has to succeed.
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return finish({
      ok: false,
      transport: "unknown",
      models,
      capabilities,
      error: redactSecrets(error instanceof Error ? error.message : "probe failed", secrets),
      errorCategory: aborted ? "timeout" : "network",
    });
  }

  const tryChat = input.transport !== "responses";
  const tryResponses = input.transport !== "chat_completions";

  if (tryChat) {
    const chat = await probeChat(call, headers, input.model, secrets);
    capabilities.chatCompletions = chat.ok;
    capabilities.tools = chat.tools;
    capabilities.streaming = chat.streaming;
    capabilities.structuredOutput = chat.structured;
    if (chat.authFailed) {
      return finish({
        ok: false,
        transport: "unknown",
        models,
        capabilities: { ...capabilities, auth: false },
        error: chat.error,
        errorCategory: "auth",
      });
    }
    if (!chat.ok && input.transport === "chat_completions") {
      return finish({
        ok: false,
        transport: "unknown",
        models,
        capabilities,
        error: chat.error,
        errorCategory: chat.category,
      });
    }
  }

  if (tryResponses) {
    const responses = await probeResponses(call, headers, input.model, secrets);
    capabilities.responses = responses.ok;
    if (responses.authFailed) {
      return finish({
        ok: false,
        transport: "unknown",
        models,
        capabilities: { ...capabilities, auth: false },
        error: responses.error,
        errorCategory: "auth",
      });
    }
  }

  if (capabilities.chatCompletions || capabilities.responses) capabilities.auth = true;
  const transport: DetectedTransport = capabilities.chatCompletions
    ? "chat_completions"
    : capabilities.responses
      ? "responses"
      : "unknown";
  const ok = transport !== "unknown";
  return finish({
    ok,
    transport,
    models,
    capabilities,
    error: ok ? null : "endpoint did not accept chat completions or responses",
    errorCategory: ok ? null : "unsupported_transport",
  });
}

async function probeChat(
  call: (path: string, init: RequestInit) => Promise<Response>,
  headers: Record<string, string>,
  model: string,
  secrets: string[],
): Promise<{
  ok: boolean;
  tools: boolean;
  streaming: boolean;
  structured: boolean;
  authFailed: boolean;
  error: string | null;
  category: string | null;
}> {
  const withTools = await call("/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with the single word pong." }],
      max_tokens: 8,
      tools: [
        {
          type: "function",
          function: { name: "ping", description: "noop", parameters: { type: "object", properties: {} } },
        },
      ],
    }),
  });
  if (withTools.status === 401 || withTools.status === 403) {
    return { ok: false, tools: false, streaming: false, structured: false, authFailed: true, error: await readError(withTools, secrets), category: "auth" };
  }
  let ok = withTools.ok;
  let tools = withTools.ok;
  let error: string | null = withTools.ok ? null : await readError(withTools, secrets);
  if (!withTools.ok && withTools.status === 400) {
    const plain = await call("/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with the single word pong." }],
        max_tokens: 8,
      }),
    });
    ok = plain.ok;
    tools = false;
    error = plain.ok ? null : await readError(plain, secrets);
    if (!plain.ok && plain.status !== 400) {
      return { ok: false, tools: false, streaming: false, structured: false, authFailed: false, error, category: "http" };
    }
  } else if (!withTools.ok) {
    return { ok: false, tools: false, streaming: false, structured: false, authFailed: false, error, category: withTools.status >= 500 ? "http" : "malformed" };
  }

  if (!ok) {
    return { ok: false, tools, streaming: false, structured: false, authFailed: false, error, category: "http" };
  }

  const streamed = await call("/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "pong" }],
      max_tokens: 4,
      stream: true,
    }),
  });
  const streaming = streamed.ok && (streamed.headers.get("content-type") ?? "").includes("text/event-stream");
  await streamed.body?.cancel().catch(() => undefined);

  const structuredResponse = await call("/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Return JSON." }],
      max_tokens: 8,
      response_format: { type: "json_object" },
    }),
  });
  return {
    ok: true,
    tools,
    streaming,
    structured: structuredResponse.ok,
    authFailed: false,
    error: null,
    category: null,
  };
}

async function probeResponses(
  call: (path: string, init: RequestInit) => Promise<Response>,
  headers: Record<string, string>,
  model: string,
  secrets: string[],
): Promise<{ ok: boolean; authFailed: boolean; error: string | null }> {
  const response = await call("/responses", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      input: "Reply with the single word pong.",
      max_output_tokens: 8,
    }),
  });
  if (response.status === 401 || response.status === 403) {
    return { ok: false, authFailed: true, error: await readError(response, secrets) };
  }
  if (response.status === 404) return { ok: false, authFailed: false, error: null };
  if (!response.ok) return { ok: false, authFailed: false, error: await readError(response, secrets) };
  return { ok: true, authFailed: false, error: null };
}
