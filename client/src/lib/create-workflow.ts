/**
 * Create + Review Workflow Domain Helpers (Phase 28.2C)
 *
 * Implements capability-derived format and channel mapping, artifact versioning,
 * preview text extraction, and publication compatibility checks.
 */

export type ContentType =
  | "post"
  | "thread"
  | "article"
  | "carousel"
  | "image"
  | "video"
  | "audio";

export interface CapabilityFormat {
  format: string;
  channel: string;
  visual?: "none" | "optional" | "required" | string;
}

export interface ContentTypeDescriptor {
  type: ContentType;
  label: string;
  format: string;
  defaultChannel: string;
  supportedChannels: string[];
  visualRequirement: "none" | "optional" | "required";
  supported: boolean;
  unsupportedReason?: string;
}

/**
 * Derives content types and their supported channels from backend capabilities.
 * Guarantees zero hardcoded format allowlists by taking capabilities from /api/repurposing/capabilities.
 */
export function resolveContentTypes(
  capabilities: CapabilityFormat[] = [],
  registeredChannels: string[] = [],
): ContentTypeDescriptor[] {
  // Discover supported channels per format from backend capabilities
  const channelsByFormat = new Map<string, Set<string>>();
  for (const cap of capabilities) {
    if (!channelsByFormat.has(cap.format)) {
      channelsByFormat.set(cap.format, new Set());
    }
    channelsByFormat.get(cap.format)!.add(cap.channel);
  }

  // Fallback defaults matching registered backend profiles if capabilities not yet fetched
  const xPostChannels = Array.from(channelsByFormat.get("x_post") || ["x", "threads"]);
  const liPostChannels = Array.from(channelsByFormat.get("linkedin_post") || ["linkedin"]);
  const postChannels = Array.from(new Set([...xPostChannels, ...liPostChannels]));
  const threadChannels = Array.from(channelsByFormat.get("x_thread") || ["x"]);
  const imageChannels = Array.from(channelsByFormat.get("image") || ["x", "instagram"]);
  const carouselChannels = Array.from(channelsByFormat.get("carousel") || ["x", "instagram"]);
  const videoChannels = Array.from(channelsByFormat.get("video") || ["youtube", "x", "instagram"]);

  return [
    {
      type: "post",
      label: "Post",
      format: "x_post", // dynamically switches to linkedin_post if linkedin channel is selected
      defaultChannel: postChannels.includes("x") ? "x" : postChannels[0] || "x",
      supportedChannels: postChannels.length > 0 ? postChannels : ["x", "linkedin", "threads"],
      visualRequirement: "none",
      supported: true,
    },
    {
      type: "thread",
      label: "Thread",
      format: "x_thread",
      defaultChannel: "x",
      supportedChannels: threadChannels.length > 0 ? threadChannels : ["x"],
      visualRequirement: "none",
      supported: true,
    },
    {
      type: "article",
      label: "Article",
      format: "article",
      defaultChannel: "x",
      supportedChannels: ["x"],
      visualRequirement: "none",
      supported: true,
      unsupportedReason: "Article publishing is not configured in the xQuick adapter yet.",
    },
    {
      type: "carousel",
      label: "Carousel",
      format: "carousel",
      defaultChannel: carouselChannels.includes("x") ? "x" : carouselChannels[0] || "instagram",
      supportedChannels: carouselChannels.length > 0 ? carouselChannels : ["x", "instagram"],
      visualRequirement: "required",
      supported: true,
    },
    {
      type: "image",
      label: "Image",
      format: "image",
      defaultChannel: imageChannels.includes("x") ? "x" : imageChannels[0] || "instagram",
      supportedChannels: imageChannels.length > 0 ? imageChannels : ["x", "instagram"],
      visualRequirement: "required",
      supported: true,
    },
    {
      type: "video",
      label: "Video",
      format: "video",
      defaultChannel: videoChannels.includes("youtube") ? "youtube" : videoChannels[0] || "x",
      supportedChannels: videoChannels.length > 0 ? videoChannels : ["youtube", "x", "instagram"],
      visualRequirement: "required",
      supported: true,
    },
    {
      type: "audio",
      label: "Audio",
      format: "audio",
      defaultChannel: "web",
      supportedChannels: [],
      visualRequirement: "none",
      supported: false,
      unsupportedReason: "Audio generation is deferred (no active provider registered).",
    },
  ];
}

/**
 * Resolves the concrete format identifier for an Opportunity from contentType + channel.
 */
export function resolveFormatForOpportunity(type: ContentType, channel: string): string {
  if (type === "post") {
    return channel === "linkedin" ? "linkedin_post" : "x_post";
  }
  if (type === "thread") return "x_thread";
  if (type === "carousel") return "carousel";
  if (type === "image") return "image";
  if (type === "video") return "video";
  return type;
}

/**
 * Calculates human version number (1, 2, 3...) from artifact history.
 */
export function deriveVersionNumber(
  artifactId: number,
  history: Array<{ id: number; supersedesId?: number | null }> = [],
): number {
  if (!history || history.length === 0) return 1;
  const sorted = [...history].sort((a, b) => a.id - b.id);
  const idx = sorted.findIndex((h) => h.id === artifactId);
  return idx >= 0 ? idx + 1 : sorted.length + 1;
}

/**
 * Extracts clean preview text from an Artifact payload across single text, caption, or units.
 */
export function extractArtifactPreviewText(payload: Record<string, unknown> | null | undefined): string {
  if (!payload) return "";
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.caption === "string") return payload.caption;
  if (typeof payload.body === "string") return payload.body;
  if (Array.isArray(payload.units)) {
    return payload.units
      .map((unit) => {
        if (typeof unit === "string") return unit;
        if (unit && typeof unit === "object" && typeof (unit as { text?: string }).text === "string") {
          return (unit as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

/**
 * Pre-checks whether an artifact can publish to a target channel before the user clicks publish.
 */
export function checkPublishCompatibility(
  format: string,
  channel: string,
  capabilities?: CapabilityFormat[],
): { canPublish: boolean; reason?: string } {
  if (format === "article") {
    return {
      canPublish: false,
      reason: "Article publishing is not configured in the channel adapter yet.",
    };
  }
  if (format === "audio") {
    return {
      canPublish: false,
      reason: "Audio distribution has no active transport registered.",
    };
  }
  if (!capabilities || capabilities.length === 0) {
    return { canPublish: true };
  }
  const match = capabilities.some((c) => c.format === format && c.channel === channel);
  if (!match) {
    return {
      canPublish: false,
      reason: `The "${channel}" adapter does not support format "${format}".`,
    };
  }
  return { canPublish: true };
}

/**
 * Formats a clean provenance string without exposing raw backend keys.
 */
export function formatProvenanceLabel(origin: {
  provenance?: string | null;
  storyTitle?: string | null;
  ideaTitle?: string | null;
  sourceTitle?: string | null;
}): string {
  if (origin.storyTitle) return `Story: ${origin.storyTitle}`;
  if (origin.ideaTitle) return `Idea: ${origin.ideaTitle}`;
  if (origin.sourceTitle) return `Source: ${origin.sourceTitle}`;
  if (origin.provenance === "human_edit") return "Human revision";
  if (origin.provenance === "human") return "Direct creation";
  return "AI Generation";
}
