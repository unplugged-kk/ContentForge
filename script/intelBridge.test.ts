/**
 * Tests for the intel→ideas bridge (run 56).
 *
 * The point of these is discrimination, not coverage. The defect they guard is
 * that the old bridge's provenance assertion required `lspace.beehiiv.com`,
 * which is true of one brief and false of the next. So D1 replays the OLD rule
 * against the NEW brief and asserts it THROWS — if the old rule ever stops
 * failing here, this fixture has gone stale and the test says so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseIntelBrief,
  assertTraceableBrief,
  batchIdFor,
} from "./intelBridge";

/** A brief shaped like the laptop's real output, but NOT from lspace. */
const NEW_BRIEF = `## 2026-11-23T18:32:08Z — intel run

### Anthropic Engineering blog
- route: \`blog\` · ok: **True**
- source: https://www.anthropic.com/engineering

# Item 1 — *Controlling Biology* — Fabian Theis

## 1. A virtual cell is a world model — [24:11]
${"the body of section one is long enough to clear the minimum, and it says ".repeat(6)}
end of section one.

## 2. The bitter lesson — [16:04]
${"the body of section two is also long enough to clear the minimum body size ".repeat(6)}
end of section two.

# Item 2 — *What Frontier Labs Buy*
- source: https://api.substack.com/feed/podcast/1084089.rss

## 3. The market number — [2:41:18]
${"the body of section three is long enough as well, and it belongs to item two ".repeat(6)}
end of section three.
`;

/** Short section: below the body minimum, must be skipped. */
const WITH_STUB = `${NEW_BRIEF}
## 4. Nav only
too short.
`;

function oldProvenanceRule(text: string): string[] {
  // Verbatim from the pre-fix script: the guard being replaced.
  return [...text.matchAll(/https:\/\/lspace\.beehiiv\.com\/[^\s`)]+/g)].map((m) => m[0]);
}

test("D1 the OLD rule cannot pass the NEW brief — this is the defect", () => {
  assert.equal(
    oldProvenanceRule(NEW_BRIEF).length,
    0,
    "fixture went stale: the old lspace-only rule now finds urls here, so it " +
      "would no longer reproduce the failure being fixed",
  );
});

test("D2 the new rule passes the same brief", () => {
  const brief = parseIntelBrief(NEW_BRIEF);
  assert.doesNotThrow(() => assertTraceableBrief(brief, "new-brief.md"));
  assert.equal(brief.sources.length, 2);
});

test("D3 seeds are attributed to the source of the item they sit in", () => {
  const brief = parseIntelBrief(NEW_BRIEF);
  const s1 = brief.seeds.find((s) => s.heading.startsWith("1."));
  const s3 = brief.seeds.find((s) => s.heading.startsWith("3."));
  assert.ok(s1 && s3, "expected sections 1 and 3 to parse");
  assert.equal(s1!.sourceUrl, "https://www.anthropic.com/engineering");
  assert.equal(s3!.sourceUrl, "https://api.substack.com/feed/podcast/1084089.rss");
  assert.equal(s1!.itemTitle, "*Controlling Biology* — Fabian Theis");
});

test("D4 a section below the body minimum is skipped, not seeded", () => {
  const brief = parseIntelBrief(WITH_STUB);
  assert.equal(brief.seeds.filter((s) => s.heading.startsWith("4.")).length, 0);
});

test("D5 a brief with no source line is refused, not silently accepted", () => {
  const noSource = NEW_BRIEF.replace(/^- source: .*$/gm, "");
  const brief = parseIntelBrief(noSource);
  assert.ok(brief.seeds.length > 0, "seeds still parse — the refusal is about provenance");
  assert.throws(
    () => assertTraceableBrief(brief, "naked.md"),
    /no "- source:" line/,
  );
});

test("D6 a brief whose seeds all precede its only source is refused", () => {
  const shifted = `## 1. Early section
${"x".repeat(250)}
- source: https://example.com/only
`;
  const brief = parseIntelBrief(shifted);
  assert.equal(brief.seeds.length, 1);
  assert.equal(brief.seeds[0].sourceUrl, null);
  assert.throws(
    () => assertTraceableBrief(brief, "shifted.md"),
    /source attribution would be fabricated/,
  );
});

test("D7 an empty brief is refused", () => {
  assert.throws(() => assertTraceableBrief(parseIntelBrief(""), "empty.md"), /no usable intel sections/);
});

test("D8 batch id is per-day and stable", () => {
  assert.equal(batchIdFor("2026-11-24"), "intel_2026-11-24");
  assert.equal(batchIdFor("2026-11-24"), batchIdFor("2026-11-24"));
  assert.notEqual(batchIdFor("2026-11-24"), batchIdFor("2026-11-23"));
});
