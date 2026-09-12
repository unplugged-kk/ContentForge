/**
 * Authoring + versioning for the two durable generation inputs: Voice Profiles
 * and Content Templates (Phase 1.5).
 *
 * Both are **immutable revisions**: an edit never mutates a revision, it creates
 * the next one under the same `*_key`. That is what makes a GenerationPolicy
 * stable — a policy stores the *content hash* of the voice/template it used, so
 * editing either afterwards cannot silently change an existing policy or job.
 *
 * Template rendering is deterministic and explicit: placeholders are validated
 * against the declared variables, and a declared-but-unsupplied variable renders
 * as an explicit `[missing: name]` marker rather than silently vanishing.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ContentTemplate, Voice } from "@shared/schema";
import type { ContentStoragePort } from "./storage";
import { TemplateNotFoundError, VoiceNotFoundError } from "./policy";

export class AuthoringInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid authoring input: ${issues.join("; ")}`);
    this.name = "AuthoringInputError";
    this.issues = issues;
  }
}

export interface AuthoringDeps {
  content: ContentStoragePort;
}

// ── Voices ────────────────────────────────────────────────────────────────────
export const voiceInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  tone: z.string().trim().max(200).optional(),
  vocabulary: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
  sentenceStyle: z.string().trim().max(200).optional(),
  formatting: z.record(z.unknown()).optional(),
  doRules: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  dontRules: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  examples: z.array(z.unknown()).max(20).optional(),
});

export type VoiceInput = z.input<typeof voiceInputSchema>;
export type VoicePatch = Partial<VoiceInput>;

function voiceFields(input: VoiceInput, prior?: Voice) {
  return {
    name: input.name ?? prior?.name ?? "",
    description: input.description ?? prior?.description ?? null,
    tone: input.tone ?? prior?.tone ?? null,
    vocabulary: input.vocabulary ?? prior?.vocabulary ?? [],
    sentenceStyle: input.sentenceStyle ?? prior?.sentenceStyle ?? null,
    formatting: input.formatting ?? prior?.formatting ?? {},
    doRules: input.doRules ?? prior?.doRules ?? [],
    dontRules: input.dontRules ?? prior?.dontRules ?? [],
    examples: input.examples ?? prior?.examples ?? [],
  };
}

/** Create voice revision 1 under a fresh stable key. */
export async function createVoice(
  userId: number,
  input: VoiceInput,
  deps: AuthoringDeps,
): Promise<Voice> {
  const parsed = voiceInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new AuthoringInputError(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  const voiceKey = `voice:${randomUUID()}`;
  return deps.content.insertVoice({ userId, voiceKey, version: 1, ...voiceFields(parsed.data) });
}

/** Create the NEXT revision under the same key; the prior revision is untouched. */
export async function reviseVoice(
  voiceId: number,
  patch: VoicePatch,
  deps: AuthoringDeps,
): Promise<Voice> {
  const prior = await deps.content.getVoice(voiceId);
  if (!prior) throw new VoiceNotFoundError(voiceId);
  const parsed = voiceInputSchema.partial().safeParse(patch ?? {});
  if (!parsed.success) {
    throw new AuthoringInputError(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  const key = prior.voiceKey ?? `voice:${prior.id}`;
  const version = await deps.content.nextVoiceVersion(key);
  return deps.content.insertVoice({
    userId: prior.userId ?? null,
    voiceKey: key,
    version,
    ...voiceFields(parsed.data as VoiceInput, prior),
  });
}

/** Archive (lifecycle only — never a content mutation). */
export async function archiveVoice(voiceId: number, deps: AuthoringDeps): Promise<Voice> {
  const prior = await deps.content.getVoice(voiceId);
  if (!prior) throw new VoiceNotFoundError(voiceId);
  const updated = await deps.content.setVoiceStatus(voiceId, "archived");
  if (!updated) throw new VoiceNotFoundError(voiceId);
  return updated;
}

export async function listVoiceRevisions(
  voiceKey: string,
  deps: AuthoringDeps,
): Promise<Voice[]> {
  return deps.content.listVoicesByKey(voiceKey);
}

// ── Content templates ─────────────────────────────────────────────────────────
export const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  supportedFormats: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  supportedChannels: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  structure: z.array(z.unknown()).max(50).optional(),
  variables: z.array(z.unknown()).max(50).optional(),
  constraints: z.record(z.unknown()).optional(),
  instructions: z.string().trim().max(4000).optional(),
});

export type TemplateInput = z.input<typeof templateInputSchema>;
export type TemplatePatch = Partial<TemplateInput>;

function templateFields(input: TemplateInput, prior?: ContentTemplate) {
  return {
    name: input.name ?? prior?.name ?? "",
    description: input.description ?? prior?.description ?? null,
    supportedFormats: input.supportedFormats ?? prior?.supportedFormats ?? [],
    supportedChannels: input.supportedChannels ?? prior?.supportedChannels ?? [],
    structure: input.structure ?? prior?.structure ?? [],
    variables: input.variables ?? prior?.variables ?? [],
    constraints: input.constraints ?? prior?.constraints ?? {},
    instructions: input.instructions ?? prior?.instructions ?? null,
  };
}

export async function createTemplate(
  userId: number,
  input: TemplateInput,
  deps: AuthoringDeps,
): Promise<ContentTemplate> {
  const parsed = templateInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new AuthoringInputError(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  const templateKey = `tpl:${randomUUID()}`;
  return deps.content.insertContentTemplate({
    userId,
    templateKey,
    version: 1,
    ...templateFields(parsed.data),
  });
}

export async function reviseTemplate(
  templateId: number,
  patch: TemplatePatch,
  deps: AuthoringDeps,
): Promise<ContentTemplate> {
  const prior = await deps.content.getContentTemplate(templateId);
  if (!prior) throw new TemplateNotFoundError(templateId);
  const parsed = templateInputSchema.partial().safeParse(patch ?? {});
  if (!parsed.success) {
    throw new AuthoringInputError(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  const key = prior.templateKey ?? `tpl:${prior.id}`;
  const version = await deps.content.nextTemplateVersion(key);
  return deps.content.insertContentTemplate({
    userId: prior.userId ?? null,
    templateKey: key,
    version,
    ...templateFields(parsed.data as TemplateInput, prior),
  });
}

export async function archiveTemplate(
  templateId: number,
  deps: AuthoringDeps,
): Promise<ContentTemplate> {
  const prior = await deps.content.getContentTemplate(templateId);
  if (!prior) throw new TemplateNotFoundError(templateId);
  const updated = await deps.content.setContentTemplateStatus(templateId, "archived");
  if (!updated) throw new TemplateNotFoundError(templateId);
  return updated;
}

export async function listTemplateRevisions(
  templateKey: string,
  deps: AuthoringDeps,
): Promise<ContentTemplate[]> {
  return deps.content.listContentTemplatesByKey(templateKey);
}

// ── Deterministic template rendering (re-exported) ───────────────────────────
export {
  declaredVariables,
  renderTemplateStructure,
  templatePlaceholders,
  undeclaredVariables,
  type RenderedTemplate,
} from "./templateRender";
