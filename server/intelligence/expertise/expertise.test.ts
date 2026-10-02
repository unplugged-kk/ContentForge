/**
 * Expertise intelligence: the profile rests on real evidence, and alignment is
 * conservative — no profile or no overlap means no alignment, never a guess.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildExpertiseProfile, profileTokens, splitList } from "./profile";
import { expertiseAlignment, expertiseBand } from "./signals";

describe("buildExpertiseProfile", () => {
  it("reports insufficient rather than inventing domains", () => {
    const profile = buildExpertiseProfile({});
    assert.deepEqual(profile.domains, []);
    assert.equal(profile.confidence, "insufficient");
    assert.equal(profile.sourceCount, 0);
  });

  it("takes domains from the niche and messaging pillars", () => {
    const profile = buildExpertiseProfile({
      niche: "Platform Engineering",
      pillars: ["Kubernetes cost", "Developer experience"],
    });
    assert.deepEqual(profile.domains.slice(0, 3), [
      "Platform Engineering",
      "Kubernetes cost",
      "Developer experience",
    ]);
    assert.equal(profile.confidence, "weak");
  });

  it("promotes a topic to a domain only when the creator keeps returning to it", () => {
    const profile = buildExpertiseProfile({
      publishedTitles: [
        "Karpenter consolidation cut our idle nodes",
        "Karpenter and pod request defaults",
        "Spot instances with Karpenter",
        "A one-off note about hiring",
      ],
    });
    assert.ok(profile.domains.includes("karpenter"), "recurring topic becomes a domain");
    assert.ok(!profile.domains.includes("hiring"), "a one-off does not");
  });

  it("reaches strong confidence only with substance behind it", () => {
    const profile = buildExpertiseProfile({
      niche: "Platform Engineering",
      pillars: ["Kubernetes cost", "Developer experience"],
      publishedTitles: ["Karpenter consolidation", "Karpenter and pod requests", "EKS node spend"],
    });
    assert.equal(profile.confidence, "strong");
    assert.ok(profile.sourceCount >= 5);
  });

  it("splits audience and goal fields on what people actually type", () => {
    assert.deepEqual(splitList("platform engineers, SREs and infra leads", 6), [
      "platform engineers",
      "SREs",
      "infra leads",
    ]);
    const profile = buildExpertiseProfile({
      audienceDescription: "platform engineers, SREs",
      goals: "authority; recruiting",
    });
    assert.deepEqual(profile.audiences, ["platform engineers", "SREs"]);
    assert.deepEqual(profile.goals, ["authority", "recruiting"]);
  });

  it("drops stopwords and short tokens from topics", () => {
    const tokens = profileTokens("The future of the platform is with us");
    assert.ok(!tokens.includes("the"));
    assert.ok(tokens.includes("platform"));
  });
});

describe("expertiseAlignment", () => {
  const profile = buildExpertiseProfile({
    niche: "Platform Engineering",
    pillars: ["Kubernetes cost", "Developer experience"],
  });

  it("is zero when there is no profile or no topic", () => {
    assert.equal(expertiseAlignment(buildExpertiseProfile({}), { title: "Kubernetes cost" }).alignment, 0);
    assert.equal(expertiseAlignment(profile, {}).alignment, 0);
  });

  it("scores an on-topic subject above an off-topic one", () => {
    const onTopic = expertiseAlignment(profile, {
      title: "Kubernetes cost: idle nodes and pod requests",
    });
    const offTopic = expertiseAlignment(profile, { title: "Best sourdough starter ratios" });
    assert.ok(onTopic.alignment > offTopic.alignment);
    assert.ok(onTopic.matched.length > 0);
    assert.equal(offTopic.alignment, 0);
  });

  it("is conservative: a topic touching one word does not reach core", () => {
    const thin = expertiseAlignment(profile, { title: "Kubernetes" });
    assert.ok(thin.alignment < 0.5, `expected below core, got ${thin.alignment}`);
  });

  it("spreads evidence across the whole topic, not just the title", () => {
    const titleOnly = expertiseAlignment(profile, { title: "Kubernetes" });
    const withAngles = expertiseAlignment(profile, {
      title: "Kubernetes",
      angles: ["cost", "platform engineering ownership"],
    });
    assert.ok(withAngles.alignment >= titleOnly.alignment);
  });
});

describe("expertiseBand", () => {
  it("bands deterministically", () => {
    assert.equal(expertiseBand(0.8), "core");
    assert.equal(expertiseBand(0.3), "adjacent");
    assert.equal(expertiseBand(0.05), "outside");
    assert.equal(expertiseBand(Number.NaN), "outside");
  });
});
