/**
 * Unit tests for the chat-to-post seam.
 *
 * Chat is a *source of meaning*: it produces a normal human-provenance Story and
 * a normal Opportunity — never a chat-only content object. This file exercises
 * that mapping with in-memory ports; the full chat → Artifact path is covered in
 * `creation.dbtest.ts` and the live E2E.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Opportunity, Story } from "@shared/schema";
import { handleChatRequest, ChatInputError, ChatStoryNotFoundError, type ChatDeps } from "./chat";
import type { ContentStoragePort } from "./storage";

let seq = 0;
const next = () => ++seq;

function makeStory(row: Record<string, unknown>): Story {
  return {
    id: next(),
    userId: 1,
    researchJobId: null,
    provenance: "human",
    title: "t",
    insightBody: "b",
    interpretationMarked: true,
    angles: [],
    evidenceRefs: [],
    status: "ready",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...row,
  } as Story;
}

function harness() {
  const stories: Story[] = [];
  const opportunities: Opportunity[] = [];
  const intentCalls: string[] = [];

  const storyPort = {
    async insertStory(row: Record<string, unknown>) {
      const s = makeStory(row);
      stories.push(s);
      return s;
    },
    async getStory(id: number) {
      return stories.find((s) => s.id === id);
    },
    async updateStoryStatus(id: number, status: string) {
      const s = stories.find((x) => x.id === id);
      if (s) s.status = status as Story["status"];
      return s;
    },
  };

  const content = {
    async insertOpportunity(row: Record<string, unknown>) {
      const o = {
        id: next(),
        userId: 1,
        storyId: 0,
        concept: "c",
        objective: "o",
        audience: null,
        angle: null,
        format: "x_post",
        channel: "x",
        status: "proposed",
        score: null,
        scoreBreakdown: {},
        proposer: "human",
        killReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...row,
      } as Opportunity;
      opportunities.push(o);
      return o;
    },
    async getOpportunity(id: number) {
      return opportunities.find((o) => o.id === id);
    },
    async listOpportunitiesByStory(storyId: number) {
      return opportunities.filter((o) => o.storyId === storyId);
    },
    async updateOpportunityStatus() {
      return undefined;
    },
  };

  const deps = {
    content,
    stories: storyPort,
    opportunities: { opportunities: content, stories: storyPort },
    intent: {
      provider: "fake",
      async extract(message: string) {
        intentCalls.push(message);
        return {
          title: `title for ${message}`,
          insightBody: `insight for ${message}`,
          angles: ["a1"],
          concept: "explain the shift",
          objective: "educate",
          audience: null,
          format: "x_thread",
          channel: "x",
        };
      },
    },
    generation: {} as never,
    _intentCalls: intentCalls,
  } as unknown as ChatDeps & { _intentCalls: string[] };

  return { deps, stories, opportunities, intentCalls };
}

describe("chat-to-post", () => {
  it("turns a content request into a normal human Story + Opportunity", async () => {
    const h = harness();
    const result = await handleChatRequest(
      1,
      { message: "write a thread about scheduler plugins", generate: false },
      h.deps,
    );

    assert.equal(result.storyCreated, true);
    assert.equal(h.stories.length, 1);
    assert.equal(h.stories[0].provenance, "human");
    assert.equal(h.stories[0].researchJobId, null, "chat does not invent research");
    assert.equal(result.opportunity.storyId, h.stories[0].id);
    assert.equal(result.opportunity.format, "x_thread", "intent supplies the format");
    assert.equal(result.opportunity.channel, "x");
    assert.equal(result.opportunity.proposer, "human");
    assert.equal(result.generationJobId, null, "generate:false persists intent only");
  });

  it("reuses an existing Story when one is supplied (repurposing)", async () => {
    const h = harness();
    const existing = makeStory({ title: "Existing", researchJobId: 42 });
    h.stories.push(existing);

    const result = await handleChatRequest(
      1,
      { message: "make a post from this", storyId: existing.id, format: "x_post", generate: false },
      h.deps,
    );

    assert.equal(result.storyCreated, false);
    assert.equal(result.storyId, existing.id);
    assert.equal(h.stories.length, 1, "no new Story was created");
    assert.equal(result.opportunity.format, "x_post", "explicit format overrides intent");
    assert.equal(result.opportunity.storyId, existing.id);
  });

  it("rejects an empty request and a missing Story", async () => {
    const h = harness();
    await assert.rejects(
      () => handleChatRequest(1, { message: "   ", generate: false }, h.deps),
      ChatInputError,
    );
    await assert.rejects(
      () => handleChatRequest(1, { message: "hi", storyId: 999, generate: false }, h.deps),
      ChatStoryNotFoundError,
    );
  });

  it("never creates a second content model — the Opportunity is the normal one", async () => {
    const h = harness();
    const result = await handleChatRequest(1, { message: "post please", generate: false }, h.deps);
    // The only objects created are a Story and an Opportunity from the existing
    // tables; there is no chat-specific entity.
    assert.deepEqual(Object.keys(result).sort(), [
      "correlationId",
      "generationJobId",
      "opportunity",
      "reused",
      "storyCreated",
      "storyId",
    ]);
    assert.equal(h.opportunities.length, 1);
  });
});
