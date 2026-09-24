/**
 * Threads transport — Meta Threads Graph API, current official contract
 * (developers.facebook.com/docs/threads/posts, insights, profiles, get-access-tokens).
 *
 * Host/version are centralized. Official publish examples use
 * `https://graph.threads.net/v1.0/{threads-user-id}/threads` then
 * `.../threads_publish`. OAuth token exchange uses `https://graph.threads.com`.
 *
 * Provider idempotency: none is documented for create-container or publish.
 * Duplicate suppression is ContentForge Publication identity + the single-flight
 * lease. A listing miss is never treated as proof of absence.
 */

import { storage } from "../storage";

export const THREADS_OAUTH_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_insights",
] as const;

/** Official single-post text limit: 500 characters; emojis count as UTF-8 bytes. */
export const THREADS_TEXT_LIMIT = 500;

export const THREADS_INSIGHT_METRICS = [
  "views",
  "likes",
  "replies",
  "reposts",
  "quotes",
  "shares",
] as const;

type ThreadsConfig = {
  graphBase: string;
  token: string;
  userId: string;
};

export function getThreadsApiVersion(): string {
  return (process.env.THREADS_API_VERSION?.trim() || "v1.0").replace(/^\/+|\/+$/g, "");
}

export function getThreadsGraphBaseUrl(): string {
  const host = (process.env.THREADS_API_BASE_URL?.trim() || "https://graph.threads.net").replace(/\/+$/, "");
  return `${host}/${getThreadsApiVersion()}`;
}

export function getThreadsOAuthHost(): string {
  return (process.env.THREADS_OAUTH_HOST?.trim() || "https://graph.threads.com").replace(/\/+$/, "");
}

export function getThreadsAuthorizeUrl(): string {
  return (process.env.THREADS_AUTHORIZE_URL?.trim() || "https://threads.com/oauth/authorize").replace(/\/+$/, "");
}

function timeoutMs(): number {
  return Number(process.env.THREADS_TIMEOUT_MS ?? 30_000);
}

/**
 * Official limit: 500 characters, with emojis counted as UTF-8 bytes (Meta
 * Threads Posts docs, "Limitations" / media_type=TEXT). ASCII is 1 per
 * character; non-ASCII contributes Buffer.byteLength.
 */
export function threadsTextWeight(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp <= 0x7f ? 1 : Buffer.byteLength(ch, "utf8");
  }
  return n;
}

export function validateThreadsText(text: string): string | null {
  if (!text.trim()) return "threads text is empty";
  const weight = threadsTextWeight(text);
  if (weight > THREADS_TEXT_LIMIT) {
    return `threads text exceeds ${THREADS_TEXT_LIMIT} (weighted length ${weight}; emojis count as UTF-8 bytes)`;
  }
  return null;
}

export function redactThreadsSecrets(text: string): string {
  return text
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/client_secret=[^&\s]+/gi, "client_secret=[redacted]");
}

export function translateThreadsError(body: string): string {
  const redacted = redactThreadsSecrets(body);
  if (redacted.includes("THREADS_CONFIG_MISSING")) {
    return "Threads credentials missing: set THREADS_ACCESS_TOKEN and THREADS_USER_ID, or connect a Threads account.";
  }
  if (/THREADS_PUBLISH_ID_MISSING|THREADS_CONTAINER_ID_MISSING/i.test(redacted)) {
    return "Threads accepted the request but did not return an id.";
  }
  if (/ACCESS_DENIED|invalid.*token|OAuthException|401/i.test(redacted)) {
    return "Threads credentials expired or invalid. Reconnect Threads.";
  }
  if (/throttl|429|rate limit|code.?4\b/i.test(redacted)) return "Threads API rate limit reached. Try again later.";
  return redacted;
}

/**
 * Create-container or publish was sent and the outcome is not decisive.
 * `hint` is stored on Result.metrics for reconciliation (creation_id and/or text).
 */
export class ThreadsPublishAmbiguousError extends Error {
  constructor(
    readonly hint: {
      text: string;
      attemptedAt: string;
      creationId?: string;
    },
    message: string,
  ) {
    super(redactThreadsSecrets(message));
    this.name = "ThreadsPublishAmbiguousError";
  }
}

export type ThreadsPostResult = { mediaId: string; url: string | null; creationId: string };

export type ThreadsReconcileStatus =
  | { status: "success"; mediaId: string; url: string | null }
  | { status: "absent"; message: string }
  | { status: "pending" };

export type ThreadsInsightMap = {
  views?: number;
  likes?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
  shares?: number;
};

export function parseGraphId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function parseThreadsInsights(payload: unknown): ThreadsInsightMap {
  const out: ThreadsInsightMap = {};
  if (!payload || typeof payload !== "object") return out;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return out;
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const name = (row as { name?: unknown }).name;
    if (typeof name !== "string") continue;
    if (!(THREADS_INSIGHT_METRICS as readonly string[]).includes(name)) continue;
    const values = (row as { values?: unknown }).values;
    const first = Array.isArray(values) ? values[0] : null;
    const value =
      first && typeof first === "object" ? (first as { value?: unknown }).value : (row as { value?: unknown }).value;
    const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) continue;
    (out as Record<string, number>)[name] = n;
  }
  return out;
}

export function unmappedThreadsMetrics(source: ThreadsInsightMap): Record<string, number> {
  const extra: Record<string, number> = {};
  if (typeof source.quotes === "number") extra.quotes = source.quotes;
  if (typeof source.shares === "number" && typeof source.reposts === "number") {
    extra.reposts = source.reposts;
  }
  return extra;
}

export function buildCreateTextContainerBody(text: string): URLSearchParams {
  const body = new URLSearchParams();
  body.set("media_type", "TEXT");
  body.set("text", text);
  return body;
}

export function buildPublishContainerBody(creationId: string): URLSearchParams {
  const body = new URLSearchParams();
  body.set("creation_id", creationId);
  return body;
}

export function threadsAuthorizationUrl(state?: string): string | null {
  const clientId = process.env.THREADS_APP_ID?.trim();
  const redirectUri = process.env.THREADS_CALLBACK_URL?.trim() || process.env.THREADS_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: THREADS_OAUTH_SCOPES.join(","),
    response_type: "code",
  });
  if (state) params.set("state", state);
  return `${getThreadsAuthorizeUrl()}?${params.toString()}`;
}

export async function getThreadsConfigSummary(ownerUserId?: number | null): Promise<Record<string, unknown>> {
  const envToken = ownerUserId == null && Boolean(process.env.THREADS_ACCESS_TOKEN?.trim());
  const account = ownerUserId == null
    ? await storage.getConnectedAccount("threads")
    : await storage.getConnectedAccountForOwner("threads", ownerUserId);
  return {
    graphBase: getThreadsGraphBaseUrl(),
    apiVersion: getThreadsApiVersion(),
    oauthHost: getThreadsOAuthHost(),
    scopes: [...THREADS_OAUTH_SCOPES],
    envTokenConfigured: envToken,
    connectedUsername: account?.username ?? null,
    connectedUserId: account?.userId ?? null,
    authorizationUrlReady: Boolean(threadsAuthorizationUrl()),
    providerIdempotency: false,
  };
}

async function getThreadsConfig(ownerUserId?: number | null): Promise<ThreadsConfig | null> {
  const envToken = ownerUserId == null ? process.env.THREADS_ACCESS_TOKEN?.trim() || null : null;
  const envUser = ownerUserId == null ? process.env.THREADS_USER_ID?.trim() || "me" : null;
  if (envToken) {
    return { graphBase: getThreadsGraphBaseUrl(), token: envToken, userId: envUser! };
  }
  if (ownerUserId != null) {
    const owned = await storage.getConnectedAccountForOwner("threads", ownerUserId);
    const token = owned?.accessToken?.trim() || null;
    const userId = owned?.username?.trim() || "me";
    if (!token) return null;
    return { graphBase: getThreadsGraphBaseUrl(), token, userId };
  }
  const account = await storage.getConnectedAccount("threads");
  const token = account?.accessToken?.trim() || null;
  const userId = account?.username?.trim() || "me";
  if (!token) return null;
  return { graphBase: getThreadsGraphBaseUrl(), token, userId };
}

function withToken(body: URLSearchParams, token: string): URLSearchParams {
  const copy = new URLSearchParams(body);
  copy.set("access_token", token);
  return copy;
}

async function graphJson(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs()) });
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

function graphErrorMessage(status: number, json: unknown, text: string): string {
  const err =
    json && typeof json === "object" && "error" in json
      ? (json as { error?: { message?: unknown; code?: unknown } }).error
      : null;
  const message =
    err && typeof err.message === "string"
      ? err.message
      : text || `Threads API returned HTTP ${status}`;
  return redactThreadsSecrets(message);
}

export async function verifyThreadsAccessToken(token: string): Promise<{
  id: string;
  username: string | null;
  name: string | null;
} | null> {
  const graphBase = getThreadsGraphBaseUrl();
  const params = new URLSearchParams({
    fields: "id,username,name",
    access_token: token,
  });
  const { ok, json } = await graphJson(`${graphBase}/me?${params}`, { method: "GET" });
  if (!ok || !json || typeof json !== "object") return null;
  const id = parseGraphId(json);
  if (!id) return null;
  const username = typeof (json as { username?: unknown }).username === "string" ? (json as { username: string }).username : null;
  const name = typeof (json as { name?: unknown }).name === "string" ? (json as { name: string }).name : null;
  return { id, username, name };
}

export async function fetchThreadsProfile(ownerUserId?: number | null): Promise<{
  id: string;
  username: string | null;
  name: string | null;
} | null> {
  const config = await getThreadsConfig(ownerUserId);
  if (!config) return null;
  const params = new URLSearchParams({
    fields: "id,username,name",
    access_token: config.token,
  });
  const { ok, json } = await graphJson(`${config.graphBase}/me?${params}`, { method: "GET" });
  if (!ok || !json || typeof json !== "object") return null;
  const id = parseGraphId(json);
  if (!id) return null;
  const username = typeof (json as { username?: unknown }).username === "string" ? (json as { username: string }).username : null;
  const name = typeof (json as { name?: unknown }).name === "string" ? (json as { name: string }).name : null;
  return { id, username, name };
}

export async function postTextToThreads(
  text: string,
  ownerUserId?: number | null,
): Promise<ThreadsPostResult> {
  const invalid = validateThreadsText(text);
  if (invalid) throw new Error(invalid);

  const config = await getThreadsConfig(ownerUserId);
  if (!config) throw new Error("THREADS_CONFIG_MISSING");

  const attemptedAt = new Date().toISOString();
  const createUrl = `${config.graphBase}/${encodeURIComponent(config.userId)}/threads`;

  let created: { ok: boolean; status: number; json: unknown; text: string };
  try {
    created = await graphJson(createUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: withToken(buildCreateTextContainerBody(text), config.token).toString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ThreadsPublishAmbiguousError(
      { text, attemptedAt },
      `Threads container create transport failed before a response arrived: ${message}`,
    );
  }

  if (!created.ok) {
    const message = graphErrorMessage(created.status, created.json, created.text);
    if (created.status === 429 || created.status >= 500) {
      throw new Error(`${created.status} ${message}`);
    }
    throw new Error(message);
  }

  const creationId = parseGraphId(created.json);
  if (!creationId) throw new Error("THREADS_CONTAINER_ID_MISSING");

  const publishUrl = `${config.graphBase}/${encodeURIComponent(config.userId)}/threads_publish`;
  let published: { ok: boolean; status: number; json: unknown; text: string };
  try {
    published = await graphJson(publishUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: withToken(buildPublishContainerBody(creationId), config.token).toString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ThreadsPublishAmbiguousError(
      { text, attemptedAt, creationId },
      `Threads publish transport failed after container ${creationId}: ${message}`,
    );
  }

  if (!published.ok) {
    const message = graphErrorMessage(published.status, published.json, published.text);
    if (published.status === 429 || published.status >= 500) {
      throw new ThreadsPublishAmbiguousError(
        { text, attemptedAt, creationId },
        `Threads publish returned HTTP ${published.status} after container create: ${message}`,
      );
    }
    throw new Error(message);
  }

  const mediaId = parseGraphId(published.json);
  if (!mediaId) {
    throw new ThreadsPublishAmbiguousError(
      { text, attemptedAt, creationId },
      "THREADS_PUBLISH_ID_MISSING",
    );
  }
  return {
    mediaId,
    creationId,
    url: `https://www.threads.net/post/${mediaId}`,
  };
}

async function getContainerStatus(
  config: ThreadsConfig,
  creationId: string,
): Promise<{ status: string; id: string | null } | null> {
  const params = new URLSearchParams({
    fields: "status,error_message,id",
    access_token: config.token,
  });
  const { ok, status, json } = await graphJson(`${config.graphBase}/${encodeURIComponent(creationId)}?${params}`, {
    method: "GET",
  });
  if (status === 404) return { status: "NOT_FOUND", id: null };
  if (!ok || !json || typeof json !== "object") return null;
  const st = typeof (json as { status?: unknown }).status === "string" ? (json as { status: string }).status : "";
  return { status: st || "UNKNOWN", id: parseGraphId(json) };
}

async function getMedia(
  config: ThreadsConfig,
  mediaId: string,
): Promise<{ id: string; permalink: string | null; text: string | null } | null> {
  const params = new URLSearchParams({
    fields: "id,permalink,text",
    access_token: config.token,
  });
  const { ok, status, json } = await graphJson(`${config.graphBase}/${encodeURIComponent(mediaId)}?${params}`, {
    method: "GET",
  });
  if (status === 404 || !ok) return null;
  const id = parseGraphId(json);
  if (!id) return null;
  const permalink =
    json && typeof json === "object" && typeof (json as { permalink?: unknown }).permalink === "string"
      ? (json as { permalink: string }).permalink
      : null;
  const text =
    json && typeof json === "object" && typeof (json as { text?: unknown }).text === "string"
      ? (json as { text: string }).text
      : null;
  return { id, permalink, text };
}

/**
 * User-media listing is not a completeness proof. A miss is always `pending`.
 */
async function findPublishedByText(
  config: ThreadsConfig,
  hint: { text: string; attemptedAt: string },
): Promise<ThreadsReconcileStatus> {
  const params = new URLSearchParams({
    fields: "id,text,timestamp,permalink",
    limit: "10",
    access_token: config.token,
  });
  const { ok, json } = await graphJson(
    `${config.graphBase}/${encodeURIComponent(config.userId)}/threads?${params}`,
    { method: "GET" },
  );
  if (!ok || !json || typeof json !== "object") return { status: "pending" };
  const data = Array.isArray((json as { data?: unknown }).data) ? ((json as { data: Array<Record<string, unknown>> }).data) : [];
  const attemptedAtMs = Date.parse(hint.attemptedAt);
  for (const element of data) {
    if (element.text !== hint.text) continue;
    const ts = typeof element.timestamp === "string" ? Date.parse(element.timestamp) : NaN;
    if (Number.isFinite(ts) && Number.isFinite(attemptedAtMs) && ts + 60_000 < attemptedAtMs) continue;
    const mediaId = typeof element.id === "string" ? element.id : null;
    if (!mediaId) continue;
    const permalink = typeof element.permalink === "string" ? element.permalink : `https://www.threads.net/post/${mediaId}`;
    return { status: "success", mediaId, url: permalink };
  }
  return { status: "pending" };
}

export async function reconcileThreadsPost(
  hint: { text?: string; attemptedAt?: string; creationId?: string; externalId?: string },
  ownerUserId?: number | null,
): Promise<ThreadsReconcileStatus | null> {
  const config = await getThreadsConfig(ownerUserId);
  if (!config) return null;

  if (hint.externalId) {
    const media = await getMedia(config, hint.externalId);
    if (media) {
      return { status: "success", mediaId: media.id, url: media.permalink ?? `https://www.threads.net/post/${media.id}` };
    }
    // 404 / miss is not proof of absence.
    return { status: "pending" };
  }

  if (hint.creationId) {
    const container = await getContainerStatus(config, hint.creationId);
    if (!container) return { status: "pending" };
    if (container.status === "ERROR" || container.status === "EXPIRED") {
      return {
        status: "absent",
        message: `Threads container ${hint.creationId} status=${container.status}`,
      };
    }
  }

  if (hint.text && hint.attemptedAt) {
    const listed = await findPublishedByText(config, { text: hint.text, attemptedAt: hint.attemptedAt });
    if (listed.status === "success") return listed;
  }

  return { status: "pending" };
}

export async function fetchThreadsInsights(
  mediaId: string,
  ownerUserId?: number | null,
): Promise<{ ok: true; retrievedAt: Date; insights: ThreadsInsightMap } | { ok: false; status: number; message: string; retrievedAt: Date }> {
  const retrievedAt = new Date();
  const config = await getThreadsConfig(ownerUserId);
  if (!config) {
    return { ok: false, status: 401, message: "THREADS_CONFIG_MISSING", retrievedAt };
  }
  const params = new URLSearchParams({
    metric: THREADS_INSIGHT_METRICS.join(","),
    access_token: config.token,
  });
  try {
    const res = await graphJson(`${config.graphBase}/${encodeURIComponent(mediaId)}/insights?${params}`, {
      method: "GET",
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: graphErrorMessage(res.status, res.json, res.text),
        retrievedAt,
      };
    }
    return { ok: true, retrievedAt, insights: parseThreadsInsights(res.json) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, message: redactThreadsSecrets(message), retrievedAt };
  }
}
