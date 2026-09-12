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

import { createHash } from "node:crypto";
import { z } from "zod";
import type { VisualAsset, VisualGeneration } from "@shared/schema";
import { JobFailure, describeError } from "../jobs/failures";
import type { ContentStoragePort, JsonRecord } from "./storage";

// ── Visual provider contract ──────────────────────────────────────────────────
export type VisualCapability = "generate_image" | "edit_image" | "generate_slide";

export interface VisualGenerationRequest {
  kind: "image" | "carousel_slide" | "thumbnail";
  capability: VisualCapability;
  /** Frozen provider request (params + prompt). No business-table access. */
  snapshot: JsonRecord;
  correlationId: string;
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
  generate(request: VisualGenerationRequest): Promise<VisualGenerationOutput>;
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

export type VisualKind = "image" | "carousel_slide" | "thumbnail";

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
}

/**
 * Deterministic local storage — the test/E2E implementation. Keys are content
 * addresses (`local:<sha256>`), so identical bytes can never duplicate storage.
 * Production stays domain-clean: swapping this for S3/R2 changes only the port.
 */
export function createLocalAssetStorage(): AssetStoragePort & { size(): number } {
  const blobs = new Map<string, { bytes: Buffer; mime: string; archived: boolean }>();

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
    size() {
      return blobs.size;
    },
  };
}

export type { VisualAsset, VisualGeneration };
