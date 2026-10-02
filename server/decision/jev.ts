import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Jev (TypeSafe "System One") — the bounded decision layer.
 *
 * Jev answers *typed* questions about a `state` and returns probabilities, not
 * prose. ContentForge uses it at decision boundaries (research triage,
 * opportunity signals, content gate) — never inside every step.
 *
 * Two transports:
 *   - `api`  : POST {TYPESAFE_BASE_URL}/systemone with TYPESAFE_API_KEY (server default)
 *   - `cli`  : headless `cmd -p '<request>' -m typesafe/jev` (works where `cmd` is installed)
 *
 * `TYPESAFE_TRANSPORT=auto` (default) prefers `api` when a key is set, else `cli`.
 */

export type JevQuestionType = "noul" | "choice" | "score";

export type JevQuestionBase = {
  type: JevQuestionType;
  /** A string, or an object/array that can carry data the question refers to. */
  instructions: string | Record<string, unknown> | unknown[];
  criteria?: unknown;
};

export type JevQuestion = JevQuestionBase;

export type JevNoulAnswer = { type: "noul"; noul: number };
export type JevChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type JevScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};
export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export type JevResponse = {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
};

export type JevTransport = "api" | "cli";

const DEFAULT_BASE_URL = "https://api.typesafe.ai/v1";
const DEFAULT_MODEL = "jev-latest";

function baseUrl(): string {
  return (process.env.TYPESAFE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function jevModel(): string {
  return process.env.TYPESAFE_MODEL?.trim() || DEFAULT_MODEL;
}

export function jevApiKey(): string | null {
  return process.env.TYPESAFE_API_KEY?.trim() || null;
}

/** Which transport will be used, given env. */
export function jevTransport(): JevTransport | null {
  const configured = (process.env.TYPESAFE_TRANSPORT?.trim() || "auto").toLowerCase();
  if (configured === "api") return "api";
  if (configured === "cli") return "cli";
  return jevApiKey() ? "api" : "cli"; // auto
}

export function jevConfigured(): boolean {
  const t = jevTransport();
  if (t === "api") return Boolean(jevApiKey());
  if (t === "cli") return Boolean(process.env.JEV_CLI_ENABLED?.trim() === "1" || process.env.JEV_CLI_PATH?.trim());
  return false;
}

function redact(text: string): string {
  return text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/(api[_-]?key["':=\s]+)\S+/gi, "$1[redacted]");
}

/** Validate and normalize a Jev response body. Throws on a malformed shape. */
export function parseJevResponse(payload: unknown): JevResponse {
  if (!payload || typeof payload !== "object") throw new Error("JEV_INVALID_RESPONSE");
  const body = payload as Record<string, unknown>;
  const answers = body.answers;
  if (!answers || typeof answers !== "object") throw new Error("JEV_INVALID_RESPONSE");
  for (const [id, answer] of Object.entries(answers as Record<string, unknown>)) {
    const a = answer as Record<string, unknown>;
    if (a?.type === "noul") {
      if (typeof a.noul !== "number" || !Number.isFinite(a.noul)) throw new Error(`JEV_BAD_ANSWER:${id}`);
    } else if (a?.type === "choice") {
      if (typeof a.choice !== "string") throw new Error(`JEV_BAD_ANSWER:${id}`);
    } else if (a?.type === "score") {
      if (typeof a.score !== "number" || !Number.isFinite(a.score)) throw new Error(`JEV_BAD_ANSWER:${id}`);
    } else {
      throw new Error(`JEV_BAD_ANSWER:${id}`);
    }
  }
  const usage = (body.usage ?? {}) as Record<string, unknown>;
  return {
    model: typeof body.model === "string" ? body.model : jevModel(),
    answers: answers as Record<string, JevAnswer>,
    usage: {
      input_tokens: Number(usage.input_tokens) || 0,
      output_tokens: Number(usage.output_tokens) || 0,
    },
  };
}

async function jevDecideViaApi(
  state: unknown,
  questions: Record<string, JevQuestion>,
): Promise<JevResponse> {
  const key = jevApiKey();
  if (!key) throw new Error("TYPESAFE_CONFIG_MISSING");
  const body = JSON.stringify({ state, model: jevModel(), questions });

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${baseUrl()}/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(Number(process.env.TYPESAFE_TIMEOUT_MS ?? 30_000)),
    });
    if (res.status === 429 || res.status === 529) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      throw new Error(`JEV_RATE_LIMITED:${res.status}`);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        (json as { error?: { message?: string } } | null)?.error?.message || `HTTP ${res.status}`;
      throw new Error(redact(`JEV_REQUEST_FAILED: ${message}`));
    }
    return parseJevResponse(json);
  }
  throw new Error("JEV_REQUEST_FAILED");
}

async function jevDecideViaCli(
  state: unknown,
  questions: Record<string, JevQuestion>,
): Promise<JevResponse> {
  const bin = process.env.JEV_CLI_PATH?.trim() || "cmd";
  const request = JSON.stringify({ state, model: jevModel(), questions });
  try {
    const { stdout } = await execFileAsync(
      bin,
      ["-p", request, "-m", "typesafe/jev", "--skip-onboarding"],
      { timeout: Number(process.env.TYPESAFE_TIMEOUT_MS ?? 120_000), maxBuffer: 8 * 1024 * 1024 },
    );
    // The CLI may print framing lines; take the last balanced JSON object.
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("JEV_CLI_NO_JSON");
    return parseJevResponse(JSON.parse(stdout.slice(start, end + 1)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redact(`JEV_CLI_FAILED: ${message}`));
  }
}

/** Ask Jev a map of typed questions about a state. */
export async function jevDecide(
  state: unknown,
  questions: Record<string, JevQuestion>,
): Promise<JevResponse> {
  const transport = jevTransport();
  if (transport === "api") return jevDecideViaApi(state, questions);
  if (transport === "cli") return jevDecideViaCli(state, questions);
  throw new Error("TYPESAFE_CONFIG_MISSING");
}

// ── Research triage ──────────────────────────────────────────────────────────

export type ResearchCandidate = {
  id: string;
  title: string;
  summary?: string;
  url?: string;
  source?: string;
};

export type TriageContext = {
  expertise?: string;
  audience?: string;
  recentContent?: string[];
};

export const TRIAGE_SIGNAL_KEYS = [
  "relevance_to_expertise",
  "reach_potential",
  "novelty",
  "timeliness",
  "contentworthiness",
  "needs_deep_research",
] as const;
export type TriageSignalKey = (typeof TRIAGE_SIGNAL_KEYS)[number];
export type TriageSignals = Record<TriageSignalKey, number>;

export type TriageDecision = "drop" | "watch" | "pursue";
export type TriagedCandidate = ResearchCandidate & {
  signals: TriageSignals;
  score: number;
  decision: TriageDecision;
};

/** One noul question per signal, phrased as a bounded yes/no. */
export function buildTriageQuestions(): Record<TriageSignalKey, JevQuestion> {
  return {
    relevance_to_expertise: {
      type: "noul",
      instructions: "Is this directly relevant to the creator's stated expertise?",
      criteria: { true: "Squarely in their domain", false: "Outside their expertise" },
    },
    reach_potential: {
      type: "noul",
      instructions: "Does this have potential to generate meaningful audience interest?",
    },
    novelty: {
      type: "noul",
      instructions: "Does this contain a new development rather than a rehash of known material?",
    },
    timeliness: {
      type: "noul",
      instructions: "Is this timely and relevant right now (not stale)?",
    },
    contentworthiness: {
      type: "noul",
      instructions: "Is this worth turning into a piece of content?",
    },
    needs_deep_research: {
      type: "noul",
      instructions: "Does this justify further deep research before deciding?",
    },
  };
}

/** Triage thresholds — env-tunable, with sensible defaults. */
export function triageThresholds(): { pursue: number; watch: number } {
  return {
    pursue: Number(process.env.JEV_TRIAGE_PURSUE ?? 0.65),
    watch: Number(process.env.JEV_TRIAGE_WATCH ?? 0.45),
  };
}

/** Deterministic composite of the triage signals (NOT a Jev judgment). */
export function triageScore(s: TriageSignals): number {
  return (
    0.3 * s.relevance_to_expertise +
    0.25 * s.reach_potential +
    0.15 * s.novelty +
    0.15 * s.timeliness +
    0.15 * s.contentworthiness
  );
}

/** Turn signals into a bounded decision — pure, testable, no model. */
export function decideTriage(s: TriageSignals): TriageDecision {
  const score = triageScore(s);
  const { pursue, watch } = triageThresholds();
  if (score >= pursue && s.relevance_to_expertise >= 0.5 && s.contentworthiness >= 0.5) return "pursue";
  if (score >= watch) return "watch";
  return "drop";
}

function contextBlock(ctx: TriageContext): Record<string, unknown> {
  return {
    expertise: ctx.expertise ?? process.env.CONTENTFORGE_EXPERTISE ?? "platform engineering, Kubernetes, cloud cost",
    audience: ctx.audience ?? process.env.CONTENTFORGE_AUDIENCE ?? "platform engineers and SREs",
    recent_content: ctx.recentContent ?? [],
  };
}

/**
 * Triage a batch of candidates in ONE Jev request (questions are namespaced per
 * candidate). Returns each candidate with signals, composite score and decision.
 */
export async function triageCandidates(
  candidates: ResearchCandidate[],
  ctx: TriageContext = {},
): Promise<TriagedCandidate[]> {
  if (candidates.length === 0) return [];
  const base = buildTriageQuestions();
  const questions: Record<string, JevQuestion> = {};
  candidates.forEach((c, i) => {
    for (const key of TRIAGE_SIGNAL_KEYS) {
      // Each question must carry ITS candidate — otherwise Jev judges the whole
      // state and every candidate gets the same answer.
      questions[`c${i}__${key}`] = {
        ...base[key],
        instructions: { candidate: c, question: base[key].instructions as string },
      };
    }
  });

  const state = { context: contextBlock(ctx), candidates };
  const response = await jevDecide(state, questions);

  return candidates.map((c, i) => {
    const signals = {} as TriageSignals;
    for (const key of TRIAGE_SIGNAL_KEYS) {
      const answer = response.answers[`c${i}__${key}`];
      signals[key] = answer && answer.type === "noul" ? answer.noul : 0;
    }
    return { ...c, signals, score: Number(triageScore(signals).toFixed(4)), decision: decideTriage(signals) };
  });
}

// ── Opportunity score (Jev signals → deterministic composition) ──────────────

export type OpportunitySignals = {
  audience_relevance: number;
  novelty: number;
  timeliness: number;
  practitioner_value: number;
  discussion_potential: number;
  differentiation: number;
};

export const DEFAULT_OPPORTUNITY_WEIGHTS: Record<keyof OpportunitySignals, number> = {
  audience_relevance: 0.25,
  novelty: 0.15,
  timeliness: 0.2,
  practitioner_value: 0.2,
  discussion_potential: 0.1,
  differentiation: 0.1,
};

/** Weighted composition of Jev's signals — code decides the number, not Jev. */
export function composeOpportunityScore(
  signals: Partial<OpportunitySignals>,
  weights: Partial<Record<keyof OpportunitySignals, number>> = {},
): number {
  const w = { ...DEFAULT_OPPORTUNITY_WEIGHTS, ...weights };
  let total = 0;
  let weightSum = 0;
  for (const key of Object.keys(w) as (keyof OpportunitySignals)[]) {
    const value = signals[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    total += value * w[key];
    weightSum += w[key];
  }
  return weightSum === 0 ? 0 : Number((total / weightSum).toFixed(4));
}
