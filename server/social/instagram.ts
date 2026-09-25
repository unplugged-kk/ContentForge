/**
 * Instagram Content Publishing transport — Meta Instagram Platform, current
 * official contract verified 2026-09-18 from:
 *   https://developers.facebook.com/docs/instagram-platform/content-publishing
 *   https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
 *   https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-container
 *   https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights
 *
 * Instagram Login (this transport): host `graph.instagram.com`, Instagram User
 * token, scopes `instagram_business_basic`, `instagram_business_content_publish`,
 * `instagram_business_manage_insights`. Professional accounts only (Business /
 * Creator). Personal accounts are unsupported by the Content Publishing API.
 *
 * Image: POST `/{ig-user-id}/media` (`image_url`, optional caption/alt_text)
 * then POST `/{ig-user-id}/media_publish` (`creation_id`). JPEG only; public
 * URL Meta can cURL; 8 MB; aspect 4:5–1.91:1; width 320–1440.
 * Carousel: child containers `is_carousel_item=true`, parent `media_type=CAROUSEL`
 * + `children`, then media_publish. Containers expire in 24h; 400 containers /
 * 100 published posts per rolling 24h.
 * Reels: same container/publish workflow with `media_type=REELS` + `video_url`.
 * Processing is asynchronous (`IN_PROGRESS` → `FINISHED` | `ERROR` | `EXPIRED`).
 * `cover_url` / `thumb_offset` are optional and omitted (no cover subsystem).
 *
 * Provider idempotency: none documented for create-container or media_publish.
 * Duplicate suppression is ContentForge Publication identity + the single-flight
 * lease. A listing miss is never treated as proof of absence.
 *
 * Host/version are centralized. Tokens never log.
 */

import { storage } from "../storage";
import type { PublishMedia } from "../content/adapters";
import { looksLikeMp4 } from "../content/visual";

export const INSTAGRAM_OAUTH_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
] as const;

export const INSTAGRAM_CAPTION_LIMIT = 2200;
export const INSTAGRAM_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const INSTAGRAM_MIN_WIDTH = 320;
export const INSTAGRAM_MAX_WIDTH = 1440;
/** Official feed image aspect: 4:5 (0.8) through 1.91:1. */
export const INSTAGRAM_MIN_ASPECT = 4 / 5;
export const INSTAGRAM_MAX_ASPECT = 1.91;
export const INSTAGRAM_MIN_CAROUSEL = 2;
export const INSTAGRAM_MAX_CAROUSEL = 10;

/** Instagram Reels Graph constraints (channel-specific; generic video validation stays in visual.ts). */
export const INSTAGRAM_REEL_MAX_BYTES = 100 * 1024 * 1024;
export const INSTAGRAM_REEL_MIN_DURATION_MS = 3_000;
export const INSTAGRAM_REEL_MAX_DURATION_MS = 15 * 60 * 1000;
export const INSTAGRAM_REEL_MIN_WIDTH = 540;
export const INSTAGRAM_REEL_MAX_WIDTH = 1920;
/** 9:16 with a small rounding tolerance. Landscape is not a Reel. */
export const INSTAGRAM_REEL_MIN_ASPECT = 9 / 16 - 0.03;
export const INSTAGRAM_REEL_MAX_ASPECT = 9 / 16 + 0.03;

export const INSTAGRAM_INSIGHT_METRICS = [
  "likes",
  "comments",
  "views",
  "reach",
  "saved",
  "shares",
  "total_interactions",
] as const;

export const PROFESSIONAL_ACCOUNT_TYPES = new Set(["BUSINESS", "MEDIA_CREATOR", "CREATOR"]);

type InstagramConfig = {
  graphBase: string;
  token: string;
  userId: string;
};

export function getInstagramApiVersion(): string {
  return (process.env.INSTAGRAM_API_VERSION?.trim() || "v25.0").replace(/^\/+|\/+$/g, "");
}

export function getInstagramGraphBaseUrl(): string {
  const host = (process.env.INSTAGRAM_API_BASE_URL?.trim() || "https://graph.instagram.com").replace(/\/+$/, "");
  return `${host}/${getInstagramApiVersion()}`;
}

export function getInstagramAuthorizeUrl(): string {
  return (process.env.INSTAGRAM_AUTHORIZE_URL?.trim() || "https://www.instagram.com/oauth/authorize").replace(
    /\/+$/,
    "",
  );
}

function timeoutMs(): number {
  return Number(process.env.INSTAGRAM_TIMEOUT_MS ?? 30_000);
}

function containerPollAttempts(): number {
  const n = Number(process.env.INSTAGRAM_CONTAINER_POLL_ATTEMPTS ?? 3);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 8) : 3;
}

function containerPollGapMs(): number {
  const n = Number(process.env.INSTAGRAM_CONTAINER_POLL_GAP_MS ?? 250);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 2_000) : 250;
}

export function redactInstagramSecrets(text: string): string {
  return text
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/client_secret=[^&\s]+/gi, "client_secret=[redacted]");
}

export function translateInstagramError(body: string): string {
  const redacted = redactInstagramSecrets(body);
  if (redacted.includes("INSTAGRAM_CONFIG_MISSING")) {
    return "Instagram credentials missing: set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID, or connect an Instagram professional account.";
  }
  if (redacted.includes("INSTAGRAM_ACCOUNT_UNSUPPORTED")) {
    return "Instagram Content Publishing requires a professional (Business or Creator) account. Personal accounts are not supported.";
  }
  if (redacted.includes("INSTAGRAM_MEDIA_URL_MISSING")) {
    return "Instagram requires a provider-fetchable media URL. Set CONTENTFORGE_PUBLIC_BASE_URL or INSTAGRAM_MEDIA_STAGE_URL.";
  }
  if (/INSTAGRAM_PUBLISH_ID_MISSING|INSTAGRAM_CONTAINER_ID_MISSING/i.test(redacted)) {
    return "Instagram accepted the request but did not return an id.";
  }
  if (/ACCESS_DENIED|invalid.*token|OAuthException|401/i.test(redacted)) {
    return "Instagram credentials expired or invalid. Reconnect Instagram.";
  }
  if (/throttl|429|rate limit|code.?4\b/i.test(redacted)) return "Instagram API rate limit reached. Try again later.";
  return redacted;
}

export class InstagramPublishAmbiguousError extends Error {
  constructor(
    readonly hint: {
      caption: string;
      attemptedAt: string;
      creationId?: string;
      childIds?: string[];
    },
    message: string,
  ) {
    super(redactInstagramSecrets(message));
    this.name = "InstagramPublishAmbiguousError";
  }
}

export type InstagramPostResult = { mediaId: string; url: string | null; creationId: string };

export type InstagramReconcileStatus =
  | { status: "success"; mediaId: string; url: string | null }
  | { status: "absent"; message: string }
  | { status: "pending" };

export type InstagramInsightMap = {
  likes?: number;
  comments?: number;
  views?: number;
  reach?: number;
  saved?: number;
  shares?: number;
  total_interactions?: number;
};

export function parseGraphId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function parseInstagramInsights(payload: unknown): InstagramInsightMap {
  const out: InstagramInsightMap = {};
  if (!payload || typeof payload !== "object") return out;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return out;
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const name = (row as { name?: unknown }).name;
    if (typeof name !== "string") continue;
    if (!(INSTAGRAM_INSIGHT_METRICS as readonly string[]).includes(name)) continue;
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

/**
 * Reach is unique accounts, not impressions. total_interactions is a composite.
 * Neither is coerced into a canonical field.
 */
export function unmappedInstagramMetrics(source: InstagramInsightMap): Record<string, number> {
  const extra: Record<string, number> = {};
  if (typeof source.reach === "number") extra.reach = source.reach;
  if (typeof source.total_interactions === "number") extra.total_interactions = source.total_interactions;
  return extra;
}

export function isJpegMime(mime: string): boolean {
  return mime === "image/jpeg" || mime === "image/jpg";
}

export function looksLikeJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function validateInstagramCaption(caption: string): string | null {
  if (caption.length > INSTAGRAM_CAPTION_LIMIT) {
    return `instagram caption exceeds ${INSTAGRAM_CAPTION_LIMIT} characters`;
  }
  return null;
}

export function validateInstagramImageMedia(media: PublishMedia): string | null {
  if (!isJpegMime(media.mime)) {
    return `instagram requires JPEG (got ${media.mime}); assets are not converted`;
  }
  if (!looksLikeJpeg(media.bytes)) return "instagram image bytes are not JPEG";
  if (media.bytes.length > INSTAGRAM_MAX_IMAGE_BYTES) {
    return `instagram image exceeds ${INSTAGRAM_MAX_IMAGE_BYTES} bytes`;
  }
  const width = media.width ?? undefined;
  const height = media.height ?? undefined;
  if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
    if (width < INSTAGRAM_MIN_WIDTH || width > INSTAGRAM_MAX_WIDTH) {
      return `instagram image width ${width} is outside ${INSTAGRAM_MIN_WIDTH}–${INSTAGRAM_MAX_WIDTH}`;
    }
    const aspect = width / height;
    if (aspect < INSTAGRAM_MIN_ASPECT || aspect > INSTAGRAM_MAX_ASPECT) {
      return `instagram image aspect ${aspect.toFixed(3)} is outside 4:5–1.91:1`;
    }
  }
  return null;
}

export function validateInstagramVideoMedia(media: PublishMedia): string | null {
  if (media.kind && media.kind !== "video") {
    return `instagram video requires a video asset (got ${media.kind})`;
  }
  if (media.mime !== "video/mp4") {
    return `instagram reels require video/mp4 (got ${media.mime})`;
  }
  if (!looksLikeMp4(media.bytes)) return "instagram video bytes are missing a valid ftyp box";
  const size = media.byteSize ?? media.bytes.length;
  if (size > INSTAGRAM_REEL_MAX_BYTES) {
    return `instagram video exceeds ${INSTAGRAM_REEL_MAX_BYTES} bytes`;
  }
  const duration = media.durationMs ?? null;
  if (duration === null || !Number.isInteger(duration) || duration <= 0) {
    return "instagram video duration is required";
  }
  if (duration < INSTAGRAM_REEL_MIN_DURATION_MS) {
    return `instagram video duration ${duration}ms is below the ${INSTAGRAM_REEL_MIN_DURATION_MS}ms Reel minimum`;
  }
  if (duration > INSTAGRAM_REEL_MAX_DURATION_MS) {
    return `instagram video duration ${duration}ms exceeds the ${INSTAGRAM_REEL_MAX_DURATION_MS}ms Reel maximum`;
  }
  const width = media.width ?? null;
  const height = media.height ?? null;
  if (width === null || height === null || width <= 0 || height <= 0) {
    return "instagram video dimensions are required";
  }
  if (width < INSTAGRAM_REEL_MIN_WIDTH || width > INSTAGRAM_REEL_MAX_WIDTH) {
    return `instagram video width ${width} is outside ${INSTAGRAM_REEL_MIN_WIDTH}–${INSTAGRAM_REEL_MAX_WIDTH}`;
  }
  const aspect = width / height;
  if (aspect < INSTAGRAM_REEL_MIN_ASPECT || aspect > INSTAGRAM_REEL_MAX_ASPECT) {
    return `instagram reel aspect ${aspect.toFixed(3)} must be 9:16`;
  }
  return null;
}

export function validateInstagramPublishMedia(format: string, media: PublishMedia[]): string | null {
  if (format === "image") {
    if (media.length !== 1) return `instagram image requires exactly one asset, got ${media.length}`;
    return validateInstagramImageMedia(media[0]);
  }
  if (format === "carousel") {
    if (media.length < INSTAGRAM_MIN_CAROUSEL || media.length > INSTAGRAM_MAX_CAROUSEL) {
      return `instagram carousel requires ${INSTAGRAM_MIN_CAROUSEL}–${INSTAGRAM_MAX_CAROUSEL} slides, got ${media.length}`;
    }
    const positions = media.map((m) => m.position);
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] !== i) return `instagram carousel slide positions must be contiguous from 0 (gap at ${i})`;
    }
    for (const item of media) {
      const err = validateInstagramImageMedia(item);
      if (err) return err;
    }
    return null;
  }
  if (format === "video") {
    if (media.length !== 1) return `instagram video requires exactly one asset, got ${media.length}`;
    return validateInstagramVideoMedia(media[0]);
  }
  return `instagram adapter does not support format "${format}"`;
}

export function isProfessionalAccountType(accountType: string | null | undefined): boolean {
  if (!accountType) return true;
  const normalized = accountType.trim().toUpperCase();
  if (PROFESSIONAL_ACCOUNT_TYPES.has(normalized)) return true;
  return false;
}

export function instagramAuthorizationUrl(state?: string): string | null {
  const clientId = process.env.INSTAGRAM_APP_ID?.trim();
  const redirectUri = process.env.INSTAGRAM_CALLBACK_URL?.trim() || process.env.INSTAGRAM_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: INSTAGRAM_OAUTH_SCOPES.join(","),
    response_type: "code",
  });
  if (state) params.set("state", state);
  return `${getInstagramAuthorizeUrl()}?${params.toString()}`;
}

export async function getInstagramConfigSummary(ownerUserId?: number | null): Promise<Record<string, unknown>> {
  const envToken = ownerUserId == null && Boolean(process.env.INSTAGRAM_ACCESS_TOKEN?.trim());
  const account = ownerUserId == null
    ? await storage.getConnectedAccount("instagram")
    : await storage.getConnectedAccountForOwner("instagram", ownerUserId);
  return {
    graphBase: getInstagramGraphBaseUrl(),
    apiVersion: getInstagramApiVersion(),
    scopes: [...INSTAGRAM_OAUTH_SCOPES],
    envTokenConfigured: envToken,
    connectedUsername: account?.username ?? null,
    connectedUserId: account?.userId ?? null,
    authorizationUrlReady: Boolean(instagramAuthorizationUrl()),
    providerIdempotency: false,
    accountRequirement: "professional (Business or Creator); personal accounts rejected",
  };
}

async function getInstagramConfig(ownerUserId?: number | null): Promise<InstagramConfig | null> {
  const envToken = process.env.INSTAGRAM_ACCESS_TOKEN?.trim() || null;
  const envUser = process.env.INSTAGRAM_USER_ID?.trim() || "me";
  if (ownerUserId != null) {
    const owned = await storage.getConnectedAccountForOwner("instagram", ownerUserId);
    const token = owned?.accessToken?.trim() || envToken;
    const userId = owned?.username?.trim() || envUser;
    if (!token) return null;
    return { graphBase: getInstagramGraphBaseUrl(), token, userId };
  }
  const account = await storage.getConnectedAccount("instagram");
  const token = account?.accessToken?.trim() || envToken;
  const userId = account?.username?.trim() || envUser;
  if (!token) return null;
  return { graphBase: getInstagramGraphBaseUrl(), token, userId };
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
    err && typeof err.message === "string" ? err.message : text || `Instagram API returned HTTP ${status}`;
  return redactInstagramSecrets(message);
}

export async function verifyInstagramAccessToken(token: string): Promise<{
  id: string;
  username: string | null;
  accountType: string | null;
} | null> {
  const graphBase = getInstagramGraphBaseUrl();
  const params = new URLSearchParams({
    fields: "id,username,account_type",
    access_token: token,
  });
  const { ok, json } = await graphJson(`${graphBase}/me?${params}`, { method: "GET" });
  if (!ok || !json || typeof json !== "object") return null;
  const id = parseGraphId(json);
  if (!id) return null;
  const username =
    typeof (json as { username?: unknown }).username === "string" ? (json as { username: string }).username : null;
  const accountType =
    typeof (json as { account_type?: unknown }).account_type === "string"
      ? (json as { account_type: string }).account_type
      : null;
  return { id, username, accountType };
}

export async function assertProfessionalAccount(config: InstagramConfig): Promise<void> {
  const params = new URLSearchParams({
    fields: "id,username,account_type",
    access_token: config.token,
  });
  const { ok, json } = await graphJson(`${config.graphBase}/me?${params}`, { method: "GET" });
  if (!ok || !json || typeof json !== "object") return;
  const accountType =
    typeof (json as { account_type?: unknown }).account_type === "string"
      ? (json as { account_type: string }).account_type
      : null;
  if (accountType && !isProfessionalAccountType(accountType)) {
    throw new Error("INSTAGRAM_ACCOUNT_UNSUPPORTED");
  }
}

export function buildImageContainerBody(input: {
  imageUrl: string;
  caption?: string;
  altText?: string | null;
  isCarouselItem?: boolean;
}): URLSearchParams {
  const body = new URLSearchParams();
  body.set("image_url", input.imageUrl);
  if (input.isCarouselItem) body.set("is_carousel_item", "true");
  if (input.caption && !input.isCarouselItem) body.set("caption", input.caption);
  if (input.altText) body.set("alt_text", input.altText);
  return body;
}

export function buildCarouselParentBody(childIds: string[], caption: string): URLSearchParams {
  const body = new URLSearchParams();
  body.set("media_type", "CAROUSEL");
  body.set("children", childIds.join(","));
  if (caption) body.set("caption", caption);
  return body;
}

export function buildPublishContainerBody(creationId: string): URLSearchParams {
  const body = new URLSearchParams();
  body.set("creation_id", creationId);
  return body;
}

/**
 * Reel container body. Cover/thumbnail (`cover_url`, `thumb_offset`) are
 * optional at the provider and omitted here — Phase 20 does not generate covers.
 */
export function buildReelContainerBody(input: { videoUrl: string; caption?: string }): URLSearchParams {
  const body = new URLSearchParams();
  body.set("media_type", "REELS");
  body.set("video_url", input.videoUrl);
  if (input.caption) body.set("caption", input.caption);
  return body;
}

export async function stageInstagramMediaUrl(media: PublishMedia): Promise<string> {
  if (media.providerFetchUrl) return media.providerFetchUrl;
  const stage = process.env.INSTAGRAM_MEDIA_STAGE_URL?.trim();
  if (!stage) throw new Error("INSTAGRAM_MEDIA_URL_MISSING");
  const res = await fetch(stage, {
    method: "POST",
    headers: { "content-type": media.mime, accept: "application/json" },
    body: new Uint8Array(media.bytes),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const url =
    json && typeof json === "object" && typeof (json as { url?: unknown }).url === "string"
      ? (json as { url: string }).url
      : null;
  if (!res.ok || !url) throw new Error("INSTAGRAM_MEDIA_URL_MISSING");
  return url;
}

async function createContainer(config: InstagramConfig, body: URLSearchParams): Promise<string> {
  const url = `${config.graphBase}/${encodeURIComponent(config.userId)}/media`;
  const created = await graphJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: withToken(body, config.token).toString(),
  });
  if (!created.ok) {
    const message = graphErrorMessage(created.status, created.json, created.text);
    throw new Error(`${created.status} ${message}`);
  }
  const id = parseGraphId(created.json);
  if (!id) throw new Error("INSTAGRAM_CONTAINER_ID_MISSING");
  return id;
}

async function getContainerStatusCode(
  config: InstagramConfig,
  creationId: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    fields: "status_code,status,id",
    access_token: config.token,
  });
  const { ok, json } = await graphJson(`${config.graphBase}/${encodeURIComponent(creationId)}?${params}`, {
    method: "GET",
  });
  if (!ok || !json || typeof json !== "object") return null;
  const code = (json as { status_code?: unknown }).status_code;
  return typeof code === "string" ? code : null;
}

/**
 * Bounded in-adapter status checks — not a second scheduler. `FINISHED`/`PUBLISHED`
 * (or a missing status, matching prior image behavior) proceeds to publish.
 * `ERROR`/`EXPIRED` are terminal. Persistent `IN_PROGRESS` is ambiguous so the
 * same Publication can reconcile later without creating another container.
 */
async function waitForContainerReady(
  config: InstagramConfig,
  creationId: string,
  hint: InstagramPublishAmbiguousError["hint"],
): Promise<void> {
  const attempts = containerPollAttempts();
  const gapMs = containerPollGapMs();
  let last: string | null = null;
  for (let i = 0; i < attempts; i++) {
    last = await getContainerStatusCode(config, creationId);
    if (last === "ERROR" || last === "EXPIRED") {
      throw new Error(`instagram container ${creationId} status_code=${last}`);
    }
    if (!last || last === "FINISHED" || last === "PUBLISHED") return;
    if (i < attempts - 1 && gapMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }
  throw new InstagramPublishAmbiguousError(
    hint,
    `instagram container ${creationId} still ${last ?? "unknown"}`,
  );
}

async function finishContainer(
  config: InstagramConfig,
  creationId: string,
  hint: InstagramPublishAmbiguousError["hint"],
): Promise<InstagramPostResult> {
  try {
    await waitForContainerReady(config, creationId, hint);
    return await publishContainer(config, creationId, hint);
  } catch (error) {
    if (error instanceof InstagramPublishAmbiguousError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout|ECONN|ENOTFOUND|fetch failed|socket/i.test(message)) {
      throw new InstagramPublishAmbiguousError(hint, message);
    }
    throw error;
  }
}

async function publishContainer(
  config: InstagramConfig,
  creationId: string,
  hint: InstagramPublishAmbiguousError["hint"],
): Promise<InstagramPostResult> {
  const publishUrl = `${config.graphBase}/${encodeURIComponent(config.userId)}/media_publish`;
  let published: { ok: boolean; status: number; json: unknown; text: string };
  try {
    published = await graphJson(publishUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: withToken(buildPublishContainerBody(creationId), config.token).toString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new InstagramPublishAmbiguousError(
      hint,
      `Instagram publish transport failed after container ${creationId}: ${message}`,
    );
  }
  if (!published.ok) {
    const message = graphErrorMessage(published.status, published.json, published.text);
    if (published.status === 429 || published.status >= 500) {
      throw new InstagramPublishAmbiguousError(
        hint,
        `Instagram publish returned HTTP ${published.status} after container create: ${message}`,
      );
    }
    throw new Error(message);
  }
  const mediaId = parseGraphId(published.json);
  if (!mediaId) {
    throw new InstagramPublishAmbiguousError(hint, "INSTAGRAM_PUBLISH_ID_MISSING");
  }
  return {
    mediaId,
    creationId,
    url: `https://www.instagram.com/p/${mediaId}/`,
  };
}

export async function postMediaToInstagram(
  input: { format: "image" | "carousel" | "video"; caption: string; media: PublishMedia[] },
  ownerUserId?: number | null,
): Promise<InstagramPostResult> {
  const invalid = validateInstagramCaption(input.caption) ?? validateInstagramPublishMedia(input.format, input.media);
  if (invalid) throw new Error(invalid);

  const config = await getInstagramConfig(ownerUserId);
  if (!config) throw new Error("INSTAGRAM_CONFIG_MISSING");
  await assertProfessionalAccount(config);

  const attemptedAt = new Date().toISOString();
  const caption = input.caption;

  try {
    if (input.format === "image") {
      const imageUrl = await stageInstagramMediaUrl(input.media[0]);
      const creationId = await createContainer(
        config,
        buildImageContainerBody({
          imageUrl,
          caption,
          altText: input.media[0].altText,
        }),
      );
      return await finishContainer(config, creationId, { caption, attemptedAt, creationId });
    }

    if (input.format === "video") {
      const videoUrl = await stageInstagramMediaUrl(input.media[0]);
      const creationId = await createContainer(
        config,
        buildReelContainerBody({ videoUrl, caption }),
      );
      return await finishContainer(config, creationId, { caption, attemptedAt, creationId });
    }

    const childIds: string[] = [];
    for (const slide of input.media) {
      const imageUrl = await stageInstagramMediaUrl(slide);
      const childId = await createContainer(
        config,
        buildImageContainerBody({
          imageUrl,
          isCarouselItem: true,
          altText: slide.altText,
        }),
      );
      childIds.push(childId);
    }
    const parentId = await createContainer(config, buildCarouselParentBody(childIds, caption));
    return await finishContainer(config, parentId, {
      caption,
      attemptedAt,
      creationId: parentId,
      childIds,
    });
  } catch (error) {
    if (error instanceof InstagramPublishAmbiguousError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout|ECONN|ENOTFOUND|fetch failed|socket/i.test(message)) {
      throw new InstagramPublishAmbiguousError({ caption, attemptedAt }, message);
    }
    throw error;
  }
}

async function getMedia(
  config: InstagramConfig,
  mediaId: string,
): Promise<{ id: string; permalink: string | null; caption: string | null } | null> {
  const params = new URLSearchParams({
    fields: "id,permalink,caption,timestamp",
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
  const caption =
    json && typeof json === "object" && typeof (json as { caption?: unknown }).caption === "string"
      ? (json as { caption: string }).caption
      : null;
  return { id, permalink, caption };
}

async function findPublishedByCaption(
  config: InstagramConfig,
  hint: { caption: string; attemptedAt: string },
): Promise<InstagramReconcileStatus> {
  const params = new URLSearchParams({
    fields: "id,caption,timestamp,permalink",
    limit: "10",
    access_token: config.token,
  });
  const { ok, json } = await graphJson(
    `${config.graphBase}/${encodeURIComponent(config.userId)}/media?${params}`,
    { method: "GET" },
  );
  if (!ok || !json || typeof json !== "object") return { status: "pending" };
  const data = Array.isArray((json as { data?: unknown }).data)
    ? ((json as { data: Array<Record<string, unknown>> }).data)
    : [];
  const attemptedAtMs = Date.parse(hint.attemptedAt);
  for (const element of data) {
    if (element.caption !== hint.caption) continue;
    const ts = typeof element.timestamp === "string" ? Date.parse(element.timestamp) : NaN;
    if (Number.isFinite(ts) && Number.isFinite(attemptedAtMs) && ts + 60_000 < attemptedAtMs) continue;
    const mediaId = typeof element.id === "string" ? element.id : null;
    if (!mediaId) continue;
    const permalink =
      typeof element.permalink === "string" ? element.permalink : `https://www.instagram.com/p/${mediaId}/`;
    return { status: "success", mediaId, url: permalink };
  }
  return { status: "pending" };
}

export async function reconcileInstagramPost(
  hint: { caption?: string; attemptedAt?: string; creationId?: string; externalId?: string },
  ownerUserId?: number | null,
): Promise<InstagramReconcileStatus | null> {
  const config = await getInstagramConfig(ownerUserId);
  if (!config) return null;

  if (hint.externalId) {
    const media = await getMedia(config, hint.externalId);
    if (media) {
      return {
        status: "success",
        mediaId: media.id,
        url: media.permalink ?? `https://www.instagram.com/p/${media.id}/`,
      };
    }
    return { status: "pending" };
  }

  if (hint.creationId) {
    const code = await getContainerStatusCode(config, hint.creationId);
    if (code === "ERROR" || code === "EXPIRED") {
      return { status: "absent", message: `Instagram container ${hint.creationId} status_code=${code}` };
    }
    if (code === "IN_PROGRESS") {
      return { status: "pending" };
    }
    if (code === "FINISHED") {
      try {
        const published = await publishContainer(config, hint.creationId, {
          caption: hint.caption ?? "",
          attemptedAt: hint.attemptedAt ?? new Date().toISOString(),
          creationId: hint.creationId,
        });
        return { status: "success", mediaId: published.mediaId, url: published.url };
      } catch (error) {
        if (error instanceof InstagramPublishAmbiguousError) return { status: "pending" };
        // 4xx after FINISHED often means the container was already published —
        // fall through to listing rather than creating another container.
      }
    }
  }

  if (hint.caption && hint.attemptedAt) {
    const listed = await findPublishedByCaption(config, { caption: hint.caption, attemptedAt: hint.attemptedAt });
    if (listed.status === "success") return listed;
  }

  return { status: "pending" };
}

export async function fetchInstagramInsights(
  mediaId: string,
  ownerUserId?: number | null,
): Promise<
  | { ok: true; retrievedAt: Date; insights: InstagramInsightMap }
  | { ok: false; status: number; message: string; retrievedAt: Date }
> {
  const retrievedAt = new Date();
  const config = await getInstagramConfig(ownerUserId);
  if (!config) {
    return { ok: false, status: 401, message: "INSTAGRAM_CONFIG_MISSING", retrievedAt };
  }
  const params = new URLSearchParams({
    metric: INSTAGRAM_INSIGHT_METRICS.join(","),
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
    return { ok: true, retrievedAt, insights: parseInstagramInsights(res.json) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, message: redactInstagramSecrets(message), retrievedAt };
  }
}
