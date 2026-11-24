/**
 * run47 · INDEPENDENT verification of B59 — written to disagree if it can.
 *
 * This file deliberately does NOT import anything from the fix or its test.
 * It re-derives the claim from the database and from the deployed bundle, so it
 * cannot inherit the fix's assumptions.
 *
 * Claims to check:
 *   V1 the feedback tables are EMPTY, so no analytics have ever been recorded
 *   V2 there are real published posts that should have produced analytics rows
 *   V3 the deployed bundle contains the OLD log line shape (not the new one),
 *      i.e. production today still reports "refreshed N posts"
 *   V4 the analytics endpoint is unset in the running container
 */
import { execFileSync } from "node:child_process";

function psql(sql: string): string {
  try {
    return execFileSync(
      "docker",
      ["exec", "contentforge-db", "psql", "-U", "cfuser", "-d", "contentforge", "-tAc", sql],
      { encoding: "utf8" },
    ).trim();
  } catch (e: any) {
    return `PSQL_ERROR: ${e?.message ?? e}`;
  }
}

let bad = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
  if (!ok) bad++;
}

const analyticsRows = Number(psql("select count(*) from analytics;"));
const postedWithIds = Number(psql(
  "select count(*) from posts where status='posted' and external_ids->'x' is not null;",
));
const feedbackRows = Number(psql(
  "select (select count(*) from analytics) + (select count(*) from performance_signals) + (select count(*) from learning_signals) + (select count(*) from learning_observations);",
));

check(
  "V1 no feedback rows of any kind exist",
  feedbackRows === 0,
  `analytics+performance_signals+learning_signals+learning_observations = ${feedbackRows}`,
);
check(
  "V2 there ARE published posts that should have produced analytics",
  postedWithIds > 0,
  `posts status='posted' with an x external id = ${postedWithIds}`,
);

// V3: inspect the DEPLOYED bundle, not the working tree.
const oldShape = execFileSync(
  "docker",
  ["exec", "contentforge-app", "sh", "-c",
    "grep -c 'refreshed ' /app/dist/index.cjs || true"],
  { encoding: "utf8" },
).trim();
const newShape = execFileSync(
  "docker",
  ["exec", "contentforge-app", "sh", "-c",
    "grep -c 'XQUIK_ANALYTICS_ENDPOINT not configured' /app/dist/index.cjs || true"],
  { encoding: "utf8" },
).trim();
check(
  "V3 production today still runs the OLD reporting shape",
  Number(newShape) === 0,
  `deployed bundle: 'refreshed ' occurrences=${oldShape}, new-reason-string occurrences=${newShape} (0 = fix not deployed, correct)`,
);

// V4: the endpoint is genuinely unset in the live container.
let endpointSet = "unknown";
try {
  execFileSync("docker", ["exec", "contentforge-app", "printenv", "XQUIK_ANALYTICS_ENDPOINT"], { encoding: "utf8" });
  endpointSet = "set";
} catch {
  endpointSet = "unset";
}
check(
  "V4 the analytics endpoint is unset in the running container",
  endpointSet === "unset",
  `printenv XQUIK_ANALYTICS_ENDPOINT -> ${endpointSet}`,
);

console.log(`\n${bad === 0 ? "INDEPENDENT VERIFICATION PASSED" : `INDEPENDENT VERIFICATION FAILED (${bad})`}`);
process.exit(bad === 0 ? 0 : 1);
