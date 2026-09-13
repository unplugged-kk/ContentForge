/**
 * Unit tests for Phase 1.5: voice/template versioning, deterministic template
 * rendering, policy composition, and the scheduler's duplicate-dispatch
 * decisions (in-memory ports; DB correctness is covered in creation.dbtest.ts).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Artifact, ContentTemplate, Opportunity, Schedule, ScheduleOccurrence, Voice } from "@shared/schema";
import {
  archiveTemplate,
  archiveVoice,
  createTemplate,
  createVoice,
  reviseTemplate,
  reviseVoice,
} from "./authoring";
import {
  declaredVariables,
  renderTemplateStructure,
  templatePlaceholders,
  undeclaredVariables,
} from "./templateRender";
import { composeGenerationPolicyInput, PolicyInputError } from "./policy";
import { dispatchDueOccurrences } from "./scheduling";
import type { ContentStoragePort } from "./storage";

let seq = 0;
const next = () => ++seq;

// ── In-memory authoring store ─────────────────────────────────────────────────
function authoringStore() {
  const voices: Voice[] = [];
  const templates: ContentTemplate[] = [];
  const content = {
    async insertVoice(row: Record<string, unknown>) {
      const v = { id: next(), voiceKey: null, version: 1, status: "active", ...row } as Voice;
      voices.push(v);
      return v;
    },
    async getVoice(id: number) {
      return voices.find((v) => v.id === id);
    },
    async listVoicesByKey(key: string) {
      return voices.filter((v) => v.voiceKey === key).sort((a, b) => a.version - b.version);
    },
    async nextVoiceVersion(key: string) {
      return voices.filter((v) => v.voiceKey === key).reduce((m, v) => Math.max(m, v.version), 0) + 1;
    },
    async setVoiceStatus(id: number, status: string) {
      const v = voices.find((x) => x.id === id);
      if (v) v.status = status;
      return v;
    },
    async insertContentTemplate(row: Record<string, unknown>) {
      const t = { id: next(), templateKey: null, version: 1, status: "active", ...row } as ContentTemplate;
      templates.push(t);
      return t;
    },
    async getContentTemplate(id: number) {
      return templates.find((t) => t.id === id);
    },
    async listContentTemplatesByKey(key: string) {
      return templates.filter((t) => t.templateKey === key).sort((a, b) => a.version - b.version);
    },
    async nextTemplateVersion(key: string) {
      return templates.filter((t) => t.templateKey === key).reduce((m, t) => Math.max(m, t.version), 0) + 1;
    },
    async setContentTemplateStatus(id: number, status: string) {
      const t = templates.find((x) => x.id === id);
      if (t) t.status = status;
      return t;
    },
  };
  return { content: content as unknown as ContentStoragePort, voices, templates };
}

describe("voice authoring + versioning", () => {
  it("creates revision 1 under a stable key and revises without mutating the prior revision", async () => {
    const store = authoringStore();
    const v1 = await createVoice(1, { name: "Direct", tone: "technical" }, { content: store.content });
    assert.match(String(v1.voiceKey), /^voice:/);
    assert.equal(v1.version, 1);

    const v2 = await reviseVoice(v1.id, { tone: "warmer" }, { content: store.content });
    assert.equal(v2.voiceKey, v1.voiceKey, "same logical identity");
    assert.equal(v2.version, 2);
    assert.equal(v2.name, "Direct", "unspecified fields are carried forward");
    assert.equal(v2.tone, "warmer");

    const [persisted] = store.voices;
    assert.equal(persisted.version, 1);
    assert.equal(persisted.tone, "technical", "revision 1 is untouched");
  });

  it("archives without touching content", async () => {
    const store = authoringStore();
    const v = await createVoice(1, { name: "Direct" }, { content: store.content });
    const archived = await archiveVoice(v.id, { content: store.content });
    assert.equal(archived.status, "archived");
    assert.equal(archived.name, "Direct");
  });
});

describe("template authoring + versioning", () => {
  it("creates revision 1 and revises immutably", async () => {
    const store = authoringStore();
    const t1 = await createTemplate(
      1,
      {
        name: "Hook → Insight → Takeaway",
        supportedFormats: ["x_post"],
        structure: [{ text: "Hook: {{story.title}}" }, { name: "insight" }],
        variables: ["story.title"],
      },
      { content: store.content },
    );
    assert.match(String(t1.templateKey), /^tpl:/);
    assert.equal(t1.version, 1);

    const t2 = await reviseTemplate(t1.id, { instructions: "tighter" }, { content: store.content });
    assert.equal(t2.templateKey, t1.templateKey);
    assert.equal(t2.version, 2);
    assert.deepEqual(t2.structure, t1.structure);
    assert.equal(store.templates[0].instructions, null, "revision 1 is untouched");
  });

  it("renders deterministically and reports unknown / missing variables explicitly", () => {
    const template = {
      id: 1,
      structure: [
        { text: "Hook: {{story.title}}" },
        { text: "Insight: {{story.thesis}}" },
        { text: "Takeaway: {{opportunity.concept}}" },
      ],
      variables: ["story.title", "story.thesis", "opportunity.concept"],
    } as unknown as ContentTemplate;

    assert.deepEqual(declaredVariables(template), ["story.title", "story.thesis", "opportunity.concept"]);
    assert.deepEqual(templatePlaceholders(template), [
      "opportunity.concept",
      "story.thesis",
      "story.title",
    ]);
    assert.deepEqual(undeclaredVariables(template), []);

    const rendered = renderTemplateStructure(template, { "story.title": "Scheduling" });
    assert.deepEqual(rendered.sections, [
      "Hook: Scheduling",
      "Insight: [missing: story.thesis]",
      "Takeaway: [missing: opportunity.concept]",
    ]);
    assert.deepEqual(rendered.missing, ["opportunity.concept", "story.thesis"]);

    // Deterministic: same inputs → identical output.
    assert.deepEqual(renderTemplateStructure(template, { "story.title": "Scheduling" }), rendered);

    const bad = { id: 2, structure: [{ text: "{{unknown.var}}" }], variables: [] } as unknown as ContentTemplate;
    assert.deepEqual(undeclaredVariables(bad), ["unknown.var"]);
  });
});

describe("policy composition", () => {
  const opportunity = (over: Partial<Opportunity> = {}): Opportunity =>
    ({
      id: 1,
      userId: 1,
      storyId: 1,
      concept: "c",
      objective: "educate",
      audience: "platform teams",
      angle: null,
      format: "x_post",
      channel: "x",
      status: "selected",
      score: null,
      scoreBreakdown: {},
      proposer: "human",
      chatKey: null,
      killReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    }) as Opportunity;

  it("derives everything from the Opportunity and lets explicit overrides win", () => {
    const base = composeGenerationPolicyInput(opportunity(), {}, "m1");
    assert.deepEqual(
      { format: base.format, channel: base.channel, objective: base.objective, audience: base.audience, model: base.model },
      { format: "x_post", channel: "x", objective: "educate", audience: "platform teams", model: "m1" },
    );
    const overridden = composeGenerationPolicyInput(opportunity(), { objective: "drive signups", model: "m2" }, "m1");
    assert.equal(overridden.objective, "drive signups");
    assert.equal(overridden.model, "m2");
    assert.deepEqual(overridden.constraints, {});
  });

  it("refuses to compose from a killed Opportunity", () => {
    assert.throws(
      () => composeGenerationPolicyInput(opportunity({ status: "killed" }), {}, "m1"),
      PolicyInputError,
    );
  });
});

// ── Scheduler decisions ───────────────────────────────────────────────────────
function schedulerStore() {
  const schedule = { id: 1, artifactId: 1, channel: "x", status: "active", count: 1, startAt: new Date(Date.now() - 1000), userId: 1 } as unknown as Schedule;
  const occurrence = { id: 1, scheduleId: 1, occurrenceTime: schedule.startAt, status: "pending" } as unknown as ScheduleOccurrence;
  const artifact = { id: 1, readiness: "approved", channel: "x", format: "x_post" } as unknown as Artifact;
  let publications = 0;
  // The occurrence only exists once materialized (mirrors the real flow).
  let materializedOnce = false;

  const content = {
    async listActiveSchedules() {
      return [schedule];
    },
    async getOccurrenceByScheduleTime() {
      return materializedOnce ? occurrence : undefined;
    },
    async materializeOccurrence() {
      materializedOnce = true;
      return occurrence;
    },
    async countOccurrences() {
      return materializedOnce ? 1 : 0;
    },
    async setScheduleStatus() {},
    async listDueOccurrences() {
      if (!materializedOnce) return [];
      // Mirrors the real query: non-terminal occurrences (pending | enqueued).
      return occurrence.status === "pending" || occurrence.status === "enqueued" ? [occurrence] : [];
    },
    async markOccurrenceStatusIf(_id: number, from: string, to: string) {
      if (occurrence.status !== from) return false;
      occurrence.status = to;
      return true;
    },
    async getSchedule() {
      return schedule;
    },
    async getArtifact() {
      return artifact;
    },
    async claimPublication() {
      // UNIQUE (schedule × occurrence × artifact revision): only the first wins.
      if (publications > 0) {
        return { publication: { id: 1, state: "queued", scheduleId: 1, correlationId: "c", idempotencyKey: "k" } as unknown as Publication, created: false };
      }
      publications += 1;
      return { publication: { id: 1, state: "queued", scheduleId: 1, correlationId: "c", idempotencyKey: "k" } as unknown as Publication, created: true };
    },
  };

  return { content: content as unknown as ContentStoragePort, occurrence, get publications() { return publications; } };
}

describe("scheduler dispatch decisions", () => {
  it("materializes and enqueues a due occurrence exactly once", async () => {
    const store = schedulerStore();
    const enqueued: number[] = [];
    const result = await dispatchDueOccurrences(new Date(), {
      content: store.content,
      enqueuePublication: async (p) => {
        enqueued.push(p.id);
        return true;
      },
    });
    assert.equal(result.materialized, 1);
    assert.equal(result.enqueued, 1);
    assert.deepEqual(enqueued, [1]);
  });

  it("two overlapping ticks still produce one effective publication", async () => {
    const store = schedulerStore();
    const enqueued: number[] = [];
    const deps = {
      content: store.content,
      enqueuePublication: async (p: { id: number }) => {
        enqueued.push(p.id);
        return true;
      },
    };
    const [a, b] = await Promise.all([dispatchDueOccurrences(new Date(), deps), dispatchDueOccurrences(new Date(), deps)]);
    assert.equal(a.enqueued + b.enqueued, 1, "only one tick may enqueue");
    assert.equal(enqueued.length, 1);
  });

  it("does not enqueue inline — the scheduler only hands work to the queue", async () => {
    const store = schedulerStore();
    const result = await dispatchDueOccurrences(new Date(), {
      content: store.content,
      enqueuePublication: async () => true,
    });
    assert.equal(result.publications.length, 1);
    assert.equal(result.publications[0].state, "queued", "scheduler never publishes");
  });
});

type Publication = { id: number; state: string; scheduleId: number; correlationId: string; idempotencyKey: string };
