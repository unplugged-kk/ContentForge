import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Capability = { format: string; channel: string; visual: string };

type PlanView = {
  id: number;
  storyId: number;
  status: string;
  requestKey: string;
  progress: {
    targets: number;
    opportunitiesCreated: number;
    opportunitiesReused: number;
    invalid: number;
    jobsQueued: number;
    jobsSucceeded: number;
    jobsFailed: number;
    artifacts: number;
    awaitingApproval: number;
  };
  outcomes: Array<{
    format: string;
    channel: string;
    slot: number;
    status: string;
    opportunityId: number | null;
    generationJobId: number | null;
    error: string | null;
  }>;
};

const PRESETS: Array<{ channel: string; format: string; label: string; count: number }> = [
  { channel: "x", format: "x_post", label: "X posts", count: 3 },
  { channel: "x", format: "x_thread", label: "X thread", count: 1 },
  { channel: "linkedin", format: "linkedin_post", label: "LinkedIn posts", count: 2 },
  { channel: "instagram", format: "image", label: "Instagram image", count: 1 },
];

function pairKey(channel: string, format: string) {
  return `${channel}:${format}`;
}

export function RepurposePanel({
  storyId,
  planId,
  onPlan,
  onOpenArtifact,
}: {
  storyId?: number | null;
  planId?: number | null;
  onPlan?: (planId: number) => void;
  onOpenArtifact?: (opportunityId: number) => void;
}) {
  const [storyInput, setStoryInput] = useState(storyId ? String(storyId) : "");
  const [selected, setSelected] = useState<Record<string, number>>({
    "x:x_post": 3,
    "x:x_thread": 1,
    "linkedin:linkedin_post": 2,
  });
  const [activePlanId, setActivePlanId] = useState<number | null>(planId ?? null);

  useEffect(() => {
    if (storyId && storyId > 0) setStoryInput(String(storyId));
  }, [storyId]);

  useEffect(() => {
    if (planId && planId > 0) setActivePlanId(planId);
  }, [planId]);

  const capabilitiesQuery = useQuery({
    queryKey: ["/api/repurposing/capabilities"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/repurposing/capabilities");
      return res.json() as Promise<{ formats: Capability[]; limits: { maxOpportunities: number } }>;
    },
  });

  const registered = useMemo(() => {
    const set = new Set((capabilitiesQuery.data?.formats ?? []).map((row) => pairKey(row.channel, row.format)));
    return PRESETS.filter((preset) => set.size === 0 || set.has(pairKey(preset.channel, preset.format)));
  }, [capabilitiesQuery.data]);

  const planQuery = useQuery({
    queryKey: ["/api/repurposing/plans", activePlanId],
    enabled: activePlanId != null,
    refetchInterval: (query) => {
      const status = (query.state.data as PlanView | undefined)?.status;
      if (status === "running" || status === "queued" || status === "planning") return 1500;
      return false;
    },
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/repurposing/plans/${activePlanId}`);
      return res.json() as Promise<PlanView>;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (asNew: boolean) => {
      const id = Number(storyInput);
      if (!Number.isInteger(id) || id <= 0) throw new Error("Enter a Story id");
      const targets = registered
        .filter((preset) => (selected[pairKey(preset.channel, preset.format)] ?? 0) > 0)
        .map((preset) => ({
          format: preset.format,
          channel: preset.channel,
          count: selected[pairKey(preset.channel, preset.format)] ?? preset.count,
        }));
      if (targets.length === 0) throw new Error("Select at least one target");
      const key = asNew ? `ui-${id}-${Date.now().toString(36)}` : `ui-story-${id}`;
      const res = await apiRequest("POST", `/api/stories/${id}/repurpose`, { requestKey: key, targets });
      return res.json() as Promise<{ planId: number | null; progress: PlanView["progress"] }>;
    },
    onSuccess: (body) => {
      if (body.planId) {
        setActivePlanId(body.planId);
        onPlan?.(body.planId);
      }
      void queryClient.invalidateQueries({ queryKey: ["/api/repurposing/plans"] });
    },
  });

  const plan = planQuery.data;
  const progress = plan?.progress;

  function toggle(preset: (typeof PRESETS)[number]) {
    const key = pairKey(preset.channel, preset.format);
    setSelected((current) => {
      const next = { ...current };
      if ((next[key] ?? 0) > 0) next[key] = 0;
      else next[key] = preset.count;
      return next;
    });
  }

  return (
    <Card data-testid="panel-repurposing">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Create content from this Story</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <label className="block space-y-1">
          <span className="text-muted-foreground">Story id</span>
          <Input
            value={storyInput}
            onChange={(e) => setStoryInput(e.target.value)}
            data-testid="input-repurpose-story-id"
          />
        </label>
        <div className="space-y-2" data-testid="list-repurpose-targets">
          {registered.map((preset) => {
            const key = pairKey(preset.channel, preset.format);
            const count = selected[key] ?? 0;
            return (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={count > 0}
                  onChange={() => toggle(preset)}
                  data-testid={`checkbox-repurpose-${preset.channel}-${preset.format}`}
                />
                <span className="flex-1">{preset.label}</span>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={count}
                  onChange={(e) =>
                    setSelected((current) => ({ ...current, [key]: Math.max(0, Number(e.target.value) || 0) }))
                  }
                  className="h-7 w-16"
                  data-testid={`input-repurpose-count-${preset.channel}-${preset.format}`}
                />
              </label>
            );
          })}
        </div>
        <Button
          size="sm"
          onClick={() => createMutation.mutate(false)}
          disabled={createMutation.isPending}
          data-testid="button-repurpose-create"
        >
          Create content
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => createMutation.mutate(true)}
          disabled={createMutation.isPending}
          data-testid="button-repurpose-new-batch"
        >
          New batch
        </Button>
        {createMutation.error && (
          <p className="text-destructive" data-testid="text-repurpose-error">
            {createMutation.error instanceof Error ? createMutation.error.message : "Failed"}
          </p>
        )}
        {plan && (
          <div className="space-y-1" data-testid="panel-repurpose-plan">
            <p data-testid="text-repurpose-status">
              Plan {plan.id} <Badge variant="secondary">{plan.status}</Badge>
            </p>
            {progress && (
              <p data-testid="text-repurpose-progress">
                {progress.opportunitiesCreated + progress.opportunitiesReused} / {progress.targets} opportunities
                · {progress.jobsSucceeded} generated
                · {progress.jobsQueued} awaiting
                · {progress.jobsFailed + progress.invalid} failed
              </p>
            )}
            <div data-testid="list-repurpose-outcomes" className="space-y-1">
              {plan.outcomes.map((outcome) => (
                <button
                  key={`${outcome.format}-${outcome.channel}-${outcome.slot}`}
                  type="button"
                  className="block w-full text-left text-muted-foreground"
                  onClick={() => outcome.opportunityId && onOpenArtifact?.(outcome.opportunityId)}
                  data-testid={`card-repurpose-outcome-${outcome.opportunityId ?? `${outcome.format}-${outcome.slot}`}`}
                >
                  {outcome.channel}/{outcome.format} #{outcome.slot} — {outcome.status}
                  {outcome.error ? ` (${outcome.error})` : ""}
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
