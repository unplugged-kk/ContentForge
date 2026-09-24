export type PublicationTargetOutcome = {
  status?: string | null;
  channel?: string | null;
  error?: string | null;
};

export type PublicationFeedback = {
  title: string;
  description: string;
  variant?: "destructive";
};

function channelLabel(outcomes: PublicationTargetOutcome[], fallback: string): string {
  const channels = Array.from(new Set(outcomes.map((outcome) => outcome.channel).filter(Boolean))) as string[];
  return channels.length > 0 ? channels.join(", ") : fallback;
}

function errorSummary(outcomes: PublicationTargetOutcome[]): string | null {
  return outcomes.find((outcome) => outcome.error)?.error ?? null;
}

/**
 * The publication endpoint uses HTTP 207 for a multi-target envelope. That
 * status says nothing about whether any target was actually published.
 */
export function getPublicationFeedback(
  response: { outcomes?: PublicationTargetOutcome[] } | null | undefined,
  fallbackChannel: string,
): PublicationFeedback {
  const outcomes = response?.outcomes ?? [];
  const statuses = outcomes.map((outcome) => outcome.status ?? "unknown");
  const uniqueStatuses = new Set(statuses);
  const channel = channelLabel(outcomes, fallbackChannel);
  const error = errorSummary(outcomes);

  if (statuses.length > 0 && uniqueStatuses.size > 1) {
    const details = Array.from(uniqueStatuses).join(", ");
    const suffix = error ? ` ${error}` : "";
    return {
      title: "Publication results are mixed",
      description: `Some targets were not confirmed for ${channel}: ${details}.${suffix}`,
      ...(statuses.includes("failed") || statuses.includes("unknown") ? { variant: "destructive" as const } : {}),
    };
  }

  if (statuses.includes("failed")) {
    return {
      title: "Publication failed",
      description: error ? `Could not publish to ${channel}: ${error}` : `Could not publish to ${channel}.`,
      variant: "destructive",
    };
  }

  if (statuses.includes("unknown")) {
    return {
      title: "Publication needs verification",
      description: error
        ? `The result for ${channel} is not confirmed: ${error}`
        : `The result for ${channel} is not confirmed. Check the publication status before retrying.`,
    };
  }

  if (statuses.length > 0 && statuses.every((status) => status === "published")) {
    return {
      title: "Published successfully",
      description: `Delivered to ${channel}.`,
    };
  }

  if (statuses.length > 0 && statuses.every((status) => status === "created" || status === "reused")) {
    return {
      title: "Publication scheduled",
      description: `The publication was accepted for ${channel}; delivery has not been confirmed yet.`,
    };
  }

  return {
    title: "Publication result unavailable",
    description: `The response did not confirm a delivery result for ${channel}.`,
    variant: "destructive",
  };
}
