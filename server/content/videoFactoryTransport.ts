/**
 * Transport for the Video Factory provider contract (Phase 21).
 *
 * The provider talks to this port — not to Video Factory folders, HTTP, or
 * `manifest.json` directly. Filesystem is one adapter for co-located factories;
 * memory is the test double. A future HTTP adapter can implement the same three
 * methods without changing VisualProviderPort or ContentForge media semantics.
 *
 *   submit(request) → job ref
 *   getStatus(jobId) → observational status (unknown unless proven)
 *   getOutput(jobId) → bytes + identity (never a domain storage_key)
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  assertSafeVideoFactoryJobId,
  dimensionsForFormat,
  parseExternalState,
  parseVideoFactoryJobRequest,
  serializeVideoFactoryJobRequest,
  videoFactoryNativeJobJson,
  VIDEO_FACTORY_CONTRACT_VERSION,
  type VideoFactoryExternalState,
  type VideoFactoryJobRequest,
  type VideoFactoryOutputRef,
  type VideoFactoryStatus,
} from "./videoFactoryContract";
import { InvalidVisualInputError } from "./visual";
import { renderVideoFactoryCompositionHtml, renderVideoFactoryCompositionMeta } from "./videoFactoryComposition";

export interface VideoFactoryTransport {
  readonly kind: "filesystem" | "memory" | "http";
  readonly configured: boolean;
  reachable(): Promise<boolean>;
  submit(request: VideoFactoryJobRequest): Promise<{ jobId: string; state: VideoFactoryExternalState }>;
  getStatus(jobId: string): Promise<VideoFactoryStatus>;
  getOutput(jobId: string): Promise<VideoFactoryOutputRef | null>;
}

export interface MemoryVideoFactoryJob {
  request: VideoFactoryJobRequest;
  state: VideoFactoryExternalState;
  error?: string | null;
  bytes?: Buffer;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
}

export interface MemoryVideoFactoryTransport extends VideoFactoryTransport {
  readonly kind: "memory";
  jobs: Map<string, MemoryVideoFactoryJob>;
  complete(
    jobId: string,
    output: { bytes: Buffer; width?: number; height?: number; durationMs?: number },
  ): void;
  fail(jobId: string, error: string): void;
  setState(jobId: string, state: VideoFactoryExternalState, error?: string): void;
  setReachable(value: boolean): void;
}

function observationalStatus(jobId: string, state: VideoFactoryExternalState, error?: string | null): VideoFactoryStatus {
  return {
    contractVersion: VIDEO_FACTORY_CONTRACT_VERSION,
    jobId,
    state,
    observational: true,
    error: error ?? null,
  };
}

function outputRef(
  jobId: string,
  bytes: Buffer,
  dims: { width: number | null; height: number | null; durationMs: number | null },
): VideoFactoryOutputRef {
  const outputIdentity = createHash("sha256").update(bytes).digest("hex");
  return {
    contractVersion: VIDEO_FACTORY_CONTRACT_VERSION,
    jobId,
    outputIdentity,
    mime: "video/mp4",
    bytes: Buffer.from(bytes),
    width: dims.width,
    height: dims.height,
    durationMs: dims.durationMs,
    container: "mp4",
    byteSize: bytes.length,
  };
}

export function createMemoryVideoFactoryTransport(
  options: { reachable?: boolean } = {},
): MemoryVideoFactoryTransport {
  const jobs = new Map<string, MemoryVideoFactoryJob>();
  let reachable = options.reachable !== false;

  return {
    kind: "memory",
    configured: true,
    jobs,
    async reachable() {
      return reachable;
    },
    async submit(request) {
      const parsed = parseVideoFactoryJobRequest(request);
      const existing = jobs.get(parsed.jobId);
      if (existing) {
        return { jobId: parsed.jobId, state: existing.state === "unknown" ? "accepted" : existing.state };
      }
      jobs.set(parsed.jobId, { request: parsed, state: "queued" });
      return { jobId: parsed.jobId, state: "accepted" };
    },
    async getStatus(jobId) {
      const id = assertSafeVideoFactoryJobId(jobId);
      const job = jobs.get(id);
      if (!job) return observationalStatus(id, "unknown");
      return observationalStatus(id, job.state, job.error);
    },
    async getOutput(jobId) {
      const id = assertSafeVideoFactoryJobId(jobId);
      const job = jobs.get(id);
      if (!job || job.state !== "done" || !job.bytes) return null;
      const dims = dimensionsForFormat(job.request.format);
      return outputRef(id, job.bytes, {
        width: job.width ?? dims.width,
        height: job.height ?? dims.height,
        durationMs: job.durationMs ?? job.request.durationMs,
      });
    },
    complete(jobId, output) {
      const id = assertSafeVideoFactoryJobId(jobId);
      const job = jobs.get(id);
      if (!job) throw new InvalidVisualInputError([`memory Video Factory job "${id}" is missing`]);
      job.state = "done";
      job.bytes = Buffer.from(output.bytes);
      job.width = output.width ?? null;
      job.height = output.height ?? null;
      job.durationMs = output.durationMs ?? job.request.durationMs;
      job.error = null;
    },
    fail(jobId, error) {
      const id = assertSafeVideoFactoryJobId(jobId);
      const job = jobs.get(id) ?? {
        request: parseVideoFactoryJobRequest({
          contractVersion: VIDEO_FACTORY_CONTRACT_VERSION,
          jobId: id,
          title: id,
          format: "9:16",
          brief: "failed",
          script: null,
          storyboard: null,
          voice: { enabled: false },
          render: { quality: "high" },
          durationMs: null,
        }),
        state: "failed" as const,
      };
      job.state = "failed";
      job.error = error;
      jobs.set(id, job);
    },
    setState(jobId, state, error) {
      const id = assertSafeVideoFactoryJobId(jobId);
      const job = jobs.get(id);
      if (!job) throw new InvalidVisualInputError([`memory Video Factory job "${id}" is missing`]);
      job.state = state;
      if (error !== undefined) job.error = error;
    },
    setReachable(value: boolean) {
      reachable = value;
    },
  };
}

const FACTORY_DIRS = ["building", "queue", "work", "done", "failed", "output", "state"] as const;

function assertInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) {
    throw new InvalidVisualInputError(["Video Factory path escaped the configured bridge directory"]);
  }
  return resolved;
}

function jobDir(root: string, folder: (typeof FACTORY_DIRS)[number], jobId: string): string {
  const id = assertSafeVideoFactoryJobId(jobId);
  return assertInsideRoot(root, path.join(root, folder, id));
}

async function pathIsDir(target: string): Promise<boolean> {
  try {
    const info = await stat(target);
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function pathIsFile(target: string): Promise<boolean> {
  try {
    const info = await stat(target);
    return info.isFile();
  } catch {
    return false;
  }
}

async function writeJobFiles(dir: string, request: VideoFactoryJobRequest): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "CONTRACT.json"), serializeVideoFactoryJobRequest(request), "utf8");
  await writeFile(path.join(dir, "job.json"), `${JSON.stringify(videoFactoryNativeJobJson(request), null, 2)}\n`, "utf8");
  await writeFile(path.join(dir, "BRIEF.md"), `${request.brief}\n`, "utf8");
  if (request.script) await writeFile(path.join(dir, "SCRIPT.md"), `${request.script}\n`, "utf8");
  if (request.storyboard) await writeFile(path.join(dir, "STORYBOARD.md"), `${request.storyboard}\n`, "utf8");
  await writeFile(path.join(dir, "index.html"), renderVideoFactoryCompositionHtml(request), "utf8");
  await writeFile(path.join(dir, "hyperframes.json"), renderVideoFactoryCompositionMeta(request), "utf8");
}

async function readJsonIfPresent(file: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function locateJobFolder(root: string, jobId: string): Promise<{ folder: (typeof FACTORY_DIRS)[number]; dir: string } | null> {
  for (const folder of ["queue", "building", "work", "done", "failed"] as const) {
    const dir = jobDir(root, folder, jobId);
    if (await pathIsDir(dir)) return { folder, dir };
  }
  return null;
}

function stateFromFolder(folder: string): VideoFactoryExternalState {
  if (folder === "building") return "building";
  if (folder === "queue") return "queued";
  if (folder === "work") return "rendering";
  if (folder === "done") return "done";
  if (folder === "failed") return "failed";
  return "unknown";
}

export function createFilesystemVideoFactoryTransport(root: string): VideoFactoryTransport {
  const resolvedRoot = path.resolve(root);
  if (!resolvedRoot || resolvedRoot === path.sep) {
    throw new InvalidVisualInputError(["Video Factory bridge directory is invalid"]);
  }

  async function ensureReachable(): Promise<boolean> {
    try {
      await mkdir(resolvedRoot, { recursive: true });
      for (const folder of FACTORY_DIRS) {
        await mkdir(path.join(resolvedRoot, folder), { recursive: true });
      }
      return true;
    } catch {
      return false;
    }
  }

  return {
    kind: "filesystem",
    configured: true,
    reachable: ensureReachable,
    async submit(request) {
      const parsed = parseVideoFactoryJobRequest(request);
      const id = parsed.jobId;
      if (!(await ensureReachable())) {
        throw new InvalidVisualInputError(["Video Factory filesystem bridge is unreachable"]);
      }

      const existing = await locateJobFolder(resolvedRoot, id);
      if (existing) {
        if (existing.folder === "building") {
          const dest = jobDir(resolvedRoot, "queue", id);
          if (existsSync(dest)) {
            return { jobId: id, state: "queued" };
          }
          await rename(existing.dir, dest);
          return { jobId: id, state: "accepted" };
        }
        return { jobId: id, state: stateFromFolder(existing.folder) };
      }

      const outputFile = assertInsideRoot(resolvedRoot, path.join(resolvedRoot, "output", `${id}.mp4`));
      if (await pathIsFile(outputFile)) {
        return { jobId: id, state: "done" };
      }

      const staging = jobDir(resolvedRoot, "building", id);
      await writeJobFiles(staging, parsed);
      const queued = jobDir(resolvedRoot, "queue", id);
      await rename(staging, queued);
      return { jobId: id, state: "accepted" };
    },
    async getStatus(jobId) {
      const id = assertSafeVideoFactoryJobId(jobId);
      const stateFile = assertInsideRoot(resolvedRoot, path.join(resolvedRoot, "state", `${id}.json`));
      const stateJson = await readJsonIfPresent(stateFile);
      if (stateJson) {
        const observed = parseExternalState(stateJson.status);
        return observationalStatus(id, observed, typeof stateJson.error === "string" ? stateJson.error : null);
      }

      const outputFile = assertInsideRoot(resolvedRoot, path.join(resolvedRoot, "output", `${id}.mp4`));
      if (await pathIsFile(outputFile)) {
        return observationalStatus(id, "done");
      }

      const located = await locateJobFolder(resolvedRoot, id);
      if (!located) return observationalStatus(id, "unknown");
      return observationalStatus(id, stateFromFolder(located.folder));
    },
    async getOutput(jobId) {
      const id = assertSafeVideoFactoryJobId(jobId);
      const outputFile = assertInsideRoot(resolvedRoot, path.join(resolvedRoot, "output", `${id}.mp4`));
      if (!(await pathIsFile(outputFile))) return null;
      const bytes = await readFile(outputFile);
      const located = await locateJobFolder(resolvedRoot, id);
      let format: ReturnType<typeof dimensionsForFormat> | null = null;
      let durationMs: number | null = null;
      let width: number | null = null;
      let height: number | null = null;
      if (located) {
        const contract = await readJsonIfPresent(path.join(located.dir, "CONTRACT.json"));
        if (contract) {
          try {
            const parsed = parseVideoFactoryJobRequest(contract);
            format = dimensionsForFormat(parsed.format);
            durationMs = parsed.durationMs;
          } catch {
            /* observational */
          }
        }
        const hyper = await readJsonIfPresent(path.join(located.dir, "hyperframes.json"));
        if (hyper) {
          if (typeof hyper.width === "number") width = hyper.width;
          if (typeof hyper.height === "number") height = hyper.height;
          if (typeof hyper.duration === "number" && Number.isFinite(hyper.duration) && hyper.duration > 0) {
            durationMs = Math.round(hyper.duration * 1000);
          }
        }
      }
      const fallback = format ?? dimensionsForFormat("9:16");
      return outputRef(id, bytes, {
        width: width ?? fallback.width,
        height: height ?? fallback.height,
        durationMs,
      });
    },
  };
}

export function videoFactoryRootFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.VIDEO_FACTORY_ROOT?.trim();
  if (!raw) return null;
  if (raw.includes("\0")) return null;
  return path.resolve(raw);
}
