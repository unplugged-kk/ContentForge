import { aiCallRouted, safeJsonParse } from "../ai/chat";
import { resolveRoute } from "../ai/router";
import { getVideoSourceById, insertVideoClaims, listVideoChunks } from "./videoStorage";

/**
 * Claim extraction over transcript chunks (Tier 1/2).
 *
 * The transcript is already text, so this uses the text model lane routed for
 * the task — `video.extract` maps to Gemini in production. One call per chunk,
 * bounded by `maxChunks`; claims land in `video_claims` with provenance
 * (chunk, timestamp, model).
 *
 * JSON is requested in the prompt rather than via `response_format`, because the
 * provider is env-switched and not every backend honours that field.
 */

export type ExtractedClaim = { claim: string; confidence: number | null; risk: string | null };
export type ParsedExtraction = { relevant: boolean; claims: ExtractedClaim[] };

const RISKS = new Set(["low", "medium", "high"]);

const EXTRACT_SYSTEM_PROMPT = [
  "You extract publishable claims from one chunk of a YouTube transcript.",
  'Respond ONLY with JSON of the form {"relevant": boolean, "claims": [{"claim": string, "confidence": number, "risk": "low"|"medium"|"high"}]}.',
  "Rules:",
  "- A claim is a specific, checkable assertion — not a platitude, not filler.",
  "- Extract at most 5 claims; prefer fewer, higher-quality claims.",
  "- confidence is 0..1 (how well the chunk supports the claim).",
  "- If the chunk is intro/outro/music/ad reads or has no substance, set relevant=false and claims=[].",
].join("\n");

/** Pure: parse and bound a model's extraction response. */
export function parseClaimExtraction(content: string): ParsedExtraction {
  const parsed = safeJsonParse(content);
  if (!parsed || typeof parsed !== "object") return { relevant: false, claims: [] };
  // An explicit "not relevant" means no claims, whatever else came back.
  if ((parsed as any).relevant === false) return { relevant: false, claims: [] };
  const rawClaims = Array.isArray((parsed as any).claims) ? (parsed as any).claims : [];
  const claims: ExtractedClaim[] = [];
  for (const raw of rawClaims.slice(0, 5)) {
    if (!raw || typeof raw.claim !== "string" || !raw.claim.trim()) continue;
    const confidence =
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? Math.max(0, Math.min(1, raw.confidence))
        : null;
    const risk = typeof raw.risk === "string" && RISKS.has(raw.risk.toLowerCase()) ? raw.risk.toLowerCase() : null;
    claims.push({ claim: raw.claim.trim().slice(0, 2000), confidence, risk });
  }
  return { relevant: claims.length > 0, claims };
}

export type VideoExtractSummary = {
  sourceId: number;
  chunksProcessed: number;
  claimsInserted: number;
  model: string;
  task: string;
};

export async function extractVideoClaims(
  sourceId: number,
  options: { maxChunks?: number } = {},
): Promise<VideoExtractSummary> {
  const source = await getVideoSourceById(sourceId);
  if (!source) throw new Error(`video source ${sourceId} not found`);

  const chunks = await listVideoChunks(sourceId);
  const maxChunks = Math.max(1, Math.min(options.maxChunks ?? 20, 100));
  const task = "video.extract" as const;
  const model = resolveRoute(task).model;

  let chunksProcessed = 0;
  let claimsInserted = 0;

  for (const chunk of chunks.slice(0, maxChunks)) {
    const { content } = await aiCallRouted(
      [
        { role: "system", content: EXTRACT_SYSTEM_PROMPT },
        { role: "user", content: chunk.text },
      ],
      { task },
    );
    chunksProcessed += 1;
    const parsed = parseClaimExtraction(content);
    if (!parsed.relevant || parsed.claims.length === 0) continue;

    const rows = parsed.claims.map((claim) => ({
      sourceId,
      chunkId: chunk.id,
      claim: claim.claim,
      confidence: claim.confidence,
      extractionModel: model,
      sourceUrl: source.url,
      timestampMs: chunk.startMs,
      risk: claim.risk,
    }));
    await insertVideoClaims(rows);
    claimsInserted += rows.length;
  }

  return { sourceId, chunksProcessed, claimsInserted, model, task };
}
