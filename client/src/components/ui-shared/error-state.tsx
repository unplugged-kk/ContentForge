import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-center"
      data-testid="error-state"
    >
      <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
      <p className="text-sm font-medium" data-testid="text-error-state-title">{title}</p>
      <p className="text-xs text-muted-foreground max-w-sm" data-testid="text-error-state-description">{description}</p>
      {detail ? (
        <p className="text-[10px] text-muted-foreground/70 font-mono max-w-sm break-words">{detail}</p>
      ) : null}
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying} data-testid="button-error-state-retry">
          <RotateCw className={`h-3.5 w-3.5 mr-1.5 ${retrying ? "animate-spin" : ""}`} />
          Try again
        </Button>
      ) : null}
    </div>
  );
}
