/**
 * Gemini native video understanding — the fallback for videos with no captions.
 *
 * The OpenAI-compatible lane cannot take a YouTube URL, but Gemini's **native**
 * `generateContent` accepts `file_data.file_uri` pointing at a YouTube video
 * directly. This is video-token priced, so it is *opt-in* (`VIDEO_GEMINI_FALLBACK=1`)
 * and only used when a transcript is unavailable.
 */

const DEFAULT_NATIVE_BASE = "https://generativelanguage.googleapis.com/v1beta";

export function geminiNativeKey(): string | null {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.AI_GEMINI_API_KEY?.trim() ||
    null
  );
}

export function geminiVideoFallbackEnabled(): boolean {
  return process.env.VIDEO_GEMINI_FALLBACK === "1" && Boolean(geminiNativeKey());
}

function nativeBaseUrl(): string {
  return (process.env.GEMINI_NATIVE_BASE_URL?.trim() || DEFAULT_NATIVE_BASE).replace(/\/+$/, "");
}

function videoModel(): string {
  return process.env.VIDEO_MAIN_MODEL?.trim() || "gemini-3.8-flash";
}

export type GeminiVideoNotes = { text: string; model: string; promptTokens: number; outputTokens: number };

/** Pure: pull the text out of a native generateContent response. */
export function parseGeminiText(payload: unknown): string {
  const candidate = (payload as any)?.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
}

export function parseGeminiUsage(payload: unknown): { promptTokens: number; outputTokens: number } {
  const u = (payload as any)?.usageMetadata ?? {};
  return { promptTokens: Number(u.promptTokenCount) || 0, outputTokens: Number(u.candidatesTokenCount) || 0 };
}

const NOTES_PROMPT = [
  "You are given a YouTube video with no usable captions.",
  "Produce a plain-text intelligence brief of its SPOKEN content, covering:",
  "- the core thesis in one sentence;",
  "- the 5-10 most specific, checkable claims or facts stated (with any numbers);",
  "- notable examples, tools or companies named;",
  "- anything a subject-matter expert would dispute or want to verify.",
  "Write prose, no markdown headings, no preamble. Do not invent claims that are not in the video.",
].join("\n");

/** Ask Gemini to read a YouTube video directly. Throws on failure. */
export async function geminiVideoNotes(
  url: string,
  options: { timeoutMs?: number; maxOutputTokens?: number } = {},
): Promise<GeminiVideoNotes> {
  const key = geminiNativeKey();
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = videoModel();

  const res = await fetch(`${nativeBaseUrl()}/models/${encodeURIComponent(model)}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ file_data: { file_uri: url } }, { text: NOTES_PROMPT }] }],
      generationConfig: { maxOutputTokens: options.maxOutputTokens ?? 2048 },
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (json as any)?.error?.message || `HTTP ${res.status}`;
    throw new Error(`gemini video understanding failed: ${message}`);
  }
  const text = parseGeminiText(json);
  const usage = parseGeminiUsage(json);
  if (!text) throw new Error("gemini video understanding returned no text");
  return { text, model, promptTokens: usage.promptTokens, outputTokens: usage.outputTokens };
}
