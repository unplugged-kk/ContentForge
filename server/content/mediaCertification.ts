/**
 * Paid media certification budget.
 *
 * Ordinary automated tests (unit/db/e2e/browser) must never call ElevenLabs or
 * fal.ai. Real paid calls require explicit certification flags and a durable
 * one-shot counter so accidental re-runs cannot burn the user's quota.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { JobFailure } from "../jobs/failures";

export const ELEVENLABS_CERT_KEY = "phase27.3-elevenlabs-certification-v1";
export const FAL_CERT_KEY = "phase27.3-fal-certification-v1";

export const MEDIA_CERT_MAX_ELEVENLABS_CALLS = 1;
export const MEDIA_CERT_MAX_FAL_CALLS = 1;
export const MEDIA_CERT_MAX_ELEVENLABS_CHARS = 200;
export const MEDIA_CERT_MAX_FAL_DURATION_MS = 2_000;
export const MEDIA_CERT_ALLOWED_FAL_RESOLUTIONS = new Set(["480p"]);

type BudgetState = {
  elevenlabsCalls: number;
  falCalls: number;
  elevenlabsCertKey?: string | null;
  falCertKey?: string | null;
};

function budgetPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.MEDIA_CERT_BUDGET_PATH?.trim()
    || join(process.cwd(), ".scratch", "media-cert-budget.json");
}

function readBudget(env: NodeJS.ProcessEnv = process.env): BudgetState {
  const path = budgetPath(env);
  if (!existsSync(path)) return { elevenlabsCalls: 0, falCalls: 0 };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as BudgetState;
    return {
      elevenlabsCalls: Number(parsed.elevenlabsCalls) || 0,
      falCalls: Number(parsed.falCalls) || 0,
      elevenlabsCertKey: parsed.elevenlabsCertKey ?? null,
      falCertKey: parsed.falCertKey ?? null,
    };
  } catch {
    return { elevenlabsCalls: 0, falCalls: 0 };
  }
}

function writeBudget(state: BudgetState, env: NodeJS.ProcessEnv = process.env): void {
  const path = budgetPath(env);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

/** Certification / paid escape hatch. Absent in ordinary unit/db/browser runs. */
export function paidMediaCallsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CONTENTFORGE_ALLOW_PAID_MEDIA === "1") return true;
  return env.CONTENTFORGE_REAL_MEDIA_E2E === "1"
    && env.CONTENTFORGE_MEDIA_CERTIFICATION === "1";
}

export function assertPaidMediaAllowed(providerId: string, env: NodeJS.ProcessEnv = process.env): void {
  if (paidMediaCallsAllowed(env)) return;
  throw JobFailure.permanent(
    `${providerId} paid generation is blocked without CONTENTFORGE_REAL_MEDIA_E2E=1 `
      + `and CONTENTFORGE_MEDIA_CERTIFICATION=1 (or CONTENTFORGE_ALLOW_PAID_MEDIA=1)`,
  );
}

/** True only for the explicit one-shot Phase 27.3 certification envelope. */
export function mediaCertificationMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CONTENTFORGE_REAL_MEDIA_E2E === "1"
    && env.CONTENTFORGE_MEDIA_CERTIFICATION === "1";
}

export function assertElevenLabsCertificationRequest(input: {
  text: string;
  regenerate?: boolean;
  certKey?: string | null;
}, env: NodeJS.ProcessEnv = process.env): void {
  assertPaidMediaAllowed("elevenlabs", env);
  // Hard duration/length/budget guards apply only in certification mode —
  // they are not permanent provider capability limits.
  if (!mediaCertificationMode(env)) return;
  if (input.regenerate) {
    throw JobFailure.permanent("ElevenLabs certification forbids regenerate");
  }
  if (input.text.length > MEDIA_CERT_MAX_ELEVENLABS_CHARS) {
    throw JobFailure.permanent(
      `ElevenLabs certification text exceeds ${MEDIA_CERT_MAX_ELEVENLABS_CHARS} characters`,
    );
  }
  const budget = readBudget(env);
  const max = Number(env.MEDIA_CERT_MAX_ELEVENLABS_CALLS ?? MEDIA_CERT_MAX_ELEVENLABS_CALLS);
  if (budget.elevenlabsCalls >= max) {
    throw JobFailure.permanent(
      `ElevenLabs certification budget exhausted (${budget.elevenlabsCalls}/${max})`,
    );
  }
  if (
    input.certKey
    && budget.elevenlabsCertKey
    && budget.elevenlabsCertKey === input.certKey
    && budget.elevenlabsCalls > 0
  ) {
    throw JobFailure.permanent(
      `ElevenLabs certification key "${input.certKey}" already consumed — reuse the durable generation`,
    );
  }
}

export function recordElevenLabsCertificationCall(
  certKey: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!mediaCertificationMode(env)) return;
  const budget = readBudget(env);
  budget.elevenlabsCalls += 1;
  if (certKey) budget.elevenlabsCertKey = certKey;
  writeBudget(budget, env);
}

export function assertFalCertificationRequest(input: {
  resolution?: string | null;
  durationMs?: number | null;
  numFrames?: number | null;
  framesPerSecond?: number | null;
  regenerate?: boolean;
  certKey?: string | null;
}, env: NodeJS.ProcessEnv = process.env): void {
  assertPaidMediaAllowed("fal", env);
  if (!mediaCertificationMode(env)) return;
  if (input.regenerate) {
    throw JobFailure.permanent("fal certification forbids regenerate");
  }
  const resolution = input.resolution ?? "480p";
  if (!MEDIA_CERT_ALLOWED_FAL_RESOLUTIONS.has(resolution)) {
    throw JobFailure.permanent(`fal certification resolution must be 480p (got ${resolution})`);
  }
  const fps = input.framesPerSecond ?? 16;
  const frames = input.numFrames ?? 17;
  const durationMs = input.durationMs
    ?? Math.round((frames / Math.max(1, fps)) * 1000);
  if (durationMs > MEDIA_CERT_MAX_FAL_DURATION_MS) {
    throw JobFailure.permanent(
      `fal certification duration ${durationMs}ms exceeds ${MEDIA_CERT_MAX_FAL_DURATION_MS}ms`,
    );
  }
  const budget = readBudget(env);
  const max = Number(env.MEDIA_CERT_MAX_FAL_CALLS ?? MEDIA_CERT_MAX_FAL_CALLS);
  if (budget.falCalls >= max) {
    throw JobFailure.permanent(`fal certification budget exhausted (${budget.falCalls}/${max})`);
  }
  if (
    input.certKey
    && budget.falCertKey
    && budget.falCertKey === input.certKey
    && budget.falCalls > 0
  ) {
    throw JobFailure.permanent(
      `fal certification key "${input.certKey}" already consumed — reuse the durable generation`,
    );
  }
}

export function recordFalCertificationCall(
  certKey: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!mediaCertificationMode(env)) return;
  const budget = readBudget(env);
  budget.falCalls += 1;
  if (certKey) budget.falCertKey = certKey;
  writeBudget(budget, env);
}

export function readMediaCertificationBudget(env: NodeJS.ProcessEnv = process.env): BudgetState {
  return readBudget(env);
}
