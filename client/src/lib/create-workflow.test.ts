import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveContentTypes,
  resolveFormatForOpportunity,
  deriveVersionNumber,
  extractArtifactPreviewText,
  checkPublishCompatibility,
  formatProvenanceLabel,
  type CapabilityFormat,
} from "./create-workflow";

describe("Create + Review Workflow Domain Helpers", () => {
  const MOCK_CAPABILITIES: CapabilityFormat[] = [
    { format: "x_post", channel: "x", visual: "none" },
    { format: "x_thread", channel: "x", visual: "none" },
    { format: "x_post", channel: "threads", visual: "none" },
    { format: "linkedin_post", channel: "linkedin", visual: "none" },
    { format: "image", channel: "x", visual: "required" },
    { format: "carousel", channel: "x", visual: "required" },
    { format: "image", channel: "instagram", visual: "required" },
    { format: "carousel", channel: "instagram", visual: "required" },
    { format: "thumbnail", channel: "x", visual: "required" },
    { format: "video", channel: "x", visual: "required" },
    { format: "video", channel: "instagram", visual: "required" },
    { format: "video", channel: "youtube", visual: "required" },
  ];

  it("resolveContentTypes discovers supported channels from capability list", () => {
    const types = resolveContentTypes(MOCK_CAPABILITIES);
    assert.equal(types.length, 7);

    const post = types.find((t) => t.type === "post")!;
    assert.ok(post);
    assert.ok(post.supportedChannels.includes("x"));
    assert.ok(post.supportedChannels.includes("threads"));
    assert.ok(post.supportedChannels.includes("linkedin"));

    const thread = types.find((t) => t.type === "thread")!;
    assert.deepEqual(thread.supportedChannels, ["x"]);

    const video = types.find((t) => t.type === "video")!;
    assert.ok(video.supportedChannels.includes("youtube"));
    assert.ok(video.supportedChannels.includes("x"));
    assert.ok(video.supportedChannels.includes("instagram"));

    const audio = types.find((t) => t.type === "audio")!;
    assert.equal(audio.supported, false);
    assert.match(audio.unsupportedReason || "", /Audio generation is deferred/);
  });

  it("resolveFormatForOpportunity selects correct backend format", () => {
    assert.equal(resolveFormatForOpportunity("post", "x"), "x_post");
    assert.equal(resolveFormatForOpportunity("post", "threads"), "x_post");
    assert.equal(resolveFormatForOpportunity("post", "linkedin"), "linkedin_post");
    assert.equal(resolveFormatForOpportunity("thread", "x"), "x_thread");
    assert.equal(resolveFormatForOpportunity("carousel", "instagram"), "carousel");
    assert.equal(resolveFormatForOpportunity("video", "youtube"), "video");
  });

  it("deriveVersionNumber calculates human version 1, 2, 3...", () => {
    const history = [
      { id: 101, supersedesId: null },
      { id: 105, supersedesId: 101 },
      { id: 112, supersedesId: 105 },
    ];
    assert.equal(deriveVersionNumber(101, history), 1);
    assert.equal(deriveVersionNumber(105, history), 2);
    assert.equal(deriveVersionNumber(112, history), 3);
    assert.equal(deriveVersionNumber(999, history), 4);
    assert.equal(deriveVersionNumber(50, []), 1);
  });

  it("extractArtifactPreviewText handles text, caption, and thread units", () => {
    assert.equal(extractArtifactPreviewText({ text: "Hello world" }), "Hello world");
    assert.equal(extractArtifactPreviewText({ caption: "An image caption" }), "An image caption");
    assert.equal(
      extractArtifactPreviewText({
        units: ["Tweet 1 of thread", { text: "Tweet 2 of thread" }],
      }),
      "Tweet 1 of thread\n\nTweet 2 of thread",
    );
    assert.equal(extractArtifactPreviewText(null), "");
  });

  it("checkPublishCompatibility flags unsupported channel/format pairs before publish", () => {
    const valid = checkPublishCompatibility("x_post", "x", MOCK_CAPABILITIES);
    assert.equal(valid.canPublish, true);

    const invalid = checkPublishCompatibility("x_thread", "linkedin", MOCK_CAPABILITIES);
    assert.equal(invalid.canPublish, false);
    assert.match(invalid.reason || "", /does not support/);

    const article = checkPublishCompatibility("article", "x", MOCK_CAPABILITIES);
    assert.equal(article.canPublish, false);
    assert.match(article.reason || "", /Article publishing is not configured/);

    const audio = checkPublishCompatibility("audio", "web", MOCK_CAPABILITIES);
    assert.equal(audio.canPublish, false);
    assert.match(audio.reason || "", /Audio distribution has no active transport/);
  });

  it("formatProvenanceLabel presents truthful provenance descriptions", () => {
    assert.equal(formatProvenanceLabel({ storyTitle: "Migrating to K8s" }), "Story: Migrating to K8s");
    assert.equal(formatProvenanceLabel({ ideaTitle: "Post about CI" }), "Idea: Post about CI");
    assert.equal(formatProvenanceLabel({ sourceTitle: "ArXiv paper" }), "Source: ArXiv paper");
    assert.equal(formatProvenanceLabel({ provenance: "human_edit" }), "Human revision");
    assert.equal(formatProvenanceLabel({ provenance: "human" }), "Direct creation");
    assert.equal(formatProvenanceLabel({}), "AI Generation");
  });
});
