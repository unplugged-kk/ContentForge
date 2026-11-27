import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { fitUnitToBudget, fitUnitsForThread, FIT_ELLIPSIS } from "./unitFit";
import { addThreadNumbering } from "../utils/threadUtils";
import { xUnitBudgetAt, validateXText, X_MAX_UNIT_CHARS } from "../social/xTextLimits";

const R = (n: number) => "x".repeat(n);

describe("fitUnitToBudget — A. the value contract", () => {
  test("A1 a unit that already fits is returned untouched, and says so", () => {
    const r = fitUnitToBudget("Short and complete.", 280);
    assert.equal(r.text, "Short and complete.");
    assert.equal(r.strategy, "unchanged");
    assert.equal(r.fitted, false);
    assert.equal(r.removed, 0);
  });

  test("A2 a unit exactly at the budget is NOT touched (no needless ellipsis)", () => {
    const exact = R(280);
    const r = fitUnitToBudget(exact, 280);
    assert.equal(r.text.length, 280);
    assert.equal(r.fitted, false);
    assert.equal(r.strategy, "unchanged");
  });

  test("A3 a long unit is cut at a SENTENCE boundary and keeps its full stop", () => {
    const body =
      "Kubernetes quotas are the cheapest guardrail you have. " +
      "They cap a runaway agent before it can spend a month of your budget in an afternoon. " +
      "Then you measure what the agent actually read before the bill arrived, which is the part nobody does and everybody needs to do honestly.";
    const r = fitUnitToBudget(body, 180);
    assert.ok(r.text.length <= 180, `got ${r.text.length}`);
    assert.equal(r.strategy, "sentence");
    assert.match(r.text, /\.$/);
    assert.ok(body.startsWith(r.text), "a fitted unit must be a prefix of the input");
  });

  test("A4 a word cut is MARKED with an ellipsis, because the reader must be told", () => {
    const body = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const r = fitUnitToBudget(body, 100);
    assert.equal(r.strategy, "word");
    assert.ok(r.text.endsWith(FIT_ELLIPSIS), `must end with the marker, got ${JSON.stringify(r.text.slice(-6))}`);
    assert.ok(r.text.length <= 100, `got ${r.text.length}`);
    const head = r.text.slice(0, -FIT_ELLIPSIS.length);
    assert.ok(!/\s$/.test(head), "no dangling space before the marker");
    assert.match(head, /word\d+$/, "must end on a complete token");
  });

  test("A5 the impersonated defect: a bare slice would leave a half word", () => {
    const body =
      "AI coding agents are easy to demo. Operating them across 200 engineers is a platform problem. " +
      "I'd version each skill, scope its permissions, run evals before rollout, and track traces with a rollback path. " +
      "Otherwise, that 'helpful prompt' is unowned production debt. What's your gate?";
    const bare = body.slice(0, 280);
    const fitted = fitUnitToBudget(body, 280);

    assert.equal(bare.length, 280);
    assert.match(bare, /[a-z]$/i, "the bare slice stops mid-word");

    assert.ok(fitted.text.length <= 280);
    const endedCleanly = /[.!?…]$|[…]$/.test(fitted.text);
    assert.ok(endedCleanly, `fitted text must end on a boundary or a marker, got ${JSON.stringify(fitted.text.slice(-20))}`);
  });

  test("A6 a single enormous token degrades to a marked hard cut, not a throw", () => {
    const r = fitUnitToBudget(R(900), 280);
    assert.equal(r.strategy, "hard");
    assert.equal(r.text.length, 280);
    assert.ok(r.text.endsWith(FIT_ELLIPSIS));
  });

  test("A7 a clause break past the share wins over a word cut", () => {
    const body = "we shipped a pipeline first and then a platform, nobody asked why the boxes grew";
    const budget = 60;
    const commaAt = body.indexOf(", ") + 2;
    assert.ok(commaAt >= budget * 0.6, `fixture comma at ${commaAt} is not past the share of ${budget}`);

    const r = fitUnitToBudget(body, budget);
    assert.equal(r.strategy, "clause", `expected clause, got ${r.strategy} (${JSON.stringify(r.text.slice(-12))})`);
    assert.ok(r.text.endsWith(","), "a clause fit keeps its punctuation");
    assert.ok(body.startsWith(r.text), "must be a prefix of the author's text");
  });

  test("A7b a clause break too early in the window is NOT used — a marked word cut is better", () => {
    const body2 = "yes, but the real answer needs the rest of this sentence said properly without cutting";
    const r = fitUnitToBudget(body2, 80);
    assert.notEqual(r.strategy, "clause", "an early clause break wastes the budget");
    assert.equal(r.strategy, "word");
    assert.ok(r.text.endsWith(FIT_ELLIPSIS), "a word cut must be marked");
    assert.ok(r.text.length >= 80 * 0.6, `wasted the window: ${r.text.length} chars`);
  });

  test("A8 empty and whitespace-only inputs are safe", () => {
    for (const input of ["", "   ", "\n\n"]) {
      const r = fitUnitToBudget(input, 280);
      assert.equal(r.fitted, false);
      assert.equal(r.text, "");
    }
  });

  test("A9 a zero or negative budget yields empty text, never a longer string", () => {
    for (const budget of [0, -1, -280]) {
      const r = fitUnitToBudget("some text that will not fit", budget);
      assert.equal(r.text, "", `budget ${budget} must yield empty text`);
      assert.ok(r.text.length <= Math.max(budget, 0));
      assert.equal(r.fitted, true);
    }
  });
});

describe("fitUnitToBudget — B. the safety property", () => {
  test("B1 output is NEVER longer than the budget, for any input length", () => {
    const bodies = [
      "short",
      "ends with a full stop right at the edge of things. And then more text follows here to push it over.",
      R(30),
      R(500),
      Array.from({ length: 200 }, (_, i) => `tok${i}`).join(" "),
      "semi; colon: dash — comma, and a lot of trailing words that will certainly exceed a small budget window",
      "emoji 🚀 and unicode — punctuation ’quotes’ that used to break naive index math. " + R(400),
    ];
    for (const body of bodies) {
      for (const budget of [1, 2, 5, 40, 100, 279, 280]) {
        const r = fitUnitToBudget(body, budget);
        assert.ok(
          r.text.length <= Math.max(budget, 0),
          `budget ${budget} exceeded with ${r.text.length} chars for ${JSON.stringify(body.slice(0, 20))}`,
        );
      }
    }
  });

  test("B2 fitting is idempotent — fitting twice changes nothing", () => {
    const body = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const once = fitUnitToBudget(body, 200);
    const twice = fitUnitToBudget(once.text, 200);
    assert.equal(twice.text, once.text);
    assert.equal(twice.fitted, false);
  });

  test("B3 a fitted unit is always a prefix of the input, modulo the marker", () => {
    const body =
      "First we shipped a pipeline. Then we shipped a platform. Then we admitted the platform was the pipeline with more YAML, and nobody wanted to hear it at the time but here we are three years later with a diagram that has forty-two boxes in it.";
    const r = fitUnitToBudget(body, 140);
    const stem = r.text.endsWith(FIT_ELLIPSIS) ? r.text.slice(0, -FIT_ELLIPSIS.length) : r.text;
    assert.ok(body.startsWith(stem), "the fitted text must not rewrite the author's words");
  });

  test("B4 no trailing whitespace is left before a marker, or at all", () => {
    const body = Array.from({ length: 60 }, () => "alpha").join(" ");
    for (const budget of [50, 111, 200]) {
      const r = fitUnitToBudget(body, budget);
      assert.equal(r.text, r.text.trimEnd(), `trailing space at budget ${budget}`);
      assert.ok(!r.text.includes(` ${FIT_ELLIPSIS}`), "space immediately before the marker");
    }
  });
});

describe("fitUnitToBudget — C. the REAL transport, not a model of it", () => {
  test("C1 a single fitted unit survives validateXText", () => {
    const body = Array.from({ length: 90 }, () => "platform").join(" ") + ".";
    const r = fitUnitToBudget(body, X_MAX_UNIT_CHARS);
    const v = validateXText([r.text]);
    assert.equal(v.ok, true, `validator rejected a fitted unit: ${v.error}`);
  });

  test("C2 a fitted THREAD survives numbering without losing a character", () => {
    const bodies = [
      Array.from({ length: 70 }, () => "hook").join(" ") + ".",
      Array.from({ length: 70 }, () => "insight").join(" ") + ".",
      Array.from({ length: 70 }, () => "closing").join(" ") + "?",
    ];
    const total = bodies.length;
    const budgets = bodies.map((_, i) => xUnitBudgetAt(i, total));
    const fitted = fitUnitsForThread(bodies, budgets).map((f) => f.text);
    const numbered = addThreadNumbering(fitted);

    assert.equal(numbered.length, total);
    for (const [i, unit] of numbered.entries()) {
      assert.ok(unit.length <= X_MAX_UNIT_CHARS, `unit ${i + 1} is ${unit.length} chars after numbering`);
    }
    const v = validateXText(numbered);
    assert.equal(v.ok, true, `validator rejected the numbered thread: ${v.error}`);
  });

  test("C3 the numbering does NOT trim a fitted unit — the budget was reserved correctly", () => {
    const bodies = [Array.from({ length: 80 }, () => "word").join(" ")];
    const budget = xUnitBudgetAt(0, 3);
    const fitted = fitUnitToBudget(bodies[0], budget);
    const numbered = addThreadNumbering([fitted.text]);
    const withSuffix = `${fitted.text}\n\n1/3`;
    assert.ok(withSuffix.length <= X_MAX_UNIT_CHARS, `${withSuffix.length} chars would be trimmed`);
    assert.ok(fitted.text.length <= budget);
    assert.ok(numbered.length === 1);
  });
});

describe("fitUnitToBudget — D. the census", () => {
  const ROOT = join(process.cwd(), "server");

  const ALLOWED: { file: string; line: number; why: string }[] = [
    {
      file: "server/decision/legacy.ts",
      line: 71,
      why: "cuts a 200-char TOPIC TITLE for the decision router; not a published unit",
    },
    {
      file: "server/routes.ts",
      line: 426,
      why: "display preview of an ALREADY-STORED tweet in a list response; never persisted or published",
    },
    {
      file: "server/routes.ts",
      line: 942,
      why: "article TITLE derived from stored tweet content; a title, not a published unit",
    },
  ];

  function stripComments(src: string): string[] {
    let inBlock = false;
    return src.split("\n").map((line) => {
      const trimmed = line.trim();
      if (inBlock) {
        if (trimmed.includes("*/")) inBlock = false;
        return "";
      }
      if (trimmed.startsWith("/*")) {
        if (!trimmed.includes("*/")) inBlock = true;
        return "";
      }
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return "";
      const inline = line.indexOf("//");
      return inline >= 0 ? line.slice(0, inline) : line;
    });
  }

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === "node_modules") continue;
        walk(full, out);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
        out.push(full);
      }
    }
    return out;
  }

  const rel = (p: string) => p.replace(process.cwd() + "/", "");

  test("D0 the scan found source files (cannot pass vacuously)", () => {
    const files = walk(ROOT);
    assert.ok(files.length > 50, `scan found only ${files.length} files — the walk is broken`);
  });

  test("D1 the scan can SEE the defect it names — a replay of the old line fails", () => {
    const oldLine = `const rawContents = parsed.tweets.map((t: any) => String(t.content || "").slice(0, 280));`;
    const detected = /\.(?:content)\b[\s\S]*?\.\s*(?:slice|substring)\s*\(/.test(oldLine);
    assert.equal(detected, true, "the detector does not recognise the defect it exists to find");
  });

  test("D2 no source file cuts .content with a bare offset slice, outside a documented exception", () => {
    const offending: string[] = [];
    for (const file of walk(ROOT)) {
      const relPath = rel(file);
      const allowedLines = ALLOWED.filter((a) => a.file === relPath).map((a) => a.line);
      stripComments(readFileSync(file, "utf8")).forEach((line, i) => {
        if (!line.trim()) return;
        if (allowedLines.includes(i + 1)) return;
        if (/\.content\b[\s\S]*?\.\s*(?:slice|substring)\s*\(/.test(line)) {
          offending.push(`${relPath}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(
      offending,
      [],
      `bare offset cut on .content — use fitUnitToBudget, or add a documented ALLOWED entry:\n${offending.join("\n")}`,
    );
  });

  test("D3 the two generation sites import the fitter, not a literal", () => {
    const autopilot = readFileSync(join(ROOT, "autopilot.ts"), "utf8");
    const routes = readFileSync(join(ROOT, "routes.ts"), "utf8");
    assert.match(autopilot, /from "\.\/content\/unitFit"/, "autopilot.ts must import unitFit");
    assert.match(routes, /from "\.\/content\/unitFit"/, "routes.ts must import unitFit");
  });

  test("D4 threadUtils routes the suffix budget through the fitter, not a raw slice", () => {
    const src = stripComments(readFileSync(join(ROOT, "utils", "threadUtils.ts"), "utf8")).join("\n");
    assert.ok(!/\.slice\s*\(\s*0\s*,\s*maxBody\s*\)/.test(src), "threadUtils still hard-cuts the body");
    assert.match(src, /fitUnitToBudget/, "threadUtils must route through the fitter");
  });

  test("D5 every ALLOWED entry still points at a real line of a real file (no stale exceptions)", () => {
    for (const a of ALLOWED) {
      const abs = join(process.cwd(), a.file);
      assert.doesNotThrow(() => statSync(abs), `stale ALLOWED entry: ${a.file}`);
      const lines = readFileSync(abs, "utf8").split("\n");
      assert.ok(a.line <= lines.length, `stale ALLOWED line ${a.file}:${a.line} — file is ${lines.length} lines`);
      assert.match(lines[a.line - 1] ?? "", /\.content\b/, `ALLOWED line ${a.file}:${a.line} no longer cuts .content`);
    }
  });
});
