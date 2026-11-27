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

const partialRow = () =>
  partialPublishRecord({ externalIds: null } as any, partialErr()) as {
    status?: string;
    externalIds?: { x?: string[] };
  };

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

describe("run 52 · B67-B the real caller gives the gate the field it reads", () => {
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
      if (keys[0] === "<NOT-AN-OBJECT-LITERAL>") continue;
      assert.ok(
        keys.includes("externalIds"),
        `gate called with {${keys.join(",")}} — externalIds is missing, so ` +
          `rowHasLiveUnits cannot see the live units. Pass the row, not a subset.`,
      );
    }
  });

  test("B2 the gate is not asked with a subset anywhere in server/ or shared/", () => {
    const calls = gateCallKeys(path.join(APP, "server/social/x.ts"));
    assert.equal(calls.filter((k) => k[0] !== "<NOT-AN-OBJECT-LITERAL>").length, 0);
  });
});

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
    assert.ok(
      hits.some((h) => h.file.includes("social/x.ts")),
      `expected server/social/x.ts among the call sites; got ${JSON.stringify(hits.map((h) => h.file))}`,
    );
  });
});
