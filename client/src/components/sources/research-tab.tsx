import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { History, RefreshCw, Compass, ArrowRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui-shared/error-state";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  formatRelativeTime,
  formatTimeWindow,
  formatResearchDepth,
  resolveResearchStatus,
} from "@/lib/sources-research-state";

export interface ResearchTabProps {
  onSelectJob?: (jobId: number) => void;
}

export function ResearchTab({ onSelectJob }: ResearchTabProps) {
  const { toast } = useToast();
  const [rerunningId, setRerunningId] = useState<number | null>(null);

  // List past research jobs
  const jobsQuery = useQuery({
    queryKey: ["/api/research/jobs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/research/jobs?limit=50");
      return res.json() as Promise<any[]>;
    },
  });

  // Re-run mutation
  const rerunMutation = useMutation({
    mutationFn: async (job: any) => {
      setRerunningId(job.id);
      const res = await apiRequest("POST", "/api/research/jobs", {
        kind: job.kind || "directed",
        query: job.query,
        providerIds: job.providerIds?.length ? job.providerIds : ["rss", "hn", "web"],
        windowPreset: "last_7d",
        depth: "standard",
        idempotencyKey: `rerun:${job.query}:${Date.now()}`,
      });
      return res.json() as Promise<{ id: number }>;
    },
    onSuccess: (newJob) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/research/jobs"] });
      setRerunningId(null);
      toast({ title: "Research Started", description: "Fresh session dispatched." });
      if (onSelectJob) onSelectJob(newJob.id);
    },
    onError: (err: Error) => {
      setRerunningId(null);
      toast({ title: "Re-run failed", description: err.message, variant: "destructive" });
    },
  });

  const jobs = jobsQuery.data ?? [];

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold tracking-tight">Research Sessions</h2>
          <p className="text-xs text-muted-foreground">
            History of research operations, sources investigated, and reproducibility snapshots.
          </p>
        </div>
      </div>

      {/* History List */}
      {jobsQuery.isError ? (
        <ErrorState
          title="Couldn't load research history"
          description="Your research sessions could not be retrieved. This is a read failure, not an empty history."
          onRetry={() => void jobsQuery.refetch()}
        />
      ) : jobs.length > 0 ? (
        <div className="space-y-3" data-testid="list-research-history">
          {jobs.map((job) => {
            const status = resolveResearchStatus({
              jobStatus: job.status,
              errorMessage: job.errorMessage,
            });

            const isRerunning = rerunningId === job.id;

            return (
              <Card key={job.id} className="border-border shadow-xs hover:border-primary/40 transition-colors" data-testid={`card-research-job-${job.id}`}>
                <CardHeader className="pb-2 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Session #{job.id}
                      </span>
                      <Badge
                        variant={
                          status.status === "complete"
                            ? "default"
                            : status.status === "completed_with_warnings"
                            ? "secondary"
                            : status.status === "failed"
                            ? "destructive"
                            : "outline"
                        }
                        className="text-xs"
                      >
                        {status.label}
                      </Badge>
                    </div>

                    <span className="text-xs text-muted-foreground">
                      Ran {formatRelativeTime(job.createdAt)}
                    </span>
                  </div>

                  <CardTitle className="text-sm sm:text-base font-semibold text-foreground">
                    {job.query || "Autonomous Topic Research"}
                  </CardTitle>
                </CardHeader>

                <CardContent className="space-y-3 text-sm">
                  {/* Context & Metadata */}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {job.sourceCount != null && (
                      <span><strong>{job.sourceCount}</strong> sources</span>
                    )}
                    {job.evidenceCount != null && (
                      <>
                        <span>·</span>
                        <span><strong>{job.evidenceCount}</strong> evidence items</span>
                      </>
                    )}
                    {job.providerIds?.length > 0 && (
                      <>
                        <span>·</span>
                        <span>Providers: {job.providerIds.join(", ")}</span>
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1.5"
                      onClick={() => onSelectJob?.(job.id)}
                      data-testid={`button-view-research-${job.id}`}
                    >
                      <Compass className="h-3.5 w-3.5" />
                      View Findings
                    </Button>

                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 text-xs gap-1.5 ml-auto"
                      disabled={isRerunning || rerunMutation.isPending}
                      onClick={() => rerunMutation.mutate(job)}
                      data-testid="button-research-rerun"
                    >
                      {isRerunning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Run Again
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center space-y-2 text-muted-foreground" data-testid="state-research-empty">
          <History className="h-8 w-8 mx-auto opacity-40 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">No Research Yet</h3>
          <p className="text-xs max-w-sm mx-auto">
            Your completed research sessions and snapshots will appear here with source counts and rerun controls.
          </p>
        </div>
      )}
    </div>
  );
}
