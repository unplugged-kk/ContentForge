import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  AVAILABLE_IDEA_STATUSES,
  CONSUMED_IDEA_STATUSES,
  isIdeaAvailable,
  ideaSkipReason,
  ideaQueryLimit,
  partitionByAvailability,
} from "./ideaAvailability";

/**
 * Run 57 — the idea pool the autopilot ranks was not the idea pool.
 *
 * Two defects, measured on the live table:
 *
 * D-A  `storage.getDiscoveredIdeas(userId)` ended `LIMIT 50`, and three drafting
 *      sites use it to build the pool they rank. The status/niche/viral filters
 *      run AFTER the limit, so 50 rows yielded 29 candidates while the table held
 *      329 rankable ones. 272 usable ideas — 74 of them with viral >= 9.0 — were
 *      never seen. Not rejected: invisible.
 *
 * D-B  `rankIdeas()` never filters on status, and the callers' deny-lists
 *      disagreed. `autofillCalendar` and the weekend writer excluded only `"used"`,
 *      while `runDailyAutoPost` and `scheduleManualPost` MARK their idea
 *      `"scheduled"`; `rssAutopost` marks `"auto-drafted"`. One batch site filtered
 *      nothing at all.
 *
 * They compose, and that is the part worth testing: the cap currently keeps every
 * `"scheduled"` row outside the window, so D-B has no reachable instance TODAY.
 * Lifting the cap alone puts an already-drafted idea at the top of the ranking
 * (measured: ids 161 and 381). Each fix is only safe with the other, so the tests
 * below assert both together.
 *
 * A..C  the value contract (which statuses are available, and why)
 * D     query sizing (a fixed cap cannot be correct)
 * E     the CENSUS — no drafting site may build a ranking pool without the filter
 */

const SERVER_ROOT = join(import.meta.dirname, "..");

/** Files that select ideas to draft from. */
const DRAFTING_SITES = ["autopilot.ts"];

function serverFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__pycache__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) serverFiles(p, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".dbtest.ts")) out.push(p);
  }
  return out;
}

// ── A. The available set is an allow-list, not a deny-list ────────────────────

describe("A. availability contract", () => {
  test("A1 a `new` idea is available", () => {
    assert.equal(isIdeaAvailable("new"), true);
  });

  test("A2 every status a writer uses to mark an idea consumed is NOT available", () => {
    // The real writers, read off the source: autopilot -> "used" / "scheduled",
    // rssAutopost -> "auto-drafted", routes (manual save) -> "saved".
    for (const s of ["used", "scheduled", "auto-drafted", "saved"]) {
      assert.equal(isIdeaAvailable(s), false, `status "${s}" must not be draftable`);
    }
  });

  test("A3 the consumed set and the available set do not overlap", () => {
    const overlap = AVAILABLE_IDEA_STATUSES.filter((s) =>
      (CONSUMED_IDEA_STATUSES as readonly string[]).includes(s));
    assert.deepEqual(overlap, [], "a status cannot mean both available and consumed");
  });

  test("A4 a NULL/undefined status is not available — an unknown row is not fresh", () => {
    assert.equal(isIdeaAvailable(null), false);
    assert.equal(isIdeaAvailable(undefined), false);
    assert.equal(isIdeaAvailable(""), false);
  });

  test("A5 an unrecognised status is not available — fail closed", () => {
    assert.equal(isIdeaAvailable("some-future-status"), false);
  });
});

// ── B. The reason is reported, not swallowed ─────────────────────────────────

describe("B. skip reasons", () => {
  test("B1 an available idea has no skip reason", () => {
    assert.equal(ideaSkipReason("new"), null);
  });

  test("B2 a consumed idea names the status that consumed it", () => {
    assert.match(String(ideaSkipReason("scheduled")), /already consumed/);
    assert.match(String(ideaSkipReason("scheduled")), /scheduled/);
  });

  test("B3 an unrecognised status is distinguished from a consumed one", () => {
    const r = String(ideaSkipReason("weird"));
    assert.match(r, /unrecognised/);
    assert.doesNotMatch(r, /already consumed/);
  });

  test("B4 partition reports what it removed and why — the pool cannot silently shrink", () => {
    const rows = [
      { id: 1, status: "new" },
      { id: 2, status: "scheduled" },
      { id: 3, status: "used" },
      { id: 4, status: "auto-drafted" },
      { id: 5, status: null },
    ];
    const { kept, skipped } = partitionByAvailability(rows);
    assert.deepEqual(kept.map((r) => r.id), [1]);
    assert.equal(skipped.length, 4);
    assert.ok(skipped.every((s) => typeof s.reason === "string" && s.reason.length > 0));
  });
});

// ── C. The composition — the defect that makes a naive fix worse ─────────────

describe("C. composition with the query cap", () => {
  test("C1 a naive `status !== 'used'` deny-list admits a `scheduled` idea", () => {
    // This is the OLD rule, replayed, so a regression to it fails loudly rather
    // than reading as a pass.
    const oldRule = (s: string | null) => s !== "used";
    assert.equal(oldRule("scheduled"), true, "the old rule was wrong about `scheduled`");
    assert.equal(isIdeaAvailable("scheduled"), false, "the new rule refuses it");
  });

  test("C2 an empty available pool is distinguishable from a pool the LIMIT emptied", () => {
    // Two different causes, two different reasons. The old code returned an empty
    // array for both, and then silently re-ran discovery.
    const trulyEmpty = partitionByAvailability([] as { status: string }[]);
    const allConsumed = partitionByAvailability([{ status: "used" }, { status: "scheduled" }]);
    assert.equal(trulyEmpty.kept.length, 0);
    assert.equal(trulyEmpty.skipped.length, 0, "nothing to skip: the pool really was empty");
    assert.equal(allConsumed.kept.length, 0);
    assert.equal(allConsumed.skipped.length, 2, "the pool was not empty; it was consumed");
  });
});

// ── D. Query sizing — a fixed cap cannot be correct ─────────────────────────

describe("D. query limit", () => {
  test("D1 a 50-row cap cannot cover a 329-row eligible set", () => {
    const limit = ideaQueryLimit(329);
    assert.ok(limit >= 329, `limit ${limit} must cover the 329 eligible rows it feeds a ranker`);
    assert.ok(limit > 50, "the old fixed 50 is the defect");
  });

  test("D2 the limit grows with the pool instead of truncating at a constant", () => {
    const small = ideaQueryLimit(100);
    const large = ideaQueryLimit(1000);
    assert.ok(large > small, "a bigger pool must get a bigger window");
  });

  test("D3 it stays bounded — an unbounded array is its own failure", () => {
    assert.ok(ideaQueryLimit(10_000_000) <= 2000, "hard cap must hold");
  });

  test("D4 a degenerate input still yields a usable positive limit", () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      const l = ideaQueryLimit(bad as number);
      assert.ok(Number.isFinite(l) && l > 0, `ideaQueryLimit(${bad}) -> ${l}`);
    }
  });
});

// ── E. The census — a future site that forgets is a test failure ────────────

describe("E. drafting-site census", () => {
  test("E1 the scan finds the drafting sites (cannot pass vacuously)", () => {
    const found: string[] = [];
    for (const site of DRAFTING_SITES) {
      const p = join(SERVER_ROOT, site);
      assert.ok(readFileSync(p, "utf8").length > 0, `${site} not found`);
      found.push(site);
    }
    assert.ok(found.length > 0);
  });

  test("E2 no drafting site builds a ranking pool without the availability filter", () => {
    // The defect was never in the predicate; it was in a CALL SITE that skipped it.
    // So the assertion is on the call sites, not on `rankIdeas` in isolation.
    const violations: string[] = [];

    for (const p of serverFiles(SERVER_ROOT)) {
      const src = readFileSync(p, "utf8");
      if (!src.includes("rankIdeas(")) continue;

      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (!/rankIdeas\(/.test(line)) return;
        if (/^\s*(export\s+)?function\s+rankIdeas/.test(line)) return; // the definition
        if (/^\s*(const|let|export)\s+rankIdeas\s*=/.test(line)) return;
        if (/\*\s|^\s*\/\//.test(line)) return; // comments

        // Every call must route its rows through isIdeaAvailable().
        const args = line.slice(line.indexOf("rankIdeas(") + "rankIdeas(".length);
        const firstArg = args.split(",")[0] ?? "";
        if (!/isIdeaAvailable|partitionByAvailability/.test(firstArg)) {
          violations.push(`${p.split("/server/")[1]}:${i + 1}  ${line.trim()}`);
        }
      });
    }

    assert.deepEqual(
      violations,
      [],
      `rankIdeas() called on an unfiltered pool — a consumed idea can be drafted twice:\n${violations.join("\n")}`,
    );
  });

  test("E3 getDiscoveredIdeas is not called with a hardcoded small limit", () => {
    // The cap lived in the query, so guard the query: a caller may pass a limit,
    // but no call may reintroduce a constant that truncates the ranker's input.
    const violations: string[] = [];
    for (const p of serverFiles(SERVER_ROOT)) {
      const src = readFileSync(p, "utf8");
      const lines = src.split("\n");
      lines.forEach((line: string, i: number) => {
        const m = line.match(/getDiscoveredIdeas\([^)]*\)/);
        if (!m) return;
        const call = m[0];
        // `, 50)` or `, 20)` etc. — a small literal as the LIMIT argument.
        const lit = call.match(/,\s*(\d+)\s*\)/);
        if (lit && Number(lit[1]) < 200) {
          violations.push(`${p.split("/server/")[1]}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(violations, [], `a small hardcoded idea-query limit truncates the ranking pool:\n${violations.join("\n")}`);
  });

  test("E4 the pool limit is DERIVED, not a literal — a constant is a date", () => {
    // D1..D4 prove `ideaQueryLimit()` behaves, but the original defect was a bare
    // `50` sitting in the query. A behavioural control (run 57) showed the suite
    // stayed GREEN when the exported constant was mutated back to `= 50`, so this
    // asserts on the definition itself: it must be computed from the pool size.
    // A number typed once is a number chosen for the pool as it was that day.
    const src = readFileSync(join(SERVER_ROOT, "storage.ts"), "utf8");
    const m = src.match(/IDEA_POOL_QUERY_LIMIT\s*=\s*([^;]+);/);
    assert.ok(m, "IDEA_POOL_QUERY_LIMIT must be defined in storage.ts");

    const expr = m![1].trim();
    assert.match(
      expr,
      /ideaQueryLimit\(/,
      `the pool limit must be derived from ideaQueryLimit(), not literalled — found: ${expr}`,
    );

    // And the derived value must actually be big enough for the live eligible set.
    const evaluated = ideaQueryLimit(329);
    assert.ok(evaluated >= 329, `derived limit ${evaluated} must cover 329 eligible rows`);
  });
});
