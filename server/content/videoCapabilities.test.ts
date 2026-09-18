import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reportVideoCapabilities } from "./videoCapabilities";
import { resetVisualProviders } from "./visual";
import { resetVideoRepurposingProviders } from "./videoRepurpose";

describe("video capability report", () => {
  it("does not claim production engines processing_ready when they are unconfigured", async () => {
    resetVisualProviders();
    resetVideoRepurposingProviders();
    const report = await reportVideoCapabilities({
      HYPERFRAMES_CLOUD_URL: "",
      OPENSHORTS_API_URL: "",
      VIDEO_FACTORY_ROOT: "",
    });
    const hyper = report.production.find((row) => row.provider === "hyperframes-cloud");
    const factory = report.production.find((row) => row.provider === "video-factory");
    const openshorts = report.repurposing.find((row) => row.provider === "openshorts");
    assert.ok(hyper);
    assert.equal(hyper.configured, false);
    assert.equal(hyper.processing_ready, false);
    assert.ok(factory);
    assert.equal(factory.processing_ready, false);
    assert.ok(openshorts);
    assert.equal(openshorts.configured, false);
    assert.equal(openshorts.processing_ready, false);
    assert.match(report.notes.join(" "), /HyperFrames Cloud is deferred/);
    assert.equal(
      [...report.production, ...report.repurposing].some((row) => row.capability.includes("publish")),
      false,
    );
    assert.match(report.notes.join(" "), /publish_clip.*never called|never called/);
  });
});
