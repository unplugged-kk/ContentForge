import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui-shared/empty-state";
import { ErrorState } from "@/components/ui-shared/error-state";
import { StatusBadge } from "@/components/ui-shared/status-badge";
import { getCanonicalReviewUrl } from "@/lib/agent-workspace-state";
import { formatRelativeTime } from "@/lib/agent-workspace-state";
import { Send } from "lucide-react";
import type { PublicationLike } from "@/lib/today-schedule-state";

/**
 * Phase 28.2F — the canonical Story→Artifact→Schedule→Publication pipeline's
 * home in Schedule. Queue/Calendar stay on the legacy Post model as-is;
 * this tab is where agent/create-studio-originated publications become
 * visible for the first time (previously invisible anywhere in the UI).
 */
export function PublicationsView() {
  const query = useQuery<PublicationLike[]>({ queryKey: ["/api/publications?limit=30"] });

  if (query.isLoading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="p-4">
        <ErrorState
          title="Couldn't load publications"
          description="Something went wrong while loading the publication history."
          onRetry={() => query.refetch()}
        />
      </div>
    );
  }

  const rows = query.data ?? [];

  if (rows.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={Send}
          title="No publications yet"
          description="Content approved and scheduled from Create or Agent Workspace shows up here."
        />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2 overflow-y-auto" data-testid="list-publications">
      {rows.map((pub) => {
        const isUnknown = pub.result?.outcome === "unknown";
        const isFailed = pub.state === "failed";
        return (
          <Card key={pub.id} className="p-3 flex items-center justify-between gap-3" data-testid={`card-publication-${pub.id}`}>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground capitalize">{pub.channel}</span>
                <StatusBadge status={isUnknown ? "unknown" : pub.state} />
                <span className="text-[11px] text-muted-foreground">{formatRelativeTime(pub.createdAt)}</span>
              </div>
              {(isFailed || isUnknown) && (
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {isUnknown
                    ? "We couldn't confirm what happened with the platform."
                    : pub.result?.errorMessage || pub.lastError || "The channel reported a failure."}
                </p>
              )}
            </div>
            <Button asChild size="sm" variant={isFailed || isUnknown ? "outline" : "ghost"} className="shrink-0 text-xs">
              <Link href={getCanonicalReviewUrl(pub.artifactId)}>
                {isUnknown ? "Check status" : isFailed ? "View details" : "View"}
              </Link>
            </Button>
          </Card>
        );
      })}
    </div>
  );
}
