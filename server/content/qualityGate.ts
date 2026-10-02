/**
 * Quality gate — the ContentForge-side half of the `quality_gate` decision.
 *
 * The decision layer decides; this module is the seam that lets the Artifact
 * domain ask it. It does three things and nothing else:
 *
 *   1. turn an Artifact payload into text (`extractBody` — the same extractor
 *      the learning layer uses, so both agree on what the content IS),
 *   2. compute the deterministic quality signals,
 *   3. ask the engine, and hand back a plain outcome.
 *
 * It never blocks on its own and never approves anything: `approve` means "no
 * objection", and approval itself stays a human (or explicitly `trusted`) step.
 *
 * FAILURE SEMANTICS. On any failure the engine produces `hold` (the policy's
 * declared fail-closed fallback). `hold` is deliberately NOT a block: an outage
 * must not stop a human from submitting content for review, and it can never
 * cause a publish — only `approved` artifacts are schedulable. So the human path
 * degrades gracefully while the safety property is preserved.
 */

import { decide } from "../decision/engine";
import { decisionTypeEnabled } from "../decision/policies";
import type { QualityGateDecision } from "../decision/schemas";
import { computeQualitySignals, qualitySignalRecord } from "../intelligence/quality";
import { getFormatProfile } from "./formatProfiles";
import { extractBody } from "./learning/edit";
import type { JsonRecord } from "./storage";

export type QualityGateOutcomeValue = "approve" | "revise" | "reject" | "hold";

export interface QualityGateInput {
  artifactId: number;
  userId?: number | null;
  format: string;
  channel: string;
  payload: JsonRecord;
}

export interface QualityGateOutcome {
  outcome: QualityGateOutcomeValue;
  score: number | null;
  reasons: string[];
  /** true ⇒ the engine's declared fallback produced this (Jev unavailable). */
  fallback: boolean;
  policyId: string;
  policyVersion: string;
  /** The deterministic evidence the decision rested on. */
  signals: Record<string, number>;
  flags: string[];
}

export interface QualityGatePort {
  review(input: QualityGateInput): Promise<QualityGateOutcome>;
}

export interface QualityGateDeps {
  /** Injected for tests; defaults to the real engine entry point. */
  decide?: typeof decide;
}

export function createJevQualityGate(deps: QualityGateDeps = {}): QualityGatePort {
  const run = deps.decide ?? decide;

  return {
    async review(input: QualityGateInput): Promise<QualityGateOutcome> {
      const body = extractBody(input.payload);
      const profile = getFormatProfile(input.format, input.channel)?.constraints ?? {};
      const signals = computeQualitySignals(
        { text: body.text, units: body.units, hook: body.hook, cta: body.cta },
        profile,
      );
      const signalRecord = qualitySignalRecord(signals);

      const result = await run<QualityGateDecision>({
        type: "quality_gate",
        state: {
          platform: {
            channel: input.channel,
            format: input.format,
            maxCharacters: profile.maxCharacters,
            hookFirst: profile.hookFirst,
            cta: profile.cta,
          },
          quality: { signals: signalRecord, flags: signals.flags },
        },
        refs: { artifactId: input.artifactId },
        userId: input.userId ?? null,
      });

      const decision = result.decision as QualityGateDecision;
      return {
        outcome: decision.outcome,
        score: decision.score,
        reasons: result.reasons,
        fallback: result.fallback,
        policyId: result.policyId,
        policyVersion: result.policyVersion,
        signals: signalRecord,
        flags: signals.flags,
      };
    },
  };
}

/**
 * The gate as the application wires it: present only when the decision layer and
 * this decision's flag are both on. Absent ⇒ submission behaves exactly as before.
 */
export function createContentQualityGate(): QualityGatePort | undefined {
  if (!decisionTypeEnabled("quality_gate")) return undefined;
  return createJevQualityGate();
}
