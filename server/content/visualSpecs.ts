/**
 * Canonical visual specification registry (Phase 15).
 *
 * One place for image dimensions / aspect / usage / MIME ceilings. Format
 * profiles may name a spec id; providers map a spec onto their size presets.
 * This is not a second capability registry and not a channel allowlist.
 */

export const MAX_VARIATION_COUNT = 8;
export const MIN_CAROUSEL_SLIDES = 2;
export const MAX_CAROUSEL_SLIDES = 10;
export const MAX_VISUAL_PROMPT_CHARS = 2000;

export type VisualAspectRatio = "1:1" | "4:5" | "16:9" | "9:16";

export interface VisualSpec {
  id: string;
  /** Target usage label — not a publishing channel. */
  usage:
    | "generic_square"
    | "generic_landscape"
    | "generic_portrait"
    | "social_portrait"
    | "x_image"
    | "linkedin_image"
    | "instagram_feed"
    | "thumbnail";
  width: number;
  height: number;
  aspectRatio: VisualAspectRatio;
  mime: "image/png" | "image/jpeg" | "image/webp";
  maxBytes: number;
}

const SPECS: readonly VisualSpec[] = [
  {
    id: "generic_square",
    usage: "generic_square",
    width: 1024,
    height: 1024,
    aspectRatio: "1:1",
    mime: "image/png",
    maxBytes: 10 * 1024 * 1024,
  },
  {
    id: "generic_landscape",
    usage: "generic_landscape",
    width: 1536,
    height: 1024,
    aspectRatio: "16:9",
    mime: "image/png",
    maxBytes: 10 * 1024 * 1024,
  },
  {
    id: "generic_portrait",
    usage: "generic_portrait",
    width: 1024,
    height: 1536,
    aspectRatio: "9:16",
    mime: "image/png",
    maxBytes: 10 * 1024 * 1024,
  },
  {
    id: "social_portrait",
    usage: "social_portrait",
    width: 1024,
    height: 1280,
    aspectRatio: "4:5",
    mime: "image/png",
    maxBytes: 10 * 1024 * 1024,
  },
  {
    id: "x_image",
    usage: "x_image",
    width: 1024,
    height: 1024,
    aspectRatio: "1:1",
    mime: "image/png",
    maxBytes: 5 * 1024 * 1024,
  },
  {
    id: "linkedin_image",
    usage: "linkedin_image",
    width: 1200,
    height: 627,
    aspectRatio: "16:9",
    mime: "image/png",
    maxBytes: 10 * 1024 * 1024,
  },
  {
    id: "thumbnail",
    usage: "thumbnail",
    width: 1280,
    height: 720,
    aspectRatio: "16:9",
    mime: "image/png",
    maxBytes: 5 * 1024 * 1024,
  },
  {
    id: "instagram_feed",
    usage: "instagram_feed",
    width: 1080,
    height: 1080,
    aspectRatio: "1:1",
    mime: "image/jpeg",
    maxBytes: 8 * 1024 * 1024,
  },
];

const byId = new Map(SPECS.map((s) => [s.id, s]));

const FORMAT_CHANNEL_SPEC: Record<string, string> = {
  "image:x": "x_image",
  "image:linkedin": "linkedin_image",
  "carousel:x": "generic_square",
  "carousel:linkedin": "linkedin_image",
  "thumbnail:x": "thumbnail",
  "image:instagram": "instagram_feed",
  "carousel:instagram": "instagram_feed",
};

export function listVisualSpecs(): VisualSpec[] {
  return [...SPECS];
}

export function getVisualSpec(id: string): VisualSpec | undefined {
  return byId.get(id);
}

export function specIdForFormatChannel(format: string, channel: string): string | undefined {
  return FORMAT_CHANNEL_SPEC[`${format}:${channel}`];
}

export function specForAspectRatio(aspect: unknown): VisualSpec {
  if (aspect === "16:9") return byId.get("generic_landscape")!;
  if (aspect === "9:16") return byId.get("generic_portrait")!;
  if (aspect === "4:5") return byId.get("social_portrait")!;
  return byId.get("generic_square")!;
}

/**
 * Resolve a spec from explicit id, then format×channel, then aspect ratio.
 * Always returns a spec — never infers a channel from thin air.
 */
export function resolveVisualSpec(input: {
  specId?: string | null;
  format?: string | null;
  channel?: string | null;
  aspectRatio?: unknown;
}): VisualSpec {
  if (input.specId) {
    const named = getVisualSpec(input.specId);
    if (!named) throw new Error(`unknown visual spec "${input.specId}"`);
    return named;
  }
  if (input.format && input.channel) {
    const mapped = specIdForFormatChannel(input.format, input.channel);
    if (mapped) return byId.get(mapped)!;
  }
  return specForAspectRatio(input.aspectRatio);
}

export function dimensionsInRange(
  width: number | null,
  height: number | null,
  maxDimension: number,
): string[] {
  const issues: string[] = [];
  for (const [label, value] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (value === null) continue;
    if (!Number.isInteger(value) || value <= 0 || value > maxDimension) {
      issues.push(`${label} is out of range`);
    }
  }
  return issues;
}

export function validateVariationCount(count: number): string | null {
  if (!Number.isInteger(count) || count < 1 || count > MAX_VARIATION_COUNT) {
    return `variationCount must be an integer 1–${MAX_VARIATION_COUNT}`;
  }
  return null;
}

export function validateCarouselSlideCount(count: number): string | null {
  if (!Number.isInteger(count) || count < MIN_CAROUSEL_SLIDES || count > MAX_CAROUSEL_SLIDES) {
    return `carousel slideCount must be an integer ${MIN_CAROUSEL_SLIDES}–${MAX_CAROUSEL_SLIDES}`;
  }
  return null;
}

export function variationIdentityKey(generationId: number, position: number): string {
  return `vg:${generationId}:pos:${position}`;
}
