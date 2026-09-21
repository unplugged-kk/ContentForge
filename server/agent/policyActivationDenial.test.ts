/**
 * Phase 29.3 §20/§36 -- Agent negative test.
 *
 * The Agent may create/propose (via the closed content pipeline: Story ->
 * Opportunity -> GenerationJob) but must NEVER be able to activate a
 * production policy. There is no dynamic dispatch in the agent tool layer --
 * the registry is a fixed allowlist of tool definitions declared directly in
 * source -- so this is a pure static-source proof (no live DB/AI credentials
 * required, matching how the equivalent Phase 29.2 §27 proof was done):
 * every declared tool name is enumerated and none is activation-capable, and
 * no agent-tier file imports the activation service at all.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const AGENT_DIR = dirname(fileURLToPath(import.meta.url));

function agentSourceFiles(): string[] {
  return readdirSync(AGENT_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".dbtest.ts"));
}

describe("agent cannot activate a production policy (Phase 29.3)", () => {
  it("no declared agent tool name is activation/rollback-capable", () => {
    const suspicious: string[] = [];
    for (const file of agentSourceFiles()) {
      const text = readFileSync(join(AGENT_DIR, file), "utf8");
      for (const match of text.matchAll(/name:\s*"([^"]+)"/g)) {
        if (/(activat|rollback).*polic|polic.*(activat|rollback)/i.test(match[1])) suspicious.push(`${file}:${match[1]}`);
      }
    }
    assert.deepEqual(suspicious, [], `agent tool declarations must not expose activation, found: ${suspicious.join(", ")}`);
  });

  it("no agent-tier source file imports the policy activation service", () => {
    const offenders: string[] = [];
    for (const file of agentSourceFiles()) {
      const text = readFileSync(join(AGENT_DIR, file), "utf8");
      if (/policyActivation|activatePolicyCandidate|rollbackPolicyForCandidate/.test(text)) {
        offenders.push(file);
      }
    }
    assert.deepEqual(offenders, [], `agent-tier files must never reference policy activation: ${offenders.join(", ")}`);
  });
});
