/**
 * Publish gate — the ContentForge-side half of the `publish_gate` decision.
 *
 * Consulted by the ONE unattended path that can approve content: trusted
 * automation (`settleTrustedArtifact`). A `hold` there is a normal outcome — the
 * artifact simply stays in the human review queue — so a gate that fails closed
 * can never strand anything or block an operator.
 *
 * It cannot override a hard constraint. Approval, ownership, readiness and the
 * publication leases all still run exactly as they do today; this only decides
 * whether an *unattended* path may proceed.
 */

import { decide } from "../decision/engine";
import { decisionTypeEnabled } from "../decision/policies";
import type { PublishGateDecision } from "../decision/schemas";
import { computeQualitySignals, qualitySignalRecord } from "../intelligence/quality";
import { getFormatProfile } from "./formatProfiles";
import { extractBody } from "./learning/edit";
import type { JsonRecord } from "./storage";

export type PublishGateOutcomeValue = "publish" | "hold" | "reject";

export interface PublishGateInput {
  artifactId: number;
  userId?: number | null;
  format: string;
  channel: string;
  payload: JsonRecord;
}

export interface PublishGateOutcome {
  outcome: PublishGateOutcomeValue;
  score: number | null;
  reasons: string[];
  fallback: boolean;
  policyId: string;
  policyVersion: string;
  flags: string[];
}

export interface PublishGatePort {
  review(input: PublishGateInput): Promise<PublishGateOutcome>;
}

export interface PublishGateDeps {
  /** Injected for tests; defaults to the real engine entry point. */
  decide?: typeof decide;
}

export function createJevPublishGate(deps: PublishGateDeps = {}): PublishGatePort {
  const run = deps.decide ?? decide;

  return {
    async review(input: PublishGateInput): Promise<PublishGateOutcome> {
      const body = extractBody(input.payload);
      const profile = getFormatProfile(input.format, input.channel)?.constraints ?? {};
      const signals = computeQualitySignals(
        { text: body.text, units: body.units, hook: body.hook, cta: body.cta },
        profile,
      );

      const result = await run<PublishGateDecision>({
        type: "publish_gate",
        state: {
          platform: {
            channel: input.channel,
            format: input.format,
            maxCharacters: profile.maxCharacters,
            hookFirst: profile.hookFirst,
            cta: profile.cta,
          },
          quality: { signals: qualitySignalRecord(signals), flags: signals.flags },
        },
        refs: { artifactId: input.artifactId },
        userId: input.userId ?? null,
      });

      const decision = result.decision as PublishGateDecision;
      return {
        outcome: decision.outcome,
        score: decision.score,
        reasons: result.reasons,
        fallback: result.fallback,
        policyId: result.policyId,
        policyVersion: result.policyVersion,
        flags: signals.flags,
      };
    },
  };
}

/**
 * The gate as the application wires it: present only when the decision layer and
 * JEV_PUBLISH_GATE are both on. Absent ⇒ trusted automation behaves exactly as
 * it did before.
 */
export function createContentPublishGate(): PublishGatePort | undefined {
  if (!decisionTypeEnabled("publish_gate")) return undefined;
  return createJevPublishGate();
}
