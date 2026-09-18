/**
 * Opt-in real publication certification budget (Phase 28).
 *
 * Ordinary unit/db/browser/CI must never hit YouTube (or other) publish APIs.
 * Real publication requires CONTENTFORGE_REAL_PUBLISH_E2E=1 and a durable
 * one-shot counter so accidental re-runs cannot spam the destination.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { JobFailure } from "../jobs/failures";

export const YOUTUBE_PUBLISH_CERT_KEY = "phase28.1-youtube-certification-v1";
export const MEDIA_CERT_MAX_YOUTUBE_PUBLISHES = 1;

type BudgetState = {
  youtubePublishes: number;
  youtubeCertKey?: string | null;
};

function budgetPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PUBLISH_CERT_BUDGET_PATH?.trim()
    || join(process.cwd(), ".scratch", "publish-cert-budget.json");
}

function readBudget(env: NodeJS.ProcessEnv = process.env): BudgetState {
  const path = budgetPath(env);
  if (!existsSync(path)) return { youtubePublishes: 0 };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as BudgetState;
    return {
      youtubePublishes: Number(parsed.youtubePublishes) || 0,
      youtubeCertKey: parsed.youtubeCertKey ?? null,
    };
  } catch {
    return { youtubePublishes: 0 };
  }
}

function writeBudget(state: BudgetState, env: NodeJS.ProcessEnv = process.env): void {
  const path = budgetPath(env);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function realPublishAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CONTENTFORGE_ALLOW_REAL_PUBLISH === "1") return true;
  return env.CONTENTFORGE_REAL_PUBLISH_E2E === "1";
}

export function publishCertificationMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CONTENTFORGE_REAL_PUBLISH_E2E === "1"
    && env.CONTENTFORGE_PUBLISH_CERTIFICATION === "1";
}

export function assertRealPublishAllowed(channel: string, env: NodeJS.ProcessEnv = process.env): void {
  if (realPublishAllowed(env)) return;
  throw JobFailure.permanent(
    `${channel} real publication is blocked without CONTENTFORGE_REAL_PUBLISH_E2E=1 `
      + `(or CONTENTFORGE_ALLOW_REAL_PUBLISH=1)`,
  );
}

export function assertYouTubeCertificationPublish(input: {
  regenerate?: boolean;
  certKey?: string | null;
  privacyStatus?: string | null;
}, env: NodeJS.ProcessEnv = process.env): void {
  // Hard privacy/budget guards apply only in explicit certification mode.
  // The real-network gate lives in authorizedFetch for Google hosts so unit
  // tests can exercise a local HTTP double without spending a publish quota.
  if (!publishCertificationMode(env)) return;
  assertRealPublishAllowed("youtube", env);
  if (input.regenerate) {
    throw JobFailure.permanent("YouTube certification forbids regenerate");
  }
  const privacy = (input.privacyStatus ?? "private").toLowerCase();
  if (privacy !== "private" && privacy !== "unlisted") {
    throw JobFailure.permanent("YouTube certification requires private or unlisted privacy");
  }
  const budget = readBudget(env);
  const max = Number(env.MEDIA_CERT_MAX_YOUTUBE_PUBLISHES ?? MEDIA_CERT_MAX_YOUTUBE_PUBLISHES);
  if (budget.youtubePublishes >= max) {
    throw JobFailure.permanent(
      `YouTube certification budget exhausted (${budget.youtubePublishes}/${max})`,
    );
  }
  if (
    input.certKey
    && budget.youtubeCertKey
    && budget.youtubeCertKey === input.certKey
    && budget.youtubePublishes > 0
  ) {
    throw JobFailure.permanent(
      `YouTube certification key "${input.certKey}" already consumed — reuse the durable Publication`,
    );
  }
}

export function recordYouTubeCertificationPublish(
  certKey: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!publishCertificationMode(env)) return;
  const budget = readBudget(env);
  budget.youtubePublishes += 1;
  if (certKey) budget.youtubeCertKey = certKey;
  writeBudget(budget, env);
}

export function readPublishCertificationBudget(env: NodeJS.ProcessEnv = process.env): BudgetState {
  return readBudget(env);
}
