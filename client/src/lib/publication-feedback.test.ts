import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { getPublicationFeedback, type PublicationTargetOutcome } from "./publication-feedback";

async function feedbackFromHttp207(outcomes: PublicationTargetOutcome[]) {
  const server = createServer((_req, res) => {
    res.statusCode = 207;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ outcomes }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/publications`, { method: "POST" });
    assert.equal(response.status, 207);
    return getPublicationFeedback(await response.json() as { outcomes: PublicationTargetOutcome[] }, "x");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("getPublicationFeedback", () => {
  it("reports a confirmed published target as success", () => {
    const feedback = getPublicationFeedback(
      { outcomes: [{ status: "published", channel: "x" }] },
      "x",
    );

    assert.equal(feedback.title, "Published successfully");
    assert.equal(feedback.variant, undefined);
  });

  it("reports failed as a destructive result, not success", () => {
    const feedback = getPublicationFeedback(
      { outcomes: [{ status: "failed", channel: "x", error: "credentials missing" }] },
      "x",
    );

    assert.equal(feedback.title, "Publication failed");
    assert.equal(feedback.variant, "destructive");
    assert.match(feedback.description, /credentials missing/);
  });

  it("reports unknown as needing verification, not success", () => {
    const feedback = getPublicationFeedback(
      { outcomes: [{ status: "unknown", channel: "x" }] },
      "x",
    );

    assert.equal(feedback.title, "Publication needs verification");
    assert.equal(feedback.variant, undefined);
  });

  it("reports a mixed multi-target result honestly", () => {
    const feedback = getPublicationFeedback(
      { outcomes: [
        { status: "published", channel: "x" },
        { status: "failed", channel: "linkedin", error: "rejected" },
      ] },
      "x",
    );

    assert.equal(feedback.title, "Publication results are mixed");
    assert.match(feedback.description, /published, failed/);
  });

  it("does not claim success when the 207 envelope has no outcomes", () => {
    const feedback = getPublicationFeedback({ outcomes: [] }, "x");

    assert.equal(feedback.title, "Publication result unavailable");
    assert.equal(feedback.variant, "destructive");
  });

  it("maps real HTTP 207 envelopes without claiming unconfirmed delivery", async () => {
    const cases: Array<{ outcomes: PublicationTargetOutcome[]; title: string }> = [
      { outcomes: [{ status: "published", channel: "x" }], title: "Published successfully" },
      { outcomes: [{ status: "failed", channel: "x", error: "rejected" }], title: "Publication failed" },
      { outcomes: [{ status: "unknown", channel: "x" }], title: "Publication needs verification" },
      {
        outcomes: [
          { status: "published", channel: "x" },
          { status: "failed", channel: "linkedin", error: "rejected" },
        ],
        title: "Publication results are mixed",
      },
      { outcomes: [], title: "Publication result unavailable" },
    ];

    for (const testCase of cases) {
      const feedback = await feedbackFromHttp207(testCase.outcomes);
      assert.equal(feedback.title, testCase.title);
    }
  });

  it("does not claim publication success for an accepted schedule", () => {
    const feedback = getPublicationFeedback(
      { outcomes: [{ status: "created", channel: "x" }] },
      "x",
    );

    assert.equal(feedback.title, "Publication scheduled");
    assert.equal(feedback.variant, undefined);
  });
});
