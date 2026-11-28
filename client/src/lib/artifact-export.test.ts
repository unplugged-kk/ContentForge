import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractThreadUnits,
  buildEditedArtifactPayload,
  formatArtifactPlainText,
  formatArtifactNumberedThread,
  formatArtifactMarkdownExport,
  buildArtifactExportFilename,
  enrichEvidenceWithSources,
} from "./artifact-export";

describe("artifact-export helpers", () => {
  describe("extractThreadUnits", () => {
    it("extracts trimmed non-empty strings from units array and object units", () => {
      assert.deepEqual(
        extractThreadUnits({
          units: [" First post ", { text: "Second post" }, "   ", "Third post"],
        }),
        ["First post", "Second post", "Third post"],
      );
    });

    it("falls back to splitting double-newline text when units is absent", () => {
      assert.deepEqual(
        extractThreadUnits({ text: "Hook tweet\n\nBody tweet\n\nClosing CTA" }),
        ["Hook tweet", "Body tweet", "Closing CTA"],
      );
      assert.deepEqual(extractThreadUnits(null), []);
    });
  });

  describe("buildEditedArtifactPayload", () => {
    it("returns strictly { units } for x_thread without leaking a bogus text field", () => {
      const payload = buildEditedArtifactPayload(
        "x_thread",
        { units: ["Old 1", "Old 2"], text: "stale-corrupted-field" },
        "ignored draft text",
        ["  Updated hook  ", "", "   ", "Updated takeaway"],
      );

      assert.deepEqual(payload, { units: ["Updated hook", "Updated takeaway"] });
      assert.equal("text" in payload, false);
    });

    it("splits draftText into units when draftUnits is omitted for x_thread", () => {
      const payload = buildEditedArtifactPayload(
        "x_thread",
        { units: ["Old"] },
        "Unit one\n\n\nUnit two",
      );
      assert.deepEqual(payload, { units: ["Unit one", "Unit two"] });
    });

    it("updates text cleanly for single-text formats and strips stray units", () => {
      const xPost = buildEditedArtifactPayload(
        "x_post",
        { text: "Old post", units: ["stale"] },
        "  New X post  ",
      );
      assert.deepEqual(xPost, { text: "New X post" });
      assert.equal("units" in xPost, false);

      const linkedin = buildEditedArtifactPayload(
        "linkedin_post",
        { text: "Old LinkedIn" },
        "New LinkedIn commentary",
      );
      assert.deepEqual(linkedin, { text: "New LinkedIn commentary" });
    });

    it("preserves caption field for image payloads without inventing text", () => {
      const image = buildEditedArtifactPayload(
        "image",
        { visualAssetId: 7, caption: "Old caption" },
        "Updated caption",
      );
      assert.deepEqual(image, { visualAssetId: 7, caption: "Updated caption" });
    });
  });

  describe("formatArtifactPlainText", () => {
    it("joins x_thread units with blank lines", () => {
      const out = formatArtifactPlainText({
        format: "x_thread",
        channel: "x",
        payload: { units: ["First point", "Second point", "Third point"] },
      });
      assert.equal(out, "First point\n\nSecond point\n\nThird point");
    });

    it("returns trimmed body text for single-text posts", () => {
      const out = formatArtifactPlainText({
        format: "linkedin_post",
        channel: "linkedin",
        payload: { text: "  Deep dive on connection pooling.  " },
      });
      assert.equal(out, "Deep dive on connection pooling.");
    });
  });

  describe("formatArtifactNumberedThread", () => {
    it("numbers unnumbered x_thread units as 1/N", () => {
      const out = formatArtifactNumberedThread({
        format: "x_thread",
        channel: "x",
        payload: { units: ["Hook", "Evidence", "Takeaway"] },
      });
      assert.equal(out, "1/3 Hook\n\n2/3 Evidence\n\n3/3 Takeaway");
    });

    it("preserves existing k/N numbering without double-prefixing", () => {
      const out = formatArtifactNumberedThread({
        format: "x_thread",
        channel: "x",
        payload: { units: ["1/2 Already numbered", "Needs number"] },
      });
      assert.equal(out, "1/2 Already numbered\n\n2/2 Needs number");
    });
  });

  describe("formatArtifactMarkdownExport", () => {
    it("includes title, metadata, formatted content, and Sources & Citations", () => {
      const md = formatArtifactMarkdownExport(
        {
          id: 501,
          format: "x_thread",
          channel: "x",
          readiness: "draft",
          payload: { units: ["Hook claim", "Supporting detail"] },
        },
        {
          version: 2,
          storyTitle: "Postgres Connection Pooling",
          opportunityConcept: "Scaling Postgres under load",
          evidence: [
            {
              id: 201,
              title: "CNCF Cloud Native Report",
              text: "78% of teams standardized on developer portals",
              canonicalUrl: "https://cncf.io/reports/2026",
            },
          ],
        },
      );

      assert.match(md, /^# Postgres Connection Pooling/m);
      assert.match(md, /- \*\*Channel:\*\* x/);
      assert.match(md, /- \*\*Format:\*\* x_thread/);
      assert.match(md, /- \*\*Revision:\*\* v2/);
      assert.match(md, /- \*\*Status:\*\* draft/);
      assert.match(md, /1\/2 Hook claim\n\n2\/2 Supporting detail/);
      assert.match(md, /## Sources & Citations/);
      assert.match(
        md,
        /78% of teams standardized on developer portals — \[CNCF Cloud Native Report\]\(https:\/\/cncf\.io\/reports\/2026\)/,
      );
    });

    it("handles missing evidence honestly in Sources & Citations", () => {
      const md = formatArtifactMarkdownExport({
        id: 12,
        format: "x_post",
        channel: "x",
        readiness: "approved",
        payload: { text: "Single post copy" },
      });

      assert.match(md, /## Content\n\nSingle post copy/);
      assert.match(md, /## Sources & Citations\n- No cited sources attached\./);
    });
  });

  describe("buildArtifactExportFilename", () => {
    it("produces clean slugged markdown filenames", () => {
      const name = buildArtifactExportFilename(
        { format: "x_thread", channel: "x", payload: { units: ["a"] } },
        { storyTitle: "Scaling Postgres: 100k QPS!", version: 3 },
      );
      assert.equal(name, "scaling-postgres-100k-qps-x-thread-v3.md");
    });
  });

  describe("enrichEvidenceWithSources", () => {
    it("joins sourceId metadata so Markdown exports emit real clickable URLs and titles", () => {
      const enriched = enrichEvidenceWithSources(
        [
          { id: 1, sourceId: 90, excerpt: "Latency dropped 45% under connection pooling." },
          { id: 2, sourceId: null, excerpt: "Author observation without external URL." },
        ],
        [
          { id: 90, title: "Postgres Pooler Benchmark", canonicalUrl: "https://example.com/pg-bench" },
        ],
      );

      const md = formatArtifactMarkdownExport(
        { id: 7, format: "x_post", channel: "x", readiness: "approved", payload: { text: "Summary" } },
        { evidence: enriched },
      );

      assert.match(
        md,
        /Latency dropped 45% under connection pooling\. — \[Postgres Pooler Benchmark\]\(https:\/\/example\.com\/pg-bench\)/,
      );
      assert.match(md, /Author observation without external URL\./);
    });
  });
});
