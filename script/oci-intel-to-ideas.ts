#!/usr/bin/env node
/**
 * D22 item 2 — turn the laptop's intel into ContentForge ideas.
 *
 * APPROVED SCOPE: DECISIONS.md Group 4 / D22 ("turn the laptop's intel into
 * ContentForge ideas"). Uses the app's own service layer (storage.
 * createDiscoveredIdeas) — no raw SQL insert — and R7 lineage rules are not
 * touched: this writes discovered_ideas only, never artifacts/opportunities.
 *
 * SAFETY: writes rows with status='new'. `assertEligibleForXPublish` only
 * publishes rows whose post status is 'scheduled', and this script never
 * creates a post at all. No publish path, no approval call, no submit call.
 * It also never calls aiCall with a prompt of its own invention: the seeds are
 * sections of the laptop's real intel file, and every seed is asserted to be
 * present verbatim before any model call.
 *
 * Idempotent: batch_id is fixed per intel date; a second run detects the
 * existing batch and exits 0 without writing.
 *
 * RUN 56 — this script used to be single-shot. The intel path, the batch id and
 * a `https://lspace.beehiiv.com/...` provenance assertion were all constants, so
 * it worked for 2026-11-23 and threw on 2026-11-24 ("no episode URL found") even
 * though that brief had 17 usable sections and real `- source:` lines. Parsing
 * and attribution moved to `script/intelBridge.ts` (pure, tested, control-proven),
 * the intel file became an argument, and provenance is now asserted on the
 * `- source:` line that the intel loop actually writes.
 *
 * Usage (host, repo root):
 *   node_modules/.bin/tsx script/oci-intel-to-ideas.ts [--intel <path>] [--dry-run]
 *   (no --intel: the newest YYYY-MM-DD.md in the laptop's intel dir)
 */
import "dotenv/config";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  parseIntelBrief,
  assertTraceableBrief,
  batchIdFor,
  type IntelSeed,
} from "./intelBridge";

const OWNER_ID = 1;
const DRY = process.argv.includes("--dry-run");
const HOME = process.env.HOME ?? "/home/ubuntu";
const INTEL_DIR = path.join(HOME, "agent-control-room/agents/laptop/intel");
const MAX_IDEAS = 12;

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : null;
}

/** Newest YYYY-MM-DD.md in the intel dir. */
function newestIntelFile(dir: string): string {
  const days = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort();
  if (!days.length) throw new Error(`no YYYY-MM-DD.md intel briefs in ${dir}`);
  return path.join(dir, days[days.length - 1]);
}

// The host must talk to the published DB port, not the compose service name.
const HOST_DB_URL =
  process.env.D22_DATABASE_URL ??
  process.env.DATABASE_URL?.replace("@postgres:5432", "@127.0.0.1:5432");
if (!HOST_DB_URL) throw new Error("DATABASE_URL not resolvable for host use");
process.env.DATABASE_URL = HOST_DB_URL;

function assert(v: unknown, m: string): asserts v {
  if (!v) throw new Error(m);
}

async function main() {
  const explicit = argValue("--intel");
  const INTEL = explicit ? path.resolve(explicit) : newestIntelFile(INTEL_DIR);
  assert(existsSync(INTEL), `intel file missing: ${INTEL}`);

  const intelDate = path.basename(INTEL, ".md");
  const BATCH = batchIdFor(intelDate);

  const text = readFileSync(INTEL, "utf8");
  const brief = parseIntelBrief(text);
  assertTraceableBrief(brief, INTEL);

  const seeds: IntelSeed[] = brief.seeds;
  assert(seeds.length > 0, `no usable intel sections in ${INTEL}`);
  const seedsWithSource = seeds.filter((s) => s.sourceUrl).length;

  console.log(`intel   ${INTEL}`);
  console.log(`items   ${brief.items.length} · ${brief.items.join(" | ").slice(0, 120)}`);
  console.log(`seeds   ${seeds.length} sections · ${seedsWithSource} with a source url`);
  console.log(`batch   ${BATCH}`);

  const { storage } = await import("../server/storage");
  const { aiCall, logAiUsage, safeJsonParse } = await import("../server/ai/chat");

  const prior = await storage.getDiscoveredIdeas(OWNER_ID, BATCH);
  if (prior.length > 0) {
    console.log(`SKIP    batch ${BATCH} already has ${prior.length} ideas — nothing to do`);
    process.exit(0);
  }

  const system =
    `You convert a research brief into content ideas for a senior Infrastructure Engineering Lead ` +
    `(11+ yrs, AI + DevOps + Platform Engineering) who posts on X to engineers and tech leads. ` +
    `Every idea must be traceable to ONE of the numbered sections supplied. Do not invent facts, ` +
    `numbers or quotes that are not in the section text. Return JSON only.`;

  const user =
    `Sections from today's intel brief (verbatim):\n\n` +
    seeds
      .map((s, i) => `[S${i + 1}] ${s.heading}\n${s.body}`)
      .join("\n\n---\n\n") +
    `\n\nReturn at most ${MAX_IDEAS} content ideas as JSON:\n` +
    `{"ideas":[{"section":"S1","rank":1,"title":"scroll-stopping idea title (<=120 chars)",` +
    `"description":"2-3 sentences: the angle and why an infrastructure engineer cares",` +
    `"summary":"one line","source_inspiration":"the exact section heading this came from",` +
    `"source_url":"the section's own source url if given above, else null",` +
    `"source_type":"rss","category":"ai|devops|mlops|tech|leadership|system_design|ai_research|kubernetes|platform_engineering|sre|finops|security|iac",` +
    `"content_type_suggestion":"thread|tweet|long_thread|hot_take",` +
    `"content_angles":["technical deep dive","contrarian take","story/experience"],` +
    `"viral_score":7.5,"viral_reasoning":"why this performs for this audience",` +
    `"value_proposition":"what the reader gains","unique_angle":"why his production experience adds credibility",` +
    `"timeliness":"evergreen|trending_now|this_week","target_audience":"specific sub-audience",` +
    `"suggested_hook":"first line draft","hashtag_suggestions":["2-3 tags"]}]}\n` +
    `Rank by AI/DevOps intersection weight, then value density. Only sections that genuinely ` +
    `contain an actionable technical point — skip opinion/vibes sections entirely.`;

  const { content, usage, latency } = await aiCall(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    true,
  );
  await logAiUsage(usage, latency, "intel_to_ideas");

  let parsed = safeJsonParse(content);
  if (!parsed?.ideas?.length) {
    const retry = await aiCall(
      [
        { role: "system", content: system },
        { role: "user", content: user },
        { role: "user", content: "Return ONLY the JSON object. No prose, no fences." },
      ],
      true,
    );
    await logAiUsage(retry.usage, retry.latency, "intel_to_ideas");
    parsed = safeJsonParse(retry.content);
  }
  assert(parsed?.ideas?.length, "model returned no usable ideas JSON");

  // Guard: a source_inspiration that is not in the brief would mean the model
  // invented provenance. Refuse rather than persist an untraceable row.
  // Compared on letters+digits only: the model legitimately re-quotes or
  // re-punctuates a heading, and that is not the defect this guard is for.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const headings = seeds.map((s) => norm(s.heading));

  /**
   * Run 56: source_url is taken from the SEED the idea was attributed to, not
   * from the model. The model may echo a url it saw, but only a url that the
   * brief actually carries under that section is allowed to be persisted —
   * otherwise a plausible-looking link becomes a row that claims provenance it
   * does not have. The model's own url is used only as a tie-break when the
   * section genuinely carries one and they agree on host.
   */
  const rows = parsed.ideas.slice(0, MAX_IDEAS).map((idea: any, i: number) => {
    const si = norm(String(idea.source_inspiration ?? ""));
    assert(si.length >= 20, `idea ${i + 1} has no usable source_inspiration`);
    const seedIdx = seeds.findIndex(
      (s, k) =>
        norm(s.heading).includes(si.slice(0, 30)) ||
        si.includes(norm(s.heading).slice(0, 30)),
    );
    assert(seedIdx >= 0, `idea ${i + 1} has untraceable source_inspiration: "${idea.source_inspiration}"`);
    const seed = seeds[seedIdx];

    let sourceUrl = seed.sourceUrl;
    const modelUrl = idea.source_url;
    if (sourceUrl && modelUrl && /^https?:\/\//.test(String(modelUrl))) {
      try {
        // Only accept the model's url if it is the "same origin of fact" — the
        // brief's own url wins on any disagreement.
        if (new URL(String(modelUrl)).host !== new URL(sourceUrl).host) sourceUrl = seed.sourceUrl;
      } catch {
        sourceUrl = seed.sourceUrl;
      }
    }

    return {
      rank: Number(idea.rank) || i + 1,
      title: String(idea.title ?? "").slice(0, 500),
      description: idea.description ?? null,
      summary: idea.summary ?? null,
      sourceInspiration: String(idea.source_inspiration),
      sourceUrl: sourceUrl ?? null,
      sourceType: "rss",
      category: idea.category ?? null,
      contentTypeSuggestion: idea.content_type_suggestion ?? null,
      contentAngles: Array.isArray(idea.content_angles) ? idea.content_angles : [],
      pillarId: null,
      viralScore: String(Math.min(9.9, Math.max(1.0, Number(idea.viral_score) || 5.0))),
      viralReasoning: idea.viral_reasoning ?? null,
      valueProposition: idea.value_proposition ?? null,
      uniqueAngle: idea.unique_angle ?? null,
      timeliness: idea.timeliness ?? "evergreen",
      targetAudience: idea.target_audience ?? null,
      suggestedHook: idea.suggested_hook ?? null,
      hashtagSuggestions: Array.isArray(idea.hashtag_suggestions) ? idea.hashtag_suggestions : [],
      batchId: BATCH,
      status: "new",
    };
  });

  console.log(`\nmodel produced ${rows.length} idea(s):`);
  for (const r of rows) console.log(`  ${r.rank}. [${r.viralScore}] ${r.title.slice(0, 88)}`);

  if (DRY) {
    console.log("\nDRY RUN — nothing written.");
    process.exit(0);
  }

  const saved = await storage.createDiscoveredIdeas(OWNER_ID, rows as any);
  console.log(`\nWROTE ${saved.length} idea(s) batch=${BATCH} owner=${OWNER_ID}`);
  console.log("RESULT " + JSON.stringify(saved.map((s) => ({ id: s.id, rank: s.rank, score: s.viralScore }))));
  process.exit(0);
}

main().catch((e) => {
  console.error("intel->ideas FAILED:", e?.message ?? e);
  process.exit(1);
});
