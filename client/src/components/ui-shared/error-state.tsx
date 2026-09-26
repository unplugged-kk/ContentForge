import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StateSurface } from "@/components/ui-shared/state-surface";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  detail?: string;
  onRetry?: () => void;
  retrying?: boolean;
}

/** Shown when a read fails. Never substitute this with an empty-state. */
export function ErrorState({
  title = "Couldn't load this",
  description = "Something went wrong while loading this content.",
  detail,
  onRetry,
  retrying = false,
}: ErrorStateProps) {
  return (
    <StateSurface role="alert" data-testid="error-state">
      <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
      <p className="text-sm font-medium" data-testid="text-error-state-title">{title}</p>
      <p className="text-xs text-muted-foreground max-w-sm" data-testid="text-error-state-description">{description}</p>
      {detail ? (
        <p className="text-xs text-muted-foreground/70 font-mono max-w-sm break-words">{detail}</p>
      ) : null}
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying} data-testid="button-error-state-retry">
          <RotateCw
            className={`h-3.5 w-3.5 mr-1.5 ${retrying ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {/*
            The spin is reinforcement only: `prefers-reduced-motion` stops it, so
            the pending state has to survive as a word. It previously did not —
            the idle and pending labels were identical (motion audit #4).
          */}
          {retrying ? "Retrying…" : "Try again"}
        </Button>
      ) : null}
    </StateSurface>
  );
}
