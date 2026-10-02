/**
 * Video provider — YouTube intake as a first-class research source.
 *
 * Mirrors the `web` provider: it reads videos it is *given* (durably via
 * `VIDEO_RESEARCH_URLS` or a request-scoped provider config) or that a directed
 * query itself supplies as a YouTube URL.
 *
 * Transcript-first: captions are fetched with yt-dlp and become a
 * `NormalizedSource` (text in `content`), so the canonical pipeline derives
 * evidence like any other source. When a video has no caption track, an
 * **opt-in** Gemini video-understanding fallback (`VIDEO_GEMINI_FALLBACK=1`)
 * produces a notes brief; otherwise the video fails closed.
 */

import { z } from "zod";
import { JobFailure, describeError } from "../../jobs/failures";
import type {
  FetchContext,
  NormalizedSource,
  ProviderBackend,
  ProviderDefinition,
  ResearchQuery,
  SearchContext,
  SourceRef,
} from "../contracts";
import { buildExcerpt, canonicalizeUrl, computeSourceHash, normalizeText } from "../normalize";
import type { Transcript } from "../transcript";
import { fetchYouTubeTranscript, ytDlpAvailable, youTubeIdFromUrl } from "../transcript/fetch";
import { geminiVideoFallbackEnabled, geminiVideoNotes } from "../transcript/geminiVideo";
import { envList } from "./providerUrls";

export const VIDEO_PROVIDER_ID = "video";
export const VIDEO_PROVIDER_VERSION = "1.0.0";

export const videoProviderConfigSchema = z.object({
  urls: z.array(z.string().trim().min(3)).max(25).default([]),
  defaultLimit: z.number().int().positive().max(25).default(10),
});

export type VideoProviderConfig = z.infer<typeof videoProviderConfigSchema>;

export type VideoNotes = { text: string; model: string };

export interface VideoProviderDeps {
  fetchTranscript: (url: string) => Promise<Transcript | null>;
  available: () => Promise<boolean>;
  /** Video-notes fallback for captionless videos (opt-in; video-token priced). */
  videoNotes?: (url: string) => Promise<VideoNotes>;
  loadConfig?: (ctx: { userId?: number | null }) => Promise<VideoProviderConfig>;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Pure: a fetched transcript → a normalized research source. */
export function buildVideoSource(url: string, transcript: Transcript): NormalizedSource {
  const canonicalUrl = canonicalizeUrl(watchUrl(transcript.videoId));
  const text = normalizeText(transcript.text);
  return {
    ref: {
      provider: VIDEO_PROVIDER_ID,
      kind: "youtube-transcript",
      nativeId: transcript.videoId,
      canonicalUrl,
    },
    provider: VIDEO_PROVIDER_ID,
    backend: "video-transcript",
    providerVersion: VIDEO_PROVIDER_VERSION,
    retrievalMethod: "external-cli",
    accessClass: "open",
    canonicalUrl,
    title: `YouTube ${transcript.videoId}`,
    author: null,
    publishedAt: null,
    retrievedAt: new Date().toISOString(),
    excerpt: buildExcerpt(text),
    content: { text, mime: "text/plain", length: text.length, truncated: false },
    contentHash: computeSourceHash(canonicalUrl, text),
    metadata: {
      videoId: transcript.videoId,
      transcriptHash: transcript.hash,
      cueCount: transcript.cues.length,
      lang: transcript.lang,
      captionSource: transcript.source,
      requestUrl: url,
    },
  };
}

/** Pure: Gemini video notes (captionless fallback) → a normalized research source. */
export function buildVideoNoteSource(url: string, videoId: string, notes: VideoNotes): NormalizedSource {
  const canonicalUrl = canonicalizeUrl(watchUrl(videoId));
  const text = normalizeText(notes.text);
  return {
    ref: {
      provider: VIDEO_PROVIDER_ID,
      kind: "youtube-notes",
      nativeId: videoId,
      canonicalUrl,
    },
    provider: VIDEO_PROVIDER_ID,
    backend: "gemini-video",
    providerVersion: VIDEO_PROVIDER_VERSION,
    retrievalMethod: "model",
    accessClass: "open",
    canonicalUrl,
    title: `YouTube ${videoId} (video notes)`,
    author: null,
    publishedAt: null,
    retrievedAt: new Date().toISOString(),
    excerpt: buildExcerpt(text),
    content: { text, mime: "text/plain", length: text.length, truncated: false },
    contentHash: computeSourceHash(canonicalUrl, text),
    metadata: {
      videoId,
      fallback: "gemini-video",
      model: notes.model,
      requestUrl: url,
    },
  };
}

export function createVideoProvider(overrides: Partial<VideoProviderDeps> = {}): ProviderDefinition {
  const deps: VideoProviderDeps = {
    fetchTranscript: (url) => fetchYouTubeTranscript(url),
    available: () => ytDlpAvailable(),
    // Only wired when explicitly enabled; captionless videos otherwise fail closed.
    ...(geminiVideoFallbackEnabled()
      ? {
          videoNotes: (url: string) =>
            geminiVideoNotes(url).then((n) => ({ text: n.text, model: n.model })),
        }
      : {}),
    ...overrides,
  };

  const backend: ProviderBackend = {
    id: "video-transcript",
    capabilities: ["search", "fetch"],
    sourceCapabilities: ["structured-metadata"],

    async probe() {
      const ok = await deps.available();
      return {
        state: ok ? ("healthy" as const) : ("unavailable" as const),
        message: ok ? "yt-dlp available" : "yt-dlp not installed",
        capabilities: {
          search: { state: ok ? ("healthy" as const) : ("unavailable" as const) },
          fetch: { state: ok ? ("healthy" as const) : ("unavailable" as const) },
        },
      };
    },

    /** Configured video URLs, or the query itself when it is a YouTube URL/id. */
    async search(ctx: SearchContext, query: ResearchQuery): Promise<NormalizedSource[]> {
      const config = videoProviderConfigSchema.parse(ctx.config ?? {});
      const limit = ctx.limit ?? config.defaultLimit;
      const candidate = (query.text ?? "").trim();
      const targets =
        config.urls.length > 0 ? config.urls : youTubeIdFromUrl(candidate) ? [candidate] : [];
      if (targets.length === 0) return [];

      if (!(await deps.available())) {
        throw JobFailure.permanent("yt-dlp is not available for video transcript intake");
      }

      const collected: NormalizedSource[] = [];
      const failures: string[] = [];
      for (const url of targets.slice(0, limit)) {
        try {
          const transcript = await deps.fetchTranscript(url);
          if (transcript) {
            collected.push(buildVideoSource(url, transcript));
            continue;
          }
          // No caption track: opt-in Gemini video understanding, else fail closed.
          const videoId = youTubeIdFromUrl(url);
          if (deps.videoNotes && videoId) {
            const notes = await deps.videoNotes(url);
            collected.push(buildVideoNoteSource(url, videoId, notes));
            continue;
          }
          failures.push(`${url}: no caption track available`);
        } catch (error) {
          failures.push(`${url}: ${describeError(error)}`);
        }
      }
      if (collected.length === 0 && failures.length > 0) {
        throw JobFailure.permanent(`no video transcript ingested. ${failures[0]}`);
      }
      return collected;
    },

    async fetch(ctx: FetchContext, ref: SourceRef): Promise<NormalizedSource> {
      const transcript = await deps.fetchTranscript(ref.canonicalUrl);
      if (transcript) return buildVideoSource(ref.canonicalUrl, transcript);
      const videoId = youTubeIdFromUrl(ref.canonicalUrl);
      if (deps.videoNotes && videoId) {
        const notes = await deps.videoNotes(ref.canonicalUrl);
        return buildVideoNoteSource(ref.canonicalUrl, videoId, notes);
      }
      throw JobFailure.permanent(`no captions for ${ref.canonicalUrl}`);
    },
  };

  return {
    id: VIDEO_PROVIDER_ID,
    contractVersion: "1",
    version: VIDEO_PROVIDER_VERSION,
    accessClass: "open",
    description: "YouTube intake: captions (yt-dlp) with an opt-in Gemini video fallback",
    backends: [backend],
    configSchema: videoProviderConfigSchema,
    ...(deps.loadConfig ? { resolveConfig: (ctx) => deps.loadConfig!(ctx) } : {}),
  };
}

/** Durable video targets from env; empty by default. */
export async function loadVideoProviderConfig(): Promise<VideoProviderConfig> {
  return videoProviderConfigSchema.parse({
    urls: envList(process.env.VIDEO_RESEARCH_URLS),
    defaultLimit: Number(process.env.VIDEO_DEFAULT_LIMIT ?? 10),
  });
}

export const videoProvider = createVideoProvider();
