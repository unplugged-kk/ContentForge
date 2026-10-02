import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseVtt } from "./vtt";
import { buildTranscript, type Transcript, type TranscriptSource } from "./index";

/**
 * YouTube caption fetch (Tier 0, no LLM).
 *
 * Shells out to `yt-dlp` for captions only (`--skip-download`). The binary is
 * env-configurable; when it is absent the fetch reports that clearly instead of
 * silently returning an empty transcript.
 */

export const DEFAULT_YTDLP_PATH = "yt-dlp";

export function ytDlpPath(): string {
  return process.env.YTDLP_PATH?.trim() || DEFAULT_YTDLP_PATH;
}

type RunResult = { code: number; stdout: string; stderr: string };

function run(bin: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`yt-dlp timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => (stdout += c));
    child.stderr.on("data", (c: string) => (stderr += c.slice(0, 8_000)));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** True when the configured yt-dlp binary runs. */
export async function ytDlpAvailable(): Promise<boolean> {
  try {
    const result = await run(ytDlpPath(), ["--version"], 10_000);
    return result.code === 0;
  } catch {
    return false;
  }
}

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

export function youTubeIdFromUrl(input: string): string | null {
  const trimmed = input.trim();
  if (VIDEO_ID.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.endsWith("youtu.be")) return url.pathname.replace(/^\//, "") || null;
    return url.searchParams.get("v");
  } catch {
    return null;
  }
}

/**
 * Fetch captions for a video id or URL. Returns null when no caption track is
 * available; throws when yt-dlp is missing or fails hard.
 */
export async function fetchYouTubeTranscript(
  input: string,
  options: { lang?: string; timeoutMs?: number } = {},
): Promise<Transcript | null> {
  const videoId = youTubeIdFromUrl(input);
  if (!videoId) throw new Error(`Not a YouTube video id or URL: ${input}`);

  const dir = await mkdtemp(path.join(tmpdir(), "cf-subs-"));
  try {
    const langs = options.lang ? [options.lang] : ["en.*", "en"];
    const args = [
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-format",
      "vtt",
      "--convert-subs",
      "vtt",
      "--sub-langs",
      langs.join(","),
      "-o",
      "%(id)s.%(ext)s",
      "--paths",
      dir,
      `https://www.youtube.com/watch?v=${videoId}`,
    ];
    const result = await run(ytDlpPath(), args, options.timeoutMs ?? 60_000);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".vtt"));
    if (files.length === 0) return null;

    // Prefer a manual (`subs`) track over an auto-caption one.
    const manual = files.find((f) => !/\.[a-z-]+\.vtt$/.test(f) || !f.includes(".auto."));
    const vtt = await readFile(path.join(dir, manual ?? files[0]), "utf8");
    const cues = parseVtt(vtt);
    if (cues.length === 0) return null;

    const file = manual ?? files[0];
    const langMatch = /\.([a-zA-Z-]+)\.vtt$/.exec(file);
    const source: TranscriptSource = file.includes(".auto.") ? "auto-subs" : "subs";
    void result;
    return buildTranscript({ videoId, lang: langMatch?.[1] ?? null, source, cues });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
