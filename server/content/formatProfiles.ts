/**
 * Format profiles — platform-aware formatting configuration.
 *
 * A format profile is the *declarative* answer to "what does good content look
 * like in this format on this channel?". It is consumed by Generation Policy and
 * the prompt assembler, so platform rules never leak into Story, Opportunity or
 * the Artifact domain.
 *
 * Only formats whose payload schema is genuinely registered get a profile. There
 * are deliberately NO placeholder entries: a future format is added by
 * registering its payload schema AND its profile together.
 */

export interface FormatProfile {
  format: string;
  channel: string;
  /** Human/`model`-readable platform guidance embedded in the prompt. */
  guidance: string;
  /** Structural defaults merged into the policy constraints. */
  constraints: {
    maxCharacters?: number;
    maxUnits?: number;
    minUnits?: number;
    /** true → units must read as an ordered sequence (thread). */
    sequential?: boolean;
    /** true → the first unit must carry the hook. */
    hookFirst?: boolean;
    /** Whether a closing CTA is expected. */
    cta?: boolean;
    /**
     * Visual requirement for this format: "none" (text-only), "optional"
     * (may degrade to text-only if generation fails), "required" (the
     * Artifact is blocked until the visual exists).
     */
    visual?: "none" | "optional" | "required";
    visualSpecId?: string;
  };
}

const PROFILES: readonly FormatProfile[] = [
  {
    format: "x_post",
    channel: "x",
    guidance:
      "One compact post. Lead with a strong, specific hook in the first clause. " +
      "No preamble, no hashtags, no emoji unless the voice asks for them. " +
      "Short sentences; one idea per post; end with a concrete takeaway.",
    constraints: { maxCharacters: 280, maxUnits: 1, cta: false },
  },
  {
    format: "x_thread",
    channel: "x",
    guidance:
      "An ordered thread of 2–8 units. Unit 1 is the hook and must stand alone. " +
      "Each following unit advances exactly one step of the argument; the last unit lands the takeaway. " +
      "Do not number the units — numbering is a publish-time adapter mechanic.",
    constraints: { maxCharacters: 280, minUnits: 2, maxUnits: 8, sequential: true, hookFirst: true, cta: true },
  },
  {
    format: "x_post",
    channel: "threads",
    guidance:
      "One compact Threads text post. Lead with a specific hook. No carousel, no video. " +
      "Stay inside 500 characters (emojis count as UTF-8 bytes). One idea; a concrete takeaway.",
    constraints: { maxCharacters: 500, maxUnits: 1, cta: false },
  },
  {
    format: "linkedin_post",
    channel: "linkedin",
    guidance:
      "A single LinkedIn post. Open with a hook line that stands alone in the feed preview. " +
      "Short paragraphs, line breaks between ideas, no hashtag stuffing. " +
      "Professional register; a concrete takeaway or question invites comments.",
    constraints: { maxCharacters: 3000, maxUnits: 1, cta: false },
  },
  {
    format: "image",
    channel: "x",
    guidance:
      "A single supporting image for the post. It must reinforce the Artifact's thesis, " +
      "stay readable at small sizes, and carry no misleading claims (no invented charts " +
      "or fake data viz). Prefer high contrast and one focal subject.",
    constraints: { maxCharacters: 280, maxUnits: 1, visual: "required", visualSpecId: "x_image" },
  },
  {
    format: "carousel",
    channel: "x",
    guidance:
      "An ordered carousel of 2–10 slides telling one argument. Slide 1 is the hook. " +
      "Each slide carries one idea with minimal text; the last slide lands the takeaway. " +
      "Every slide keeps its own asset reference — never collapse slides into one image.",
    constraints: { minUnits: 2, maxUnits: 10, sequential: true, hookFirst: true, visual: "required", visualSpecId: "generic_square" },
  },
  {
    format: "image",
    channel: "instagram",
    guidance:
      "A single Instagram feed JPEG. One focal subject, readable at phone size. " +
      "Caption is optional and must not invent data. Aspect between 4:5 and 1.91:1.",
    constraints: { maxCharacters: 2200, maxUnits: 1, visual: "required", visualSpecId: "instagram_feed" },
  },
  {
    format: "carousel",
    channel: "instagram",
    guidance:
      "An ordered Instagram carousel of 2–10 JPEG slides. Slide 1 is the hook. " +
      "Each slide keeps its own asset; never collapse slides. Complete set required to publish.",
    constraints: {
      minUnits: 2,
      maxUnits: 10,
      sequential: true,
      hookFirst: true,
      visual: "required",
      visualSpecId: "instagram_feed",
    },
  },
  {
    format: "thumbnail",
    channel: "x",
    guidance:
      "A single 16:9 thumbnail that reads at small sizes: one focal subject, large " +
      "legible title text if any, no fine detail that collapses at 120px wide.",
    constraints: { maxCharacters: 280, maxUnits: 1, visual: "required", visualSpecId: "thumbnail" },
  },
  {
    format: "video",
    channel: "x",
    guidance:
      "A short-form social video. Hook in the first seconds. One idea, readable captions if any, " +
      "no invented data. Publishing this format is deferred — generation and Artifact attachment " +
      "are the durable primitives.",
    constraints: { maxUnits: 1, visual: "required", visualSpecId: "generic_social_video" },
  },
  {
    format: "video",
    channel: "instagram",
    guidance:
      "An Instagram Reel: vertical 9:16 MP4, hook in the first seconds, one idea. " +
      "Caption is optional and must not invent data. Cover/thumbnail selection is omitted.",
    constraints: { maxCharacters: 2200, maxUnits: 1, visual: "required", visualSpecId: "instagram_reel" },
  },
  {
    format: "video",
    channel: "youtube",
    guidance:
      "A YouTube video upload (Phase 28.1): MP4 referencing one VisualAsset revision. " +
      "Title/description/privacy live in optional payload fields; default privacy is private.",
    constraints: { maxUnits: 1, visual: "required", visualSpecId: "generic_social_video" },
  },
];

const byKey = new Map(PROFILES.map((p) => [`${p.format}:${p.channel}`, p]));

export function getFormatProfile(format: string, channel: string): FormatProfile | undefined {
  return byKey.get(`${format}:${channel}`);
}

export function hasFormatProfile(format: string, channel: string): boolean {
  return byKey.has(`${format}:${channel}`);
}

export function listFormatProfiles(): FormatProfile[] {
  return [...PROFILES];
}
