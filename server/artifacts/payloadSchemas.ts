/**
 * Payload schema registry.
 *
 * Formats are data, not code paths: an Artifact's payload is validated against
 * the schema registered for its `format`. Adding a format is a registration,
 * never a branch in the domain.
 *
 * Phase B registers only `x_post` and `x_thread`. Later formats (linkedin_post,
 * article, newsletter, carousel, video_script) register without changing the
 * Artifact domain.
 */

import { z } from "zod";

export interface PayloadSchema<T = unknown> {
  /** Format key, e.g. `x_post`. Matches the Artifact `format` dimension. */
  readonly format: string;
  /** Schema version for this format's payload. */
  readonly version: number;
  readonly description?: string;
  /** Advisory limits (characters, item counts) surfaced to generation/policy. */
  readonly limits?: Readonly<Record<string, number>>;
  readonly schema: z.ZodType<T>;
}

export class PayloadValidationError extends Error {
  readonly format: string;
  readonly version: number | undefined;
  readonly issues: string[];

  constructor(format: string, version: number | undefined, issues: string[]) {
    super(
      `Invalid ${format} payload${version ? ` (v${version})` : ""}: ${issues.join("; ")}`,
    );
    this.name = "PayloadValidationError";
    this.format = format;
    this.version = version;
    this.issues = issues;
  }
}

export class PayloadSchemaNotRegisteredError extends Error {
  constructor(format: string, version?: number) {
    super(
      `No payload schema registered for format "${format}"${version ? ` version ${version}` : ""}`,
    );
    this.name = "PayloadSchemaNotRegisteredError";
  }
}

export class PayloadSchemaRegistry {
  private readonly byFormat = new Map<string, Map<number, PayloadSchema>>();

  register<T>(entry: PayloadSchema<T>): void {
    if (!entry.format) throw new Error("payload schema format is required");
    let versions = this.byFormat.get(entry.format);
    if (!versions) {
      versions = new Map();
      this.byFormat.set(entry.format, versions);
    }
    if (versions.has(entry.version)) {
      throw new Error(
        `Payload schema for "${entry.format}" version ${entry.version} is already registered`,
      );
    }
    versions.set(entry.version, entry as PayloadSchema);
  }

  /** Resolve a schema; without an explicit version, the highest one wins. */
  get(format: string, version?: number): PayloadSchema {
    const versions = this.byFormat.get(format);
    if (!versions || versions.size === 0) {
      throw new PayloadSchemaNotRegisteredError(format, version);
    }
    if (version !== undefined) {
      const exact = versions.get(version);
      if (!exact) throw new PayloadSchemaNotRegisteredError(format, version);
      return exact;
    }
    const entries: Array<[number, PayloadSchema]> = [];
    versions.forEach((entry, v) => entries.push([v, entry]));
    entries.sort((a, b) => b[0] - a[0]);
    return entries[0][1];
  }

  has(format: string, version?: number): boolean {
    const versions = this.byFormat.get(format);
    if (!versions) return false;
    return version === undefined ? versions.size > 0 : versions.has(version);
  }

  /** Formats this registry can validate. */
  formats(): string[] {
    const out: string[] = [];
    this.byFormat.forEach((_v, format) => out.push(format));
    return out.sort();
  }

  versions(format: string): number[] {
    const versions = this.byFormat.get(format);
    if (!versions) return [];
    const out: number[] = [];
    versions.forEach((_entry, version) => out.push(version));
    return out.sort((a, b) => a - b);
  }

  list(): PayloadSchema[] {
    const out: PayloadSchema[] = [];
    this.byFormat.forEach((versions) => {
      versions.forEach((entry) => out.push(entry));
    });
    return out;
  }

  /**
   * Validate a payload for a format. Returns the parsed value so callers get
   * defaults/coercions applied.
   */
  validate<T = unknown>(format: string, payload: unknown, version?: number): T {
    const entry = this.get(format, version);
    const result = entry.schema.safeParse(payload);
    if (!result.success) {
      throw new PayloadValidationError(
        format,
        entry.version,
        result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      );
    }
    return result.data as T;
  }

  reset(): void {
    this.byFormat.clear();
  }
}

/**
 * X post payload.
 *
 * Units are stored *unnumbered*; thread numbering and length slicing are
 * publish-time adapter mechanics (Ticket 07 §6), never baked into a payload.
 */
export const xPostPayloadSchema = z.object({
  text: z.string().trim().min(1),
});

export const xThreadPayloadSchema = z.object({
  units: z.array(z.string().trim().min(1)).min(1),
});

export type XPostPayload = z.infer<typeof xPostPayloadSchema>;
export type XThreadPayload = z.infer<typeof xThreadPayloadSchema>;

export const X_FORMAT_LIMITS = {
  /** Advisory only — authoritative counting happens in the X adapter. */
  maxCharacters: 280,
} as const;

/**
 * Visual payloads (Phase 3). Images reference a durable visual asset revision;
 * a carousel is an ordered sequence of per-slide references. Units keep every
 * slide independently addressable — a carousel is never flattened into one
 * opaque image.
 */
export const imagePayloadSchema = z.object({
  visualAssetId: z.number().int().positive(),
  altText: z.string().trim().max(1000).optional(),
  caption: z.string().trim().max(1000).optional(),
  role: z.string().trim().max(60).optional(),
  aspectRatio: z.enum(["1:1", "4:5", "16:9", "9:16"]).optional(),
});

export const carouselPayloadSchema = z.object({
  slides: z
    .array(
      z.object({
        visualAssetId: z.number().int().positive(),
        altText: z.string().trim().max(1000).optional(),
        caption: z.string().trim().max(1000).optional(),
        role: z.string().trim().max(60).optional(),
      }),
    )
    .min(1)
    .max(25),
  aspectRatio: z.enum(["1:1", "4:5", "16:9", "9:16"]).optional(),
});

export const thumbnailPayloadSchema = z.object({
  visualAssetId: z.number().int().positive(),
  altText: z.string().trim().max(1000).optional(),
  role: z.string().trim().max(60).optional(),
});

export type ImagePayload = z.infer<typeof imagePayloadSchema>;
export type CarouselPayload = z.infer<typeof carouselPayloadSchema>;
export type ThumbnailPayload = z.infer<typeof thumbnailPayloadSchema>;

export const payloadSchemaRegistry = new PayloadSchemaRegistry();

payloadSchemaRegistry.register<XPostPayload>({
  format: "x_post",
  version: 1,
  description: "Single X post; unnumbered body text",
  limits: { maxCharacters: X_FORMAT_LIMITS.maxCharacters },
  schema: xPostPayloadSchema,
});

payloadSchemaRegistry.register<XThreadPayload>({
  format: "x_thread",
  version: 1,
  description: "X thread; ordered, unnumbered units",
  limits: { maxUnits: 25, maxCharacters: X_FORMAT_LIMITS.maxCharacters },
  schema: xThreadPayloadSchema,
});

payloadSchemaRegistry.register<ImagePayload>({
  format: "image",
  version: 1,
  description: "Image referencing an immutable visual asset revision",
  schema: imagePayloadSchema,
});

payloadSchemaRegistry.register<CarouselPayload>({
  format: "carousel",
  version: 1,
  description: "Carousel of ordered, independently addressable visual slides",
  limits: { maxUnits: 25 },
  schema: carouselPayloadSchema,
});

payloadSchemaRegistry.register<ThumbnailPayload>({
  format: "thumbnail",
  version: 1,
  description: "Thumbnail referencing an immutable visual asset revision",
  schema: thumbnailPayloadSchema,
});
