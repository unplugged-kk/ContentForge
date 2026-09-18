/**
 * Visual Intelligence primitives (Phase 3).
 *
 * Three locked concerns, kept separate:
 *   • VisualIntent   — what the content wants (subject, composition, ratio…)
 *   • VisualAsset    — the durable generated output (immutable revisions)
 *   • VisualProduction — the external mechanism (provider-neutral port)
 *
 * Visuals enter the lifecycle through generation, never attached to Stories.
 * The service layer owns all persistence; providers never see business tables.
 */

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { VisualAsset, VisualGeneration } from "@shared/schema";
import { JobFailure, describeError } from "../jobs/failures";
import type { ContentStoragePort, JsonRecord } from "./storage";

// ── Media modality (Phase 9) ───────────────────────────────────────────────────
/**
 * The generation domain (Phase 3, generalized in Phase 9) is provider-agnostic
 * across modality, not image-only forever. `image` is the only capability set
 * with a real, registered producer; `video`/`audio` are declared here so a
 * future provider and format can register against the SAME registry, request
 * shape, and asset model — never a second, parallel abstraction.
 */
export type MediaModality = "image" | "video" | "audio";

/** Derives modality from the capability a provider/request names. */
export function modalityOfCapability(capability: VisualCapability): MediaModality {
  if (capability === "generate_video") return "video";
  if (capability === "generate_audio") return "audio";
  return "image";
}

// ── Visual provider contract ──────────────────────────────────────────────────
export type VisualCapability =
  | "generate_image"
  | "generate_image_variations"
  | "refine_image"
  | "edit_image"
  | "generate_slide"
  // Declared for capability-readiness only (Phase 9 §5/§23/§24) — no provider
  // registers these yet, and none may claim to without a real implementation.
  | "generate_video"
  | "generate_audio";

export interface VisualSourceImage {
  mime: string;
  width: number | null;
  height: number | null;
  bytes: Buffer;
}

export interface VisualGenerationRequest {
  kind: "image" | "carousel_slide" | "thumbnail";
  capability: VisualCapability;
  /** Frozen provider request (params + prompt). No business-table access. */
  snapshot: JsonRecord;
  correlationId: string;
  /** Explicit model preference, already validated against `provider.models`. */
  model?: string | null;
  variationIndex?: number;
  variationCount?: number;
  /** In-process source bytes for refine — never a queue payload, never a DB blob. */
  source?: VisualSourceImage;
  /** User instruction treated as DATA, never as worker execution. */
  instruction?: string | null;
}

export interface VisualGenerationOutput {
  /** Raw bytes of the produced visual. */
  bytes: Buffer;
  /** Validated MIME (image/png, image/jpeg, image/webp, image/gif). */
  mime: string;
  width: number | null;
  height: number | null;
  altText: string | null;
  provider: string;
  providerVersion: string;
  model: string | null;
  cost: string | null;
  usage: Record<string, unknown>;
}

export interface VisualProviderPort {
  readonly providerId: string;
  readonly providerVersion: string;
  readonly capabilities: readonly VisualCapability[];
  /**
   * Explicit capability declarations (Phase 9 §7) beyond the capability set
   * above. All optional — a provider that omits them still works exactly as
   * before; `modalities` defaults to deriving one entry per declared
   * capability via `modalityOfCapability` when absent. Selection never infers
   * capability from a provider's name/id.
   */
  readonly modalities?: readonly MediaModality[];
  /** Models this provider can be asked for by name (`model` on the request). */
  readonly models?: readonly string[];
  /** Whether `generate()` returns the final output synchronously (default true). */
  readonly synchronous?: boolean;
  generate(request: VisualGenerationRequest): Promise<VisualGenerationOutput>;
}

/** The modalities a provider actually supports (declared, or derived from capabilities). */
export function providerModalities(provider: VisualProviderPort): readonly MediaModality[] {
  if (provider.modalities) return provider.modalities;
  return Array.from(new Set(provider.capabilities.map(modalityOfCapability)));
}

export class VisualProviderNotRegisteredError extends Error {
  constructor(providerId: string) {
    super(`No visual provider registered for "${providerId}"`);
    this.name = "VisualProviderNotRegisteredError";
  }
}

export class VisualCapabilityUnsupportedError extends Error {
  constructor(
    readonly providerId: string,
    readonly capability: string,
  ) {
    super(`Visual provider "${providerId}" does not support "${capability}"`);
    this.name = "VisualCapabilityUnsupportedError";
  }
}

/** A requested model preference is not one the resolved provider declares. */
export class VisualModelUnsupportedError extends Error {
  constructor(
    readonly providerId: string,
    readonly model: string,
  ) {
    super(`Visual provider "${providerId}" does not support model "${model}"`);
    this.name = "VisualModelUnsupportedError";
  }
}

/**
 * Deterministic model resolution (Phase 9 §9): a provider that declares no
 * `models` list accepts any model string (it decides what to do with it); a
 * provider that DOES declare one rejects anything outside it, before any
 * provider call. No "pick the best model" inference.
 */
export function resolveProviderModel(provider: VisualProviderPort, model: string | null | undefined): void {
  if (!model) return;
  if (provider.models && !provider.models.includes(model)) {
    throw new VisualModelUnsupportedError(provider.providerId, model);
  }
}

const visualRegistry = new Map<string, VisualProviderPort>();

/** Provider selection is deterministic: exact provider id, capabilities checked. */
export function registerVisualProvider(provider: VisualProviderPort): void {
  visualRegistry.set(provider.providerId, provider);
}

export function hasVisualProvider(providerId: string): boolean {
  return visualRegistry.has(providerId);
}

export function getVisualProvider(providerId: string): VisualProviderPort {
  const provider = visualRegistry.get(providerId);
  if (!provider) throw new VisualProviderNotRegisteredError(providerId);
  return provider;
}

export function resetVisualProviders(): void {
  visualRegistry.clear();
}

// ── Asset security (validate before anything durable) ─────────────────────────
export const ALLOWED_VISUAL_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_VISUAL_BYTES = 10 * 1024 * 1024;
export const MAX_VISUAL_DIMENSION = 8192;

export class InvalidVisualInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid visual input: ${issues.join("; ")}`);
    this.name = "InvalidVisualInputError";
    this.issues = issues;
  }
}

/**
 * Validate provider output BEFORE persistence: MIME allowlist (never trust the
 * extension), byte ceiling, dimension ceiling, and an SVG ban (SVG can carry
 * scripts — reject it outright rather than sanitizing).
 */
export function validateVisualOutput(output: {
  bytes: Buffer;
  mime: string;
  width: number | null;
  height: number | null;
}): void {
  const issues: string[] = [];
  if (!(ALLOWED_VISUAL_MIMES as readonly string[]).includes(output.mime)) {
    issues.push(`mime "${output.mime}" is not allowed`);
  }
  if (!Buffer.isBuffer(output.bytes) || output.bytes.length === 0) {
    issues.push("empty visual bytes");
  } else if (output.bytes.length > MAX_VISUAL_BYTES) {
    issues.push(`visual exceeds the ${MAX_VISUAL_BYTES} byte limit`);
  }
  for (const [label, value] of [
    ["width", output.width],
    ["height", output.height],
  ] as const) {
    if (value !== null && (!Number.isInteger(value) || value <= 0 || value > MAX_VISUAL_DIMENSION)) {
      issues.push(`${label} is out of range`);
    }
  }
  if (issues.length > 0) throw new InvalidVisualInputError(issues);
}

/** Path-traversal-safe storage-key guard (keys are `local:<sha>` shaped). */
export function assertSafeStorageKey(key: string): void {
  if (!/^local:[0-9a-f]{4,128}$/.test(key)) {
    throw new InvalidVisualInputError([`unsafe storage key "${key.slice(0, 60)}"`]);
  }
}

// ── Visual intent ─────────────────────────────────────────────────────────────
export const visualIntentSchema = z.object({
  subject: z.string().trim().min(1).max(1000),
  composition: z.string().trim().max(1000).optional(),
  aspectRatio: z.enum(["1:1", "4:5", "16:9", "9:16"]).default("1:1"),
  style: z.string().trim().max(200).optional(),
  brandNotes: z.string().trim().max(1000).optional(),
  textOverlay: z.string().trim().max(300).optional(),
  slideCount: z.number().int().positive().max(25).optional(),
  role: z.string().trim().max(60).optional(),
});

export function hashIntent(intent: Record<string, unknown>): string {
  const entries = Object.entries(intent)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v ?? null)}`);
  return createHash("sha256").update(`{${entries.join(",")}}`, "utf8").digest("hex");
}

export type VisualKind = "image" | "carousel_slide" | "thumbnail" | "carousel";

export function visualGenerationIdempotencyKey(input: {
  opportunityId?: number | null;
  kind: VisualKind;
  intent: Record<string, unknown>;
  regenerationNonce?: string | null;
}): string {
  const base = `visual:${input.opportunityId ?? "direct"}:${input.kind}:${hashIntent(input.intent).slice(0, 40)}`;
  return input.regenerationNonce ? `${base}:regen:${input.regenerationNonce}` : base;
}

// ── Visual asset storage (provider-agnostic seam) ─────────────────────────────
export interface AssetStoragePort {
  /** Store bytes, return the provider-agnostic storage key (`local:<sha>` for the local impl). */
  put(bytes: Buffer, mime: string): Promise<{ storageKey: string; contentHash: string; byteSize: number }>;
  /** Resolve a storage key to bytes. */
  get(storageKey: string): Promise<Buffer>;
  /** Archive = mark unusable without deleting history (never hard-delete referenced rows). */
  archive(storageKey: string): Promise<void>;
  /**
   * Optional: a time-bounded, object-scoped URL a provider (e.g. Meta) may
   * fetch. Never a bucket listing. Implementations may return null when no
   * public base is configured.
   */
  issueProviderFetchUrl?(input: {
    storageKey: string;
    ttlMs?: number;
  }): Promise<{ url: string; expiresAt: Date } | null>;
  /** Resolve a previously issued grant token to bytes. Missing/expired → null. */
  getProviderGrant?(token: string): { bytes: Buffer; mime: string } | null;
}

/**
 * Deterministic local storage — the test/E2E implementation. Keys are content
 * addresses (`local:<sha256>`), so identical bytes can never duplicate storage.
 * Production stays domain-clean: swapping this for S3/R2 changes only the port.
 */
export function createLocalAssetStorage(): AssetStoragePort & { size(): number } {
  const blobs = new Map<string, { bytes: Buffer; mime: string; archived: boolean }>();
  const grants = new Map<string, { storageKey: string; expiresAt: number }>();

  return {
    async put(bytes: Buffer, mime: string) {
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      const storageKey = `local:${contentHash}`;
      const existing = blobs.get(storageKey);
      if (!existing) blobs.set(storageKey, { bytes: Buffer.from(bytes), mime, archived: false });
      return { storageKey, contentHash, byteSize: bytes.length };
    },
    async get(storageKey: string) {
      assertSafeStorageKey(storageKey);
      const entry = blobs.get(storageKey);
      if (!entry || entry.archived) throw new InvalidVisualInputError([`asset "${storageKey}" is unavailable`]);
      return entry.bytes;
    },
    async archive(storageKey: string) {
      assertSafeStorageKey(storageKey);
      const entry = blobs.get(storageKey);
      if (entry) entry.archived = true;
    },
    async issueProviderFetchUrl(input) {
      assertSafeStorageKey(input.storageKey);
      const entry = blobs.get(input.storageKey);
      if (!entry || entry.archived) return null;
      const publicBase = process.env.CONTENTFORGE_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
      if (!publicBase) return null;
      const ttlMs = input.ttlMs ?? 15 * 60 * 1000;
      const token = randomBytes(24).toString("hex");
      const expiresAt = Date.now() + ttlMs;
      grants.set(token, { storageKey: input.storageKey, expiresAt });
      return { url: `${publicBase}/api/provider-media/${token}`, expiresAt: new Date(expiresAt) };
    },
    getProviderGrant(token: string) {
      const grant = grants.get(token);
      if (!grant) return null;
      if (grant.expiresAt <= Date.now()) {
        grants.delete(token);
        return null;
      }
      const entry = blobs.get(grant.storageKey);
      if (!entry || entry.archived) return null;
      return { bytes: entry.bytes, mime: entry.mime };
    },
    size() {
      return blobs.size;
    },
  };
}

export type { VisualAsset, VisualGeneration };
