/**
 * YouTube Data API v3 publishing transport — ChannelAdapter boundary only.
 *
 * Official resumable upload:
 *   https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 *   https://developers.google.com/youtube/v3/docs/videos/insert
 *
 * OAuth (server-side web apps, offline):
 *   https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
 * Scopes: youtube.upload + youtube.readonly (reconcile / channel discovery).
 * Provider-side idempotency: none for videos.insert — ContentForge Publication
 * identity is authoritative.
 *
 * Tokens never log. Real *upload* calls to googleapis.com require
 * CONTENTFORGE_REAL_PUBLISH_E2E=1. OAuth code exchange, token refresh, and
 * channels.list do not require that gate.
 */

import { storage } from "../storage";
import type { PublishMedia } from "../content/adapters";
import { looksLikeMp4 } from "../content/visual";
import {
  assertRealPublishAllowed,
  assertYouTubeCertificationPublish,
  recordYouTubeCertificationPublish,
  YOUTUBE_PUBLISH_CERT_KEY,
} from "../content/publishCertification";

export const YOUTUBE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;

export const YOUTUBE_DEFAULT_CALLBACK_PATH = "/api/social/youtube/callback";

export const YOUTUBE_MAX_BYTES = 256 * 1024 * 1024; // Phase 28.1 soft cap (API allows more)
export const YOUTUBE_MIN_DURATION_MS = 1_000;
export const YOUTUBE_TITLE_MAX = 100;
export const YOUTUBE_DESCRIPTION_MAX = 5_000;
export const YOUTUBE_PRIVACY = new Set(["private", "unlisted", "public"]);

type FetchLike = typeof fetch;

export type YouTubeConfig = {
  accessToken: string;
  refreshToken: string | null;
  clientId: string | null;
  clientSecret: string | null;
  tokenUri: string;
  apiBase: string;
  uploadBase: string;
};

export type YouTubeUploadResult = {
  videoId: string;
  url: string;
  privacyStatus: string;
  title: string;
};

export class YouTubePublishAmbiguousError extends Error {
  readonly hint: {
    title: string;
    attemptedAt: string;
    uploadSessionUrl?: string;
    videoId?: string;
  };

  constructor(hint: YouTubePublishAmbiguousError["hint"], message: string) {
    super(message);
    this.name = "YouTubePublishAmbiguousError";
    this.hint = hint;
  }
}

export function getYouTubeApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return (env.YOUTUBE_API_BASE_URL?.trim() || "https://www.googleapis.com/youtube/v3").replace(/\/+$/, "");
}

export function getYouTubeUploadBase(env: NodeJS.ProcessEnv = process.env): string {
  return (env.YOUTUBE_UPLOAD_BASE_URL?.trim() || "https://www.googleapis.com/upload/youtube/v3").replace(/\/+$/, "");
}

export function getYouTubeTokenUri(env: NodeJS.ProcessEnv = process.env): string {
  return (env.YOUTUBE_TOKEN_URI?.trim() || "https://oauth2.googleapis.com/token").replace(/\/+$/, "");
}

export function getYouTubeAuthorizeUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.YOUTUBE_AUTHORIZE_URL?.trim() || "https://accounts.google.com/o/oauth2/v2/auth").replace(/\/+$/, "");
}

export function youtubeClientId(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.YOUTUBE_CLIENT_ID?.trim() || env.GOOGLE_CLIENT_ID?.trim() || null;
}

export function youtubeClientSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.YOUTUBE_CLIENT_SECRET?.trim() || env.GOOGLE_CLIENT_SECRET?.trim() || null;
}

/**
 * Exact redirect URI registered in Google Cloud Console.
 * Never accepted from request query/body — only env or derived from known
 * public base / Google login callback origin.
 */
export function getYouTubeRedirectUri(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.YOUTUBE_CALLBACK_URL?.trim() || env.YOUTUBE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base = env.APP_URL?.trim()
    || env.PUBLIC_URL?.trim()
    || env.CONTENTFORGE_PUBLIC_URL?.trim()
    || env.CONTENTFORGE_PUBLIC_BASE_URL?.trim();
  if (base) return `${base.replace(/\/+$/, "")}${YOUTUBE_DEFAULT_CALLBACK_PATH}`;
  const googleCb = env.GOOGLE_CALLBACK_URL?.trim();
  if (googleCb) {
    try {
      return `${new URL(googleCb).origin}${YOUTUBE_DEFAULT_CALLBACK_PATH}`;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function googleOAuthClientConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(youtubeClientId(env) && youtubeClientSecret(env));
}

export function redactYouTubeSecrets(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/refresh_token=[^&\s]+/gi, "refresh_token=[redacted]")
    .replace(/client_secret=[^&\s]+/gi, "client_secret=[redacted]");
}

function scopesCoverRequired(scopes: unknown): boolean {
  if (!Array.isArray(scopes)) return false;
  const set = new Set(scopes.filter((s): s is string => typeof s === "string"));
  return YOUTUBE_OAUTH_SCOPES.every((required) => set.has(required));
}

export function translateYouTubeError(body: string): string {
  const redacted = redactYouTubeSecrets(body);
  if (redacted.includes("YOUTUBE_CONFIG_MISSING")) {
    return "YouTube credentials missing: connect a YouTube account or set YOUTUBE_ACCESS_TOKEN / YOUTUBE_REFRESH_TOKEN with YOUTUBE_CLIENT_ID (or GOOGLE_CLIENT_ID).";
  }
  if (redacted.includes("YOUTUBE_REAL_PUBLISH_BLOCKED")) {
    return "YouTube real publication is blocked without CONTENTFORGE_REAL_PUBLISH_E2E=1.";
  }
  if (/invalid_grant|invalid.?token|401|UNAUTHENTICATED/i.test(redacted)) {
    return "YouTube credentials expired or invalid. Reconnect YouTube with upload scopes.";
  }
  if (/403|quotaExceeded|dailyLimitExceeded/i.test(redacted)) {
    return "YouTube API quota exceeded or upload forbidden for this credential.";
  }
  if (/429|rateLimit/i.test(redacted)) return "YouTube API rate limit reached. Try again later.";
  return redacted.slice(0, 400);
}

export function youtubeAuthorizationUrl(state?: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const clientId = youtubeClientId(env);
  const redirectUri = getYouTubeRedirectUri(env);
  if (!clientId || !redirectUri) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: YOUTUBE_OAUTH_SCOPES.join(" "),
  });
  if (state) params.set("state", state);
  return `${getYouTubeAuthorizeUrl(env)}?${params.toString()}`;
}

export type YouTubeStatusSummary = {
  apiBase: string;
  uploadBase: string;
  scopes: readonly string[];
  redirectUri: string | null;
  clientConfigured: boolean;
  authorizationUrlReady: boolean;
  accountConnected: boolean;
  refreshCredentialPresent: boolean;
  accessCredentialPresent: boolean;
  requiredScopesPresent: boolean;
  tokenRefreshPossible: boolean;
  channelDiscovered: boolean;
  channelId: string | null;
  channelTitle: string | null;
  connectedUsername: string | null;
  connectedUserId: number | null;
  envTokenConfigured: boolean;
  publicationReady: boolean;
  ready: boolean;
  providerIdempotency: false;
  supportedFormats: string[];
  defaultPrivacy: string;
  realPublishGate: string;
};

export async function getYouTubeConfigSummary(
  ownerUserId?: number | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<YouTubeStatusSummary> {
  const envAccess = Boolean(env.YOUTUBE_ACCESS_TOKEN?.trim());
  const envRefresh = Boolean(env.YOUTUBE_REFRESH_TOKEN?.trim());
  const account = ownerUserId != null
    ? await storage.getConnectedAccountForOwner("youtube", ownerUserId)
    : await storage.getConnectedAccount("youtube");

  const profile = (account?.profileData && typeof account.profileData === "object")
    ? account.profileData as Record<string, unknown>
    : {};
  const channelId = typeof profile.channelId === "string"
    ? profile.channelId
    : (account?.username?.startsWith("UC") ? account.username : null);
  const channelTitle = typeof profile.title === "string"
    ? profile.title
    : (account?.displayName ?? null);
  const requiredScopesPresent = scopesCoverRequired(profile.scopes);

  const refreshCredentialPresent = Boolean(account?.refreshToken?.trim() || (ownerUserId == null ? envRefresh : false));
  const accessCredentialPresent = Boolean(account?.accessToken?.trim() || (ownerUserId == null ? envAccess : false));
  const clientConfigured = googleOAuthClientConfigured(env);
  const redirectUri = getYouTubeRedirectUri(env);
  const accountConnected = Boolean(
    account
    && account.isActive !== false
    && (account.accessToken || account.refreshToken),
  );
  const channelDiscovered = Boolean(channelId);
  const tokenRefreshPossible = refreshCredentialPresent && clientConfigured;
  const publicationReady = clientConfigured
    && (accountConnected || (ownerUserId == null && (envAccess || envRefresh)))
    && refreshCredentialPresent
    && requiredScopesPresent
    && channelDiscovered
    && tokenRefreshPossible;

  return {
    apiBase: getYouTubeApiBase(env),
    uploadBase: getYouTubeUploadBase(env),
    scopes: [...YOUTUBE_OAUTH_SCOPES],
    redirectUri,
    clientConfigured,
    authorizationUrlReady: Boolean(youtubeAuthorizationUrl("probe", env)),
    accountConnected,
    refreshCredentialPresent,
    accessCredentialPresent,
    requiredScopesPresent,
    tokenRefreshPossible,
    channelDiscovered,
    channelId,
    channelTitle,
    connectedUsername: account?.username ?? null,
    connectedUserId: account?.userId ?? null,
    envTokenConfigured: ownerUserId == null && Boolean(envAccess || envRefresh),
    publicationReady,
    ready: publicationReady,
    providerIdempotency: false,
    supportedFormats: ["video"],
    defaultPrivacy: env.YOUTUBE_DEFAULT_PRIVACY?.trim() || "private",
    realPublishGate: "CONTENTFORGE_REAL_PUBLISH_E2E=1",
  };
}

export async function getYouTubeConfig(
  ownerUserId?: number | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<YouTubeConfig | null> {
  const clientId = youtubeClientId(env);
  const clientSecret = youtubeClientSecret(env);
  const tokenUri = getYouTubeTokenUri(env);
  const apiBase = getYouTubeApiBase(env);
  const uploadBase = getYouTubeUploadBase(env);

  // Canonical runtime path: connected_accounts for the owner.
  if (ownerUserId != null) {
    const account = await storage.getConnectedAccountForOwner("youtube", ownerUserId);
    const accessToken = account?.accessToken?.trim() || "";
    const refreshToken = account?.refreshToken?.trim() || null;
    if (accessToken || refreshToken) {
      return {
        accessToken,
        refreshToken,
        clientId,
        clientSecret,
        tokenUri,
        apiBase,
        uploadBase,
      };
    }
  }

  // Ops / certification fallback: process env tokens. These are deployment-level
  // operator credentials, not another tenant's row, so they stay a valid fallback
  // behind the owner's own connected account.
  const envAccess = env.YOUTUBE_ACCESS_TOKEN?.trim() || null;
  const envRefresh = env.YOUTUBE_REFRESH_TOKEN?.trim() || null;
  if (envAccess || envRefresh) {
    return {
      accessToken: envAccess || "",
      refreshToken: envRefresh,
      clientId,
      clientSecret,
      tokenUri,
      apiBase,
      uploadBase,
    };
  }

  if (ownerUserId != null) return null;

  // Unscoped connected account (legacy single-tenant).
  if (ownerUserId == null) {
    const account = await storage.getConnectedAccount("youtube");
    const accessToken = account?.accessToken?.trim() || "";
    const refreshToken = account?.refreshToken?.trim() || null;
    if (!accessToken && !refreshToken) return null;
    return {
      accessToken,
      refreshToken,
      clientId,
      clientSecret,
      tokenUri,
      apiBase,
      uploadBase,
    };
  }

  return null;
}

export function validateYouTubeTitle(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return "youtube title is required";
  if (trimmed.length > YOUTUBE_TITLE_MAX) {
    return `youtube title exceeds ${YOUTUBE_TITLE_MAX} characters`;
  }
  return null;
}

export function validateYouTubeDescription(description: string): string | null {
  if (description.length > YOUTUBE_DESCRIPTION_MAX) {
    return `youtube description exceeds ${YOUTUBE_DESCRIPTION_MAX} characters`;
  }
  return null;
}

export function validateYouTubePrivacy(privacy: string): string | null {
  if (!YOUTUBE_PRIVACY.has(privacy)) {
    return `youtube privacyStatus must be private|unlisted|public (got ${privacy})`;
  }
  return null;
}

export function validateYouTubeVideoMedia(media: PublishMedia): string | null {
  if (media.kind && media.kind !== "video") {
    return `youtube requires a video asset (got ${media.kind})`;
  }
  if (media.mime !== "video/mp4") {
    return `youtube Phase 28.1 requires video/mp4 (got ${media.mime})`;
  }
  if (!looksLikeMp4(media.bytes)) return "youtube video bytes are missing a valid ftyp box";
  const size = media.byteSize ?? media.bytes.length;
  if (size <= 0) return "youtube video is empty";
  if (size > YOUTUBE_MAX_BYTES) {
    return `youtube video exceeds ${YOUTUBE_MAX_BYTES} bytes`;
  }
  const duration = media.durationMs ?? null;
  if (duration !== null && duration < YOUTUBE_MIN_DURATION_MS) {
    return `youtube video duration ${duration}ms is below ${YOUTUBE_MIN_DURATION_MS}ms`;
  }
  return null;
}

function isGoogleHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "www.googleapis.com"
      || host === "googleapis.com"
      || host === "oauth2.googleapis.com"
      || host.endsWith(".googleapis.com")
      || host === "www.youtube.com"
      || host === "youtube.com";
  } catch {
    return false;
  }
}

/** Only media upload paths require the real-publish gate — not OAuth/token/channel GETs. */
export function youtubeUrlRequiresRealPublishGate(url: string): boolean {
  try {
    const u = new URL(url);
    if (!isGoogleHost(url)) return false;
    if (u.pathname.includes("/upload/youtube")) return true;
    if (u.pathname.includes("/youtube/v3/videos") && u.searchParams.get("uploadType") === "resumable") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function refreshAccessToken(
  config: YouTubeConfig,
  fetchImpl: FetchLike,
  _env: NodeJS.ProcessEnv,
): Promise<string> {
  if (!config.refreshToken || !config.clientId || !config.clientSecret) {
    throw new Error("YOUTUBE_CONFIG_MISSING: refresh requires refresh_token + client id/secret");
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetchImpl(config.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`YouTube token refresh failed (${res.status}): ${redactYouTubeSecrets(text)}`);
  }
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("YouTube token refresh returned non-JSON");
  }
  const access = typeof json.access_token === "string" ? json.access_token : null;
  if (!access) throw new Error("YouTube token refresh missing access_token");
  return access;
}

async function authorizedFetch(
  config: YouTubeConfig,
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
  env: NodeJS.ProcessEnv,
): Promise<Response> {
  if (youtubeUrlRequiresRealPublishGate(url)) {
    assertRealPublishAllowed("youtube", env);
  }

  let token = config.accessToken;
  if (!token && config.refreshToken) {
    token = await refreshAccessToken(config, fetchImpl, env);
    config.accessToken = token;
  }
  if (!token) throw new Error("YOUTUBE_CONFIG_MISSING");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  let res = await fetchImpl(url, { ...init, headers });
  if (res.status === 401 && config.refreshToken) {
    token = await refreshAccessToken(config, fetchImpl, env);
    config.accessToken = token;
    headers.set("Authorization", `Bearer ${token}`);
    res = await fetchImpl(url, { ...init, headers });
  }
  return res;
}

export function titleFromPayload(payload: Record<string, unknown>): string {
  if (typeof payload.title === "string" && payload.title.trim()) return payload.title.trim();
  if (typeof payload.subject === "string" && payload.subject.trim()) return payload.subject.trim().slice(0, YOUTUBE_TITLE_MAX);
  if (typeof payload.caption === "string" && payload.caption.trim()) {
    return payload.caption.trim().split("\n")[0]!.slice(0, YOUTUBE_TITLE_MAX);
  }
  return "ContentForge certification upload";
}

export function descriptionFromPayload(payload: Record<string, unknown>): string {
  if (typeof payload.description === "string") return payload.description;
  if (typeof payload.caption === "string") return payload.caption;
  return "";
}

export function privacyFromPayload(
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof payload.privacyStatus === "string" && payload.privacyStatus.trim()) {
    return payload.privacyStatus.trim().toLowerCase();
  }
  if (typeof payload.privacy === "string" && payload.privacy.trim()) {
    return payload.privacy.trim().toLowerCase();
  }
  return (env.YOUTUBE_DEFAULT_PRIVACY?.trim() || "private").toLowerCase();
}

export async function uploadVideoToYouTube(
  input: {
    media: PublishMedia;
    title: string;
    description: string;
    privacyStatus: string;
    certificationKey?: string | null;
  },
  ownerUserId?: number | null,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
  } = {},
): Promise<YouTubeUploadResult> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const titleError = validateYouTubeTitle(input.title);
  if (titleError) throw new Error(titleError);
  const descError = validateYouTubeDescription(input.description);
  if (descError) throw new Error(descError);
  const privacyError = validateYouTubePrivacy(input.privacyStatus);
  if (privacyError) throw new Error(privacyError);
  const mediaError = validateYouTubeVideoMedia(input.media);
  if (mediaError) throw new Error(mediaError);

  const config = await getYouTubeConfig(ownerUserId, env);
  if (!config) throw new Error("YOUTUBE_CONFIG_MISSING");

  const certKey = input.certificationKey ?? YOUTUBE_PUBLISH_CERT_KEY;
  assertYouTubeCertificationPublish({
    privacyStatus: input.privacyStatus,
    certKey,
  }, env);

  const attemptedAt = new Date().toISOString();
  const bytes = input.media.bytes;
  const initUrl = `${config.uploadBase}/videos?uploadType=resumable&part=snippet,status`;

  // Consume certification budget before side effect when in cert mode.
  recordYouTubeCertificationPublish(certKey, env);

  let sessionRes: Response;
  try {
    sessionRes = await authorizedFetch(config, initUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(bytes.length),
        Accept: "application/json",
      },
      body: JSON.stringify({
        snippet: {
          title: input.title,
          description: input.description,
          categoryId: "22",
        },
        status: {
          privacyStatus: input.privacyStatus,
          selfDeclaredMadeForKids: false,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    }, fetchImpl, env);
  } catch (error) {
    throw new YouTubePublishAmbiguousError(
      { title: input.title, attemptedAt },
      `YouTube upload session ambiguous: ${error instanceof Error ? error.message : "network"}`,
    );
  }

  if (!sessionRes.ok) {
    const text = await sessionRes.text().catch(() => "");
    throw new Error(`YouTube upload session failed (${sessionRes.status}): ${redactYouTubeSecrets(text)}`);
  }

  const uploadUrl = sessionRes.headers.get("location") || sessionRes.headers.get("Location");
  if (!uploadUrl) {
    throw new YouTubePublishAmbiguousError(
      { title: input.title, attemptedAt },
      "YouTube upload session succeeded without Location header",
    );
  }

  let uploadRes: Response;
  try {
    uploadRes = await authorizedFetch(config, uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(bytes.length),
        Accept: "application/json",
      },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(10 * 60_000),
    }, fetchImpl, env);
  } catch (error) {
    throw new YouTubePublishAmbiguousError(
      { title: input.title, attemptedAt, uploadSessionUrl: uploadUrl },
      `YouTube media upload ambiguous: ${error instanceof Error ? error.message : "network"}`,
    );
  }

  const uploadText = await uploadRes.text().catch(() => "");
  if (!uploadRes.ok) {
    if (uploadRes.status >= 500 || uploadRes.status === 408 || uploadRes.status === 429) {
      throw new YouTubePublishAmbiguousError(
        { title: input.title, attemptedAt, uploadSessionUrl: uploadUrl },
        `YouTube media upload ambiguous (${uploadRes.status}): ${redactYouTubeSecrets(uploadText)}`,
      );
    }
    throw new Error(`YouTube media upload failed (${uploadRes.status}): ${redactYouTubeSecrets(uploadText)}`);
  }

  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(uploadText) as Record<string, unknown>;
  } catch {
    throw new YouTubePublishAmbiguousError(
      { title: input.title, attemptedAt, uploadSessionUrl: uploadUrl },
      "YouTube media upload returned non-JSON after possible side effect",
    );
  }
  const videoId = typeof json.id === "string" ? json.id : null;
  if (!videoId) {
    throw new YouTubePublishAmbiguousError(
      { title: input.title, attemptedAt, uploadSessionUrl: uploadUrl },
      "YouTube media upload succeeded without video id",
    );
  }

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    privacyStatus: input.privacyStatus,
    title: input.title,
  };
}

export async function reconcileYouTubeVideo(
  hint: { videoId?: string; externalId?: string; title?: string; attemptedAt?: string },
  ownerUserId?: number | null,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
  } = {},
): Promise<"published" | "absent" | "unknown"> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const videoId = hint.videoId || hint.externalId;
  if (!videoId) return "unknown";

  const config = await getYouTubeConfig(ownerUserId, env);
  if (!config) return "unknown";

  try {
    const url = `${config.apiBase}/videos?part=id,status,snippet&id=${encodeURIComponent(videoId)}`;
    const res = await authorizedFetch(config, url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    }, fetchImpl, env);
    if (res.status === 404) return "absent";
    if (!res.ok) return "unknown";
    const json = await res.json() as { items?: Array<{ id?: string }> };
    const items = json.items ?? [];
    if (items.some((item) => item.id === videoId)) return "published";
    // Listing miss is not proof of absence for an in-flight upload.
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function exchangeYouTubeAuthorizationCode(
  code: string,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
  } = {},
): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number | null; scope: string | null }> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const clientId = youtubeClientId(env);
  const clientSecret = youtubeClientSecret(env);
  const redirectUri = getYouTubeRedirectUri(env);
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("YOUTUBE_CONFIG_MISSING: client id/secret/callback required for code exchange");
  }
  const tokenUri = getYouTubeTokenUri(env);

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetchImpl(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`YouTube code exchange failed (${res.status}): ${redactYouTubeSecrets(text)}`);
  }
  const json = JSON.parse(text) as Record<string, unknown>;
  const accessToken = typeof json.access_token === "string" ? json.access_token : null;
  if (!accessToken) throw new Error("YouTube code exchange missing access_token");
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : null,
    scope: typeof json.scope === "string" ? json.scope : null,
  };
}

export type YouTubeChannelIdentity = {
  channelId: string;
  title: string | null;
  customUrl: string | null;
};

export async function discoverYouTubeChannel(
  config: YouTubeConfig,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
  } = {},
): Promise<YouTubeChannelIdentity> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${config.apiBase}/channels?part=snippet&mine=true`;
  const res = await authorizedFetch(config, url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  }, fetchImpl, env);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`YouTube channel discovery failed (${res.status}): ${redactYouTubeSecrets(text)}`);
  }
  const json = JSON.parse(text) as {
    items?: Array<{ id?: string; snippet?: { title?: string; customUrl?: string } }>;
  };
  const item = json.items?.[0];
  const channelId = item?.id;
  if (!channelId) {
    throw new Error("YouTube channel discovery returned no channel — ensure the Google account has a YouTube channel");
  }
  return {
    channelId,
    title: item?.snippet?.title ?? null,
    customUrl: item?.snippet?.customUrl ?? null,
  };
}

export type YouTubeOAuthConnectionResult = {
  accountId: number;
  channelId: string;
  channelTitle: string | null;
  refreshTokenPersisted: boolean;
  scopes: string[];
};

/**
 * Exchange OAuth code, persist encrypted credentials on connected_accounts,
 * discover the YouTube channel. Preserves an existing refresh token when Google
 * omits a new one on re-authorization.
 */
export async function completeYouTubeOAuthConnection(
  input: {
    code: string;
    ownerUserId?: number | null;
  },
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
  } = {},
): Promise<YouTubeOAuthConnectionResult> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!googleOAuthClientConfigured(env) || !getYouTubeRedirectUri(env)) {
    throw new Error("BLOCKED — Google OAuth client credentials unavailable");
  }

  const tokens = await exchangeYouTubeAuthorizationCode(input.code, { env, fetchImpl });
  const existing = input.ownerUserId != null
    ? await storage.getConnectedAccountForOwner("youtube", input.ownerUserId)
    : await storage.getConnectedAccount("youtube");

  const refreshToken = tokens.refreshToken ?? existing?.refreshToken ?? null;
  if (!refreshToken) {
    throw new Error(
      "YouTube OAuth did not return a refresh token and none was stored. "
        + "Re-authorize with access_type=offline and prompt=consent, or revoke prior access and retry.",
    );
  }

  const config: YouTubeConfig = {
    accessToken: tokens.accessToken,
    refreshToken,
    clientId: youtubeClientId(env),
    clientSecret: youtubeClientSecret(env),
    tokenUri: getYouTubeTokenUri(env),
    apiBase: getYouTubeApiBase(env),
    uploadBase: getYouTubeUploadBase(env),
  };
  const channel = await discoverYouTubeChannel(config, { env, fetchImpl });

  const grantedScopes = tokens.scope
    ? tokens.scope.split(/\s+/).filter(Boolean)
    : [...YOUTUBE_OAUTH_SCOPES];

  const account = await storage.upsertConnectedAccount({
    platform: "youtube",
    userId: input.ownerUserId ?? existing?.userId ?? undefined,
    username: channel.channelId,
    displayName: channel.title ?? channel.customUrl ?? channel.channelId,
    accessToken: tokens.accessToken,
    refreshToken,
    tokenExpiresAt: tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000)
      : undefined,
    isActive: true,
    profileData: {
      provider: "youtube",
      platform: "youtube",
      channelId: channel.channelId,
      title: channel.title,
      customUrl: channel.customUrl,
      scopes: grantedScopes,
    },
  });

  return {
    accountId: account.id,
    channelId: channel.channelId,
    channelTitle: channel.title,
    refreshTokenPersisted: true,
    scopes: grantedScopes,
  };
}
