/**
 * Phase 29.4 §43/§44 -- Agent and self-modification negative tests.
 *
 * §43: the Agent may propose (hypotheses, experiments, evaluation requests)
 * but must NEVER be able to directly execute an autonomous activation or
 * rollback, and must NEVER be able to mutate autonomy configuration
 * (limits, evidence threshold, kill switch, circuit breaker). §44: the
 * autonomy controller itself must not be able to modify its own rules,
 * thresholds, budgets, kill switch, or authorization -- it may only write
 * to `autonomy_decisions` (its own append-only journal) and, via
 * `openCircuitBreaker`, flip its OWN config to a MORE restrictive state,
 * never a less restrictive one.
 *
 * Same methodology as `policyActivationDenial.test.ts`: pure static source
 * analysis, no live DB/AI credentials required, because the agent tool
 * registry is a fixed allowlist declared directly in source -- there is no
 * dynamic dispatch to reach around.
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

describe("agent cannot execute or configure autonomy (Phase 29.4 §43)", () => {
  it("no declared agent tool name is autonomy-execution or autonomy-config capable", () => {
    const suspicious: string[] = [];
    for (const file of agentSourceFiles()) {
      const text = readFileSync(join(AGENT_DIR, file), "utf8");
      for (const match of text.matchAll(/name:\s*"([^"]+)"/g)) {
        if (/autonom(y|ous)/i.test(match[1])) suspicious.push(`${file}:${match[1]}`);
      }
    }
    assert.deepEqual(suspicious, [], `agent tool declarations must not expose autonomy execution/config, found: ${suspicious.join(", ")}`);
  });

  it("no agent-tier source file imports the autonomy controller or config module", () => {
    const offenders: string[] = [];
    for (const file of agentSourceFiles()) {
      const text = readFileSync(join(AGENT_DIR, file), "utf8");
      if (/content\/autonomy|executeAutonomousActivation|executeAutonomousRollback|updateAutonomyConfig|resetCircuitBreaker/.test(text)) {
        offenders.push(file);
      }
    }
    assert.deepEqual(offenders, [], `agent-tier files must never reference autonomy execution or config: ${offenders.join(", ")}`);
  });
});

describe("autonomy controller cannot modify its own rules (Phase 29.4 §44)", () => {
  const CONTROLLER_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), "content", "autonomy", "controller.ts");

  it("the controller module never writes to autonomy_configs except via openCircuitBreaker (a MORE restrictive, one-way flip)", () => {
    const text = readFileSync(CONTROLLER_PATH, "utf8");
    // The controller must not call the human-only mutators directly.
    for (const forbidden of ["updateAutonomyConfig(", "resetCircuitBreaker(", "disableAutonomy(", "pauseAutonomy("]) {
      assert.ok(!text.includes(forbidden), `controller.ts must never call the human-only mutator ${forbidden}`);
    }
    // It may only import the read path plus the one-way-restrictive opener.
    const importMatch = text.match(/from "\.\/config";\s*\n?import \{ openCircuitBreaker \} from "\.\/config";|import \{ getAutonomyConfig \} from "\.\/config";\s*\nimport \{ openCircuitBreaker \} from "\.\/config";/);
    assert.ok(text.includes('import { getAutonomyConfig } from "./config";'), "controller must read config via getAutonomyConfig");
    assert.ok(text.includes('import { openCircuitBreaker } from "./config";'), "controller may only additionally open the breaker");
  });

  it("the controller module never issues raw SQL against generation_policies -- all mutation goes through the Phase 29.3 service", () => {
    const text = readFileSync(CONTROLLER_PATH, "utf8");
    assert.ok(!/generationPolicies\)\s*\n?\s*\.set\(/.test(text), "controller.ts must never UPDATE generation_policies directly");
    assert.ok(!/\.insert\(generationPolicies\)/.test(text), "controller.ts must never INSERT into generation_policies directly");
    assert.ok(text.includes("activatePolicyCandidate"), "controller.ts must delegate activation to the existing Phase 29.3 service");
    assert.ok(text.includes("rollbackPolicyForCandidate"), "controller.ts must delegate rollback to the existing Phase 29.3 service");
  });

  it("the human-settable config patch schema does not accept circuitBreakerState (only resetCircuitBreaker, always -> closed, may set it)", () => {
    const routesPath = join(dirname(dirname(fileURLToPath(import.meta.url))), "content", "autonomy", "routes.ts");
    const text = readFileSync(routesPath, "utf8");
    const schemaMatch = text.match(/const configPatchSchema = z\.object\(\{([\s\S]*?)\}\);/);
    assert.ok(schemaMatch, "configPatchSchema must exist");
    assert.ok(!schemaMatch![1].includes("circuitBreakerState"), "configPatchSchema must never accept circuitBreakerState from a client");
  });
});
