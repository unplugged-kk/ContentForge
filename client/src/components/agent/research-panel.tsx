import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";

type JobView = {
  id: number;
  status: string;
  query: string | null;
  sourceCount?: number;
  evidenceCount?: number;
  quality?: string | null;
  summary?: {
    sources?: number;
    providers?: number;
    clusters?: number;
    conflicts?: number;
    freshness?: string;
    quality?: string;
  } | null;
};

const WINDOWS = ["last_24h", "last_7d", "last_30d"] as const;

export function ResearchPanel({
  jobId,
  onJob,
}: {
  jobId?: number | null;
  onJob?: (jobId: number) => void;
}) {
  const [query, setQuery] = useState("AI agents");
  const [windowPreset, setWindowPreset] = useState<(typeof WINDOWS)[number]>("last_30d");
  const [activeJobId, setActiveJobId] = useState<number | null>(jobId ?? null);

  useEffect(() => {
    if (jobId && jobId > 0) setActiveJobId(jobId);
  }, [jobId]);

  const jobQuery = useQuery({
    queryKey: ["/api/research/jobs", activeJobId],
    enabled: activeJobId != null,
    refetchInterval: (query) => {
      const status = (query.state.data as JobView | undefined)?.status;
      if (status === "queued" || status === "running") return 1500;
      return false;
    },
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/research/jobs/${activeJobId}`);
      return res.json() as Promise<JobView>;
    },
  });

  const analysisQuery = useQuery({
    queryKey: ["/api/research/jobs", activeJobId, "analysis"],
    enabled: activeJobId != null && jobQuery.data?.status === "complete",
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/research/jobs/${activeJobId}/analysis`);
      return res.json() as Promise<{ snapshot: { summary?: JobView["summary"]; conflicts?: unknown[] } }>;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const trimmed = query.trim();
      if (!trimmed) throw new Error("Enter a topic");
      const res = await apiRequest("POST", "/api/research/jobs", {
        kind: "directed",
        query: trimmed,
        providerIds: ["rss", "hn", "web"],
        windowPreset,
        depth: "standard",
        idempotencyKey: `ui-research-${trimmed}-${windowPreset}`,
      });
      return res.json() as Promise<{ id: number; status: string }>;
    },
    onSuccess: (body) => {
      setActiveJobId(body.id);
      onJob?.(body.id);
      void queryClient.invalidateQueries({ queryKey: ["/api/research/jobs"] });
    },
  });

  const job = jobQuery.data;
  const summary = analysisQuery.data?.snapshot?.summary ?? job?.summary;

  return (
    <Card data-testid="panel-research">
      <CardHeader className="py-3">
        <CardTitle className="text-sm">Research intelligence</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Topic"
          data-testid="input-research-query"
        />
        <div className="flex flex-wrap gap-1">
          {WINDOWS.map((preset) => (
            <Button
              key={preset}
              type="button"
              size="sm"
              variant={windowPreset === preset ? "default" : "outline"}
              onClick={() => setWindowPreset(preset)}
              data-testid={`button-window-${preset}`}
            >
              {preset}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          data-testid="button-research-start"
        >
          Research
        </Button>
        {job && (
          <div className="space-y-1 text-xs" data-testid="text-research-progress">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{job.status}</Badge>
              {job.quality && <Badge variant="outline">{job.quality}</Badge>}
            </div>
            <p data-testid="text-research-summary">
              Sources: {summary?.sources ?? job.sourceCount ?? 0}
              {" · "}Providers: {summary?.providers ?? "—"}
              {" · "}Clusters: {summary?.clusters ?? "—"}
              {" · "}Conflicts: {summary?.conflicts ?? "—"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
