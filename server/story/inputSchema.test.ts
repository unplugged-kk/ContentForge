import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CREATOR_NOTES_HEADER,
  RESEARCH_THESIS_HEADER,
  extractCreatorNotesFromStory,
  storyInputSchema,
  toStorySynthesis,
} from "./inputSchema";

describe("co-primary StoryInput schema (INC-06)", () => {
  it("converts first_hand input to human-provenance StorySynthesis with proof points", () => {
    const parsed = storyInputSchema.parse({
      mode: "first_hand",
      title: "Cutting P99 query latency by tuning PgBouncer",
      observation: "Transaction pooling eliminated idle backend memory thrash during peak traffic.",
      proofPoints: [
        "Measured P99 drop from 420ms to 85ms on our 16-core primary",
        "Reduced idle Postgres connections from 1,800 to 120",
      ],
      angles: ["Why session pooling hides connection storms"],
    });

    const synthesis = toStorySynthesis(parsed);
    assert.equal(synthesis.provenance, "human");
    assert.equal(synthesis.evidenceRefs, undefined);
    assert.ok(synthesis.insightBody.includes(CREATOR_NOTES_HEADER));
    assert.match(synthesis.insightBody, /420ms to 85ms/);
    assert.deepEqual(synthesis.angles, ["Why session pooling hides connection storms"]);

    const extracted = extractCreatorNotesFromStory({
      provenance: synthesis.provenance,
      insightBody: synthesis.insightBody,
    });
    assert.ok(extracted);
    assert.match(extracted!, /1,800 to 120/);
  });

  it("converts researched input to researched-provenance StorySynthesis preserving evidenceRefs", () => {
    const synthesis = toStorySynthesis({
      mode: "researched",
      researchJobId: 42,
      evidenceRefs: [10, 11, 10],
      title: "Apache Iceberg v3 deletion vectors",
      thesis: "Deletion vectors remove the read-amplification tax of positional delete files.",
      angles: ["What changes for streaming CDC writers"],
    });

    assert.equal(synthesis.provenance, "researched");
    assert.deepEqual(synthesis.evidenceRefs, [10, 11]);
    assert.ok(synthesis.insightBody.includes(RESEARCH_THESIS_HEADER));
    assert.equal(
      extractCreatorNotesFromStory({
        provenance: synthesis.provenance,
        insightBody: synthesis.insightBody,
      }),
      null,
      "pure researched story has no creator notes",
    );
  });

  it("converts hybrid input separating research thesis from first-hand notes while keeping researched provenance", () => {
    const synthesis = toStorySynthesis({
      mode: "hybrid",
      researchJobId: 42,
      evidenceRefs: [10, 12],
      title: "Iceberg compaction in production",
      thesis: "Iceberg v3 benchmarks report 3x faster reads with deletion vectors.",
      observation: "We still hit compaction tail latency when small files spiked.",
      proofPoints: ["Hourly rewrite jobs cut file count by 72% in our warehouse"],
      angles: ["Benchmarks vs real compaction ops"],
    });

    assert.equal(synthesis.provenance, "researched");
    assert.deepEqual(synthesis.evidenceRefs, [10, 12]);
    assert.ok(synthesis.insightBody.includes(RESEARCH_THESIS_HEADER));
    assert.ok(synthesis.insightBody.includes(CREATOR_NOTES_HEADER));
    const notes = extractCreatorNotesFromStory({
      provenance: synthesis.provenance,
      insightBody: synthesis.insightBody,
    });
    assert.ok(notes);
    assert.match(notes!, /72%/);
    assert.doesNotMatch(notes!, /Research thesis:/);
  });

  it("rejects invalid mode payloads at the boundary", () => {
    assert.equal(
      storyInputSchema.safeParse({
        mode: "researched",
        researchJobId: 42,
        evidenceRefs: [],
        title: "Missing refs",
        thesis: "Must have at least one evidence ref",
      }).success,
      false,
    );

    assert.equal(
      storyInputSchema.safeParse({
        mode: "first_hand",
        title: "Empty observation",
        observation: "   ",
        proofPoints: [],
      }).success,
      false,
    );
  });
});
