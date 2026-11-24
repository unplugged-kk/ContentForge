/**
 * run 52 / B67 — a guard is only as wide as the object the caller gives it.
 *
 * Run 51 made `assertEligibleForXPublish` refuse a row carrying live X units, and
 * proved it with 16 tests that construct the row correctly. Production called it
 * with `{ status, scheduledAt }` — a literal that omits `externalIds`, the exact
 * field the guard reads. So `rowHasLiveUnits` saw `undefined` on every real row and
 * returned false, and the 409 never fired for anything.
 *
 * The defect class is precise: **a test that passes the shape the test author chose
 * proves the predicate, not the call path.** These tests therefore assert on the
 * call path — parsed out of the real source — and fail if a future caller narrows
 * the object again.
 *
 * C-tests are a census: they read `server/` and `shared/` and fail if any
 * non-test call site of the gate omits a field the gate reads. C0 fails if the
 * scan finds nothing, so the census cannot pass vacuously.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { assertEligibleForXPublish } from "@shared/xDeveloperRisk";
import { partialPublishRecord, XPartialPublishError } from "./partialPublish";

const APP = path.resolve(process.cwd());

const partialErr = () =>
  new XPartialPublishError({
    tweetIds: ["1800000000000000001", "1800000000000000002"],
    urls: [
      "https://x.com/i/status/1800000000000000001",
      "https://x.com/i/status/1800000000000000002",
    ],
    failedUnit: 3,
    totalUnits: 4,
    cause: new Error("The operation was aborted due to timeout"),
  });

/** The row run 50's fix writes for a half-published thread. */
const partialRow = () =>
  partialPublishRecord({ externalIds: null } as any, partialErr()) as {
    status?: string;
    externalIds?: { x?: string[] };
  };

// ---------------------------------------------------------------------------
// A — the predicate, asked with the FULL row (run 51's tests; kept, not replaced)
// ---------------------------------------------------------------------------

describe("run 52 · B67-A the predicate still refuses a row with live units", () => {
  test("A1 a partial row is refused for a manual publish", () => {
    assert.throws(
      () => assertEligibleForXPublish(partialRow() as any, { invokedBy: "user" }),
      /ALREADY PARTIALLY PUBLISHED/,
    );
  });

  test("A2 the refusal is a 409 so the error handler echoes it", () => {
    try {
      assertEligibleForXPublish(partialRow() as any, { invokedBy: "user" });
      assert.fail("should have thrown");
    } catch (e: any) {
      assert.equal(e.status, 409);
    }
  });

  test("A3 a clean failure is still retryable (R5/R11 must not regress)", () => {
    assert.doesNotThrow(() =>
      assertEligibleForXPublish(
        { status: "failed", scheduledAt: null, externalIds: null } as any,
        { invokedBy: "user" },
      ),
    );
  });

  test("A4 a posted row is still refused", () => {
    assert.throws(
      () =>
        assertEligibleForXPublish(
          { status: "posted", scheduledAt: null, externalIds: { x: ["1"] } } as any,
          { invokedBy: "user" },
        ),
      /already published/,
    );
  });
});

// ---------------------------------------------------------------------------
// B — the call path: the caller must pass every field the gate reads
// ---------------------------------------------------------------------------

describe("run 52 · B67-B the real caller gives the gate the field it reads", () => {
  /** Extract the gate's first-argument key list from a source file, by AST. */
  function gateCallKeys(file: string): string[][] {
    const src = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const found: string[][] = [];
    const walk = (n: any) => {
      if (ts.isCallExpression(n) && n.expression.getText(sf) === "assertEligibleForXPublish") {
        const arg = n.arguments[0];
        found.push(
          ts.isObjectLiteralExpression(arg)
            ? arg.properties.map((p: any) => p.name?.getText(sf) ?? "?")
            : ["<NOT-AN-OBJECT-LITERAL>"],
        );
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
    return found;
  }

  test("B1 tryPublishPostById does not hand the gate a narrower object", () => {
    const calls = gateCallKeys(path.join(APP, "server/social/x.ts"));
    assert.ok(calls.length > 0, "expected a gate call in server/social/x.ts");
    for (const keys of calls) {
      // A non-literal (the fixed form: the whole row) carries every field by
      // construction. The bug was a hand-narrowed literal.
      if (keys[0] === "<NOT-AN-OBJECT-LITERAL>") continue;
      assert.ok(
        keys.includes("externalIds"),
        `gate called with {${keys.join(",")}} — externalIds is missing, so ` +
          `rowHasLiveUnits cannot see the live units. Pass the row, not a subset.`,
      );
    }
  });

  test("B2 the gate is not asked with a subset anywhere in server/ or shared/", () => {
    // census — see C below for the full scan; this asserts the one file that
    // actually publishes, so a rename of the function still gets caught here.
    const calls = gateCallKeys(path.join(APP, "server/social/x.ts"));
    assert.equal(calls.filter((k) => k[0] !== "<NOT-AN-OBJECT-LITERAL>").length, 0);
  });
});

// ---------------------------------------------------------------------------
// C — census over the whole tree, so a THIRD caller cannot reintroduce this
// ---------------------------------------------------------------------------

describe("run 52 · B67-C census: no call site may narrow the gate's input", () => {
  const FIELDS_THE_GATE_READS = ["status", "scheduledAt", "externalIds"];

  function walkTs(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkTs(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  function scan(): { file: string; keys: string[] }[] {
    const hits: { file: string; keys: string[] }[] = [];
    for (const dir of ["server", "shared"]) {
      const abs = path.join(APP, dir);
      if (!fs.existsSync(abs)) continue;
      for (const file of walkTs(abs)) {
        if (/\.test\.ts$/.test(file)) continue;
        const src = fs.readFileSync(file, "utf8");
        if (!src.includes("assertEligibleForXPublish(")) continue;
        if (!src.includes("export function assertEligibleForXPublish")) {
          const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
          const visit = (n: any) => {
            if (ts.isCallExpression(n) && n.expression.getText(sf) === "assertEligibleForXPublish") {
              const arg = n.arguments[0];
              hits.push({
                file: path.relative(APP, file),
                keys: ts.isObjectLiteralExpression(arg)
                  ? arg.properties.map((p: any) => p.name?.getText(sf) ?? "?")
                  : ["<NOT-AN-OBJECT-LITERAL>"],
              });
            }
            ts.forEachChild(n, visit);
          };
          visit(sf);
        }
      }
    }
    return hits;
  }

  const hits = scan();

  test("C0 the census found at least one call site (cannot pass vacuously)", () => {
    assert.ok(
      hits.length > 0,
      "the scan found no call sites — a census that scans nothing reports success",
    );
  });

  test("C1 every non-literal call site supplies every field the gate reads", () => {
    const offenders = hits
      .filter((h) => h.keys[0] !== "<NOT-AN-OBJECT-LITERAL>")
      .filter((h) => !FIELDS_THE_GATE_READS.every((f) => h.keys.includes(f)));
    assert.deepEqual(
      offenders,
      [],
      `call sites narrowing the gate's input: ${JSON.stringify(offenders)}`,
    );
  });

  test("C2 the publisher is the site this census covers", () => {
    // Guards against the census silently covering the wrong file after a refactor.
    assert.ok(
      hits.some((h) => h.file.includes("social/x.ts")),
      `expected server/social/x.ts among the call sites; got ${JSON.stringify(hits.map((h) => h.file))}`,
    );
  });
});
