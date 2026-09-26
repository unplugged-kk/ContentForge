import React from "react";
import { Layers } from "lucide-react";
import { SiInstagram, SiLinkedin, SiThreads, SiX, SiYoutube } from "react-icons/si";
import { cn } from "@/lib/utils";

export interface ChannelIconProps {
  channel: string;
  className?: string;
  /** Override the accessible channel name when the surrounding copy needs more context. */
  label?: string;
  /** Hide the icon when an adjacent visible label already names the channel. */
  decorative?: boolean;
  "data-testid"?: string;
}

type ChannelKey = "x" | "threads" | "linkedin" | "instagram" | "youtube" | "both" | "other";

function normalizeChannel(channel: string): ChannelKey {
  const value = channel.trim().toLowerCase();
  if (value === "x" || value === "twitter") return "x";
  if (value === "threads") return "threads";
  if (value === "linkedin") return "linkedin";
  if (value === "instagram") return "instagram";
  if (value === "youtube") return "youtube";
  if (value === "both") return "both";
  return "other";
}

function channelLabel(channel: string): string {
  switch (normalizeChannel(channel)) {
    case "x": return "X";
    case "threads": return "Threads";
    case "linkedin": return "LinkedIn";
    case "instagram": return "Instagram";
    case "youtube": return "YouTube";
    case "both": return "X and Threads";
    default: return channel.trim() || "Channel";
  }
}

function IconGlyph({ channel, className, decorative }: { channel: ChannelKey; className?: string; decorative: boolean }) {
  const glyphClass = cn("h-3.5 w-3.5", className);
  const glyphProps = { className: glyphClass, "aria-hidden": true, role: decorative ? "presentation" : undefined } as const;
  switch (channel) {
    case "x": return <SiX {...glyphProps} />;
    case "threads": return <SiThreads {...glyphProps} />;
    case "linkedin": return <SiLinkedin {...glyphProps} className={cn(glyphClass, "text-[#0A66C2]")} />;
    case "instagram": return <SiInstagram {...glyphProps} className={cn(glyphClass, "text-[#E4405F]")} />;
    case "youtube": return <SiYoutube {...glyphProps} className={cn(glyphClass, "text-[#FF0000]")} />;
    case "both": return <><SiX {...glyphProps} /><SiThreads {...glyphProps} /></>;
    default: return <Layers {...glyphProps} />;
  }
}

/**
 * One accessible channel-icon primitive. Use the default for icon-only meaning;
 * pass decorative when a visible adjacent label already communicates the channel.
 */
export function ChannelIcon({
  channel,
  className,
  label,
  decorative = false,
  "data-testid": testId,
}: ChannelIconProps) {
  const normalized = normalizeChannel(channel);
  const isBoth = normalized === "both";
  const glyph = <IconGlyph channel={normalized} className={className} decorative={decorative} />;

  if (decorative) {
    return (
      <span
        aria-hidden="true"
        className={cn("inline-flex shrink-0", isBoth && "items-center gap-1")}
        data-channel={normalized}
        data-testid={testId}
      >
        {glyph}
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={label ?? channelLabel(channel)}
      className={cn("inline-flex shrink-0", isBoth && "items-center gap-1", className)}
      data-channel={normalized}
      data-testid={testId}
    >
      {glyph}
    </span>
  );
}
