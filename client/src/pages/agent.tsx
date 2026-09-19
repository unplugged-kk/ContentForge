import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, Loader2, Play, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { subscribeAgentStream } from "@/lib/agui-stream";
import { ArtifactReviewCard } from "@/components/agent/artifact-review";
import { ErrorState } from "@/components/ui-shared/error-state";
import { StyleIntelligencePanel } from "@/components/agent/style-panel";
import { RepurposePanel } from "@/components/agent/repurpose-panel";
import { ResearchPanel } from "@/components/agent/research-panel";
import { VideoPanel } from "@/components/agent/video-panel";
import { AudioPanel } from "@/components/agent/audio-panel";
import {
  AgentRunCard,
  AudioAssetCard,
  OpportunityCard,
  StoryCard,
  ToolCallCard,
  UntrustedSource,
  VideoAssetCard,
  VisualAssetCard,
} from "@/components/agent/workspace-cards";
import {
  classifyAgentError,
  collectRefs,
  emptyWorkspaceView,
  mapCapabilities,
  reduceAgentEvents,
  type AgentUiEvent,
  type AgentWorkspaceView,
} from "@shared/agent-ui";

type RuntimeResponse = {
  available: boolean;
  streaming?: boolean;
  backend: { id: string; configuredId: string; model: string; hasBaseUrl: boolean; hasAguiUrl: boolean };
  availableBackends: Array<{ id: string; available: boolean }>;
};

type RunRecord = {
  id: number;
  objective: string;
  status: string;
  backendId: string;
  currentStep: number;
  createdAt: string;
  finishedAt: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  toolCalls?: Array<{
    id: number;
    toolName: string;
    status: string;
    result: Record<string, unknown> | null;
    resourceRefs: Record<string, unknown> | null;
    errorClass: string | null;
    errorMessage: string | null;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function readJson(path: string): Promise<unknown> {
  const res = await apiRequest("GET", path);
  return res.json();
}

export default function AgentWorkspacePage() {
  return <AgentWorkspaceInner />;
}

function AgentWorkspaceInner() {
  const { toast } = useToast();
  const [composer, setComposer] = useState("Research the latest developments around AI agents and prepare an X post.");
  const [backendId, setBackendId] = useState<string>("");
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [view, setView] = useState<AgentWorkspaceView>(emptyWorkspaceView());
  const [selectedArtifactId, setSelectedArtifactId] = useState<number | null>(null);
  const [story, setStory] = useState<Record<string, unknown> | null>(null);
  const [opportunities, setOpportunities] = useState<Record<string, unknown>[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [researchJobId, setResearchJobId] = useState<number | null>(null);
  const [visual, setVisual] = useState<Record<string, unknown> | null>(null);
  const [video, setVideo] = useState<Record<string, unknown> | null>(null);
  const [audio, setAudio] = useState<Record<string, unknown> | null>(null);
  const [videoGenerationId, setVideoGenerationId] = useState<number | null>(null);
  const [untrusted, setUntrusted] = useState<string>("");
  const eventsRef = useRef<AgentUiEvent[]>([]);
  const pumpLock = useRef(false);

  const runtimeQuery = useQuery<RuntimeResponse>({ queryKey: ["/api/agent/runtime"] });
  const toolsQuery = useQuery<{ tools: Array<{ name: string; access?: string; requiresApproval?: boolean; capabilityStatus?: string }> }>({
    queryKey: ["/api/agent/tools"],
  });
  const runsQuery = useQuery<{ runs: RunRecord[] }>({ queryKey: ["/api/agent/runs"] });

  const availableBackends = (runtimeQuery.data?.availableBackends ?? []).filter((row) => row.available);
  useEffect(() => {
    if (!backendId && runtimeQuery.data?.backend.id) setBackendId(runtimeQuery.data.backend.id);
  }, [backendId, runtimeQuery.data?.backend.id]);

  const capabilities = useMemo(() => mapCapabilities(toolsQuery.data?.tools ?? []), [toolsQuery.data?.tools]);

  const applyEvents = (events: AgentUiEvent[]) => {
    eventsRef.current = events;
    setView(reduceAgentEvents(events));
  };

  const hydrateRun = async (runId: number) => {
    const payload = (await readJson(`/api/agent/runs/${runId}/events`)) as { events: AgentUiEvent[] };
    applyEvents(payload.events ?? []);
    const detail = (await readJson(`/api/agent/runs/${runId}`)) as RunRecord;
    await hydrateDomain(detail);
    return detail;
  };

  const hydrateDomain = async (detail: RunRecord) => {
    const refs = collectRefs(detail.toolCalls ?? []);
    const storyId = Number(refs.storyId);
    const researchJobId = Number(refs.researchJobId);
    const artifactId = Number(refs.artifactId);
    const visualId = Number(refs.visualAssetId);
    const videoId = Number(refs.videoAssetId);
    const audioId = Number(refs.audioAssetId);
    const nextVideoGenerationId = Number(refs.videoGenerationId);
    const nextPlanId = Number(refs.planId);
    if (nextPlanId > 0) setPlanId(nextPlanId);
    if (researchJobId > 0) setResearchJobId(researchJobId);
    if (storyId > 0) {
      try {
        setStory(asRecord(await readJson(`/api/stories/${storyId}`)));
        const opps = await readJson(`/api/opportunities?storyId=${storyId}`);
        if (Array.isArray(opps)) setOpportunities(opps.map(asRecord));
      } catch {
        setStory(null);
      }
    }
    if (researchJobId > 0) {
      try {
        const evidence = await readJson(`/api/research/jobs/${researchJobId}/evidence`);
        if (Array.isArray(evidence) && evidence[0] && typeof (evidence[0] as { excerpt?: string }).excerpt === "string") {
          setUntrusted(String((evidence[0] as { excerpt: string }).excerpt));
        }
      } catch {
        setUntrusted("");
      }
    }
    if (artifactId > 0) setSelectedArtifactId(artifactId);
    if (visualId > 0) {
      try {
        setVisual(asRecord(await readJson(`/api/visual-assets/${visualId}`)));
      } catch {
        setVisual({ id: visualId });
      }
    }
    if (videoId > 0) setVideo({ id: videoId });
    if (audioId > 0) {
      try {
        setAudio(asRecord(await readJson(`/api/audio/assets/${audioId}`)));
      } catch {
        setAudio({ id: audioId });
      }
    }
    if (nextVideoGenerationId > 0) setVideoGenerationId(nextVideoGenerationId);
    const oppIds = Array.isArray(refs.opportunityIds) ? refs.opportunityIds : [];
    if (oppIds.length > 0 && opportunities.length === 0) {
      setOpportunities(oppIds.map((id) => ({ id })));
    }
  };

  const waitForResearch = async (researchJobId: number) => {
    for (let i = 0; i < 90; i += 1) {
      const job = asRecord(await readJson(`/api/research/jobs/${researchJobId}`));
      if (job.status === "complete" || job.status === "completed" || job.status === "failed") return job;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("research did not complete");
  };

  const pumpWorkspace = async (runId: number) => {
    if (pumpLock.current) return;
    pumpLock.current = true;
    try {
      for (let step = 0; step < 12; step += 1) {
        const detail = (await readJson(`/api/agent/runs/${runId}`)) as RunRecord;
        await hydrateDomain(detail);
        const refs = collectRefs(detail.toolCalls ?? []);
        const researchJobId = Number(refs.researchJobId);
        const last = detail.toolCalls?.[detail.toolCalls.length - 1];
        const lastStatus = typeof last?.result?.status === "string" ? last.result.status : "";
        if (researchJobId > 0 && (lastStatus === "queued" || lastStatus === "in_progress")) {
          await waitForResearch(researchJobId);
        }
        const continued = await apiRequest("POST", `/api/agent/runs/${runId}/continue`, {});
        const body = (await continued.json()) as { done?: boolean; result?: { status?: string; error?: string } };
        const events = (await readJson(`/api/agent/runs/${runId}/events`)) as { events: AgentUiEvent[] };
        applyEvents(events.events ?? []);
        if (body.result?.status === "conflict" && /not complete/i.test(body.result.error ?? "")) {
          if (researchJobId > 0) await waitForResearch(researchJobId);
          continue;
        }
        if (body.done) break;
      }
      await hydrateRun(runId);
    } finally {
      pumpLock.current = false;
    }
  };

  useEffect(() => {
    if (!selectedRunId) return;
    let stop = () => {};
    void (async () => {
      try {
        await hydrateRun(selectedRunId);
        stop = subscribeAgentStream(
          selectedRunId,
          (event) => applyEvents([...eventsRef.current, event]),
          () => {
            void hydrateRun(selectedRunId);
          },
        );
        if ((backendId || runtimeQuery.data?.backend.id) === "fixture") {
          void pumpWorkspace(selectedRunId);
        }
      } catch (error) {
        const classified = classifyAgentError({ message: error instanceof Error ? error.message : String(error) });
        toast({ title: classified.class, description: classified.message, variant: "destructive" });
      }
    })();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunId]);

  const startMutation = useMutation({
    mutationFn: async () => {
      const key = `workspace:${composer.slice(0, 80)}:${Date.now()}`;
      const res = await apiRequest("POST", "/api/agent/runs", {
        objective: composer,
        compilePlan: true,
        execute: true,
        backendId: backendId || undefined,
        idempotencyKey: key,
      });
      return res.json() as Promise<RunRecord>;
    },
    onSuccess: (run) => {
      setSelectedRunId(run.id);
      void queryClient.invalidateQueries({ queryKey: ["/api/agent/runs"] });
    },
    onError: (err: Error) => {
      const classified = classifyAgentError({ message: err.message });
      toast({ title: classified.class, description: classified.message, variant: "destructive" });
    },
  });

  const retryContinue = () => {
    if (selectedRunId) void pumpWorkspace(selectedRunId);
  };

  const resumeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRunId) throw new Error("no active run");
      const res = await apiRequest("POST", `/api/agent/runs/${selectedRunId}/resume`, {});
      return res.json();
    },
    onSuccess: () => {
      if (selectedRunId) void hydrateRun(selectedRunId);
    },
    onError: (err: Error) => {
      const classified = classifyAgentError({ message: err.message });
      toast({ title: classified.class, description: classified.message, variant: "destructive" });
    },
  });

  return (
    <div className="h-full overflow-hidden bg-background" data-testid="page-agent-workspace">
      <div className="grid h-full grid-cols-1 lg:grid-cols-[18rem_1fr_24rem]">
        <aside className="border-r p-3 space-y-3 overflow-y-auto">
          <div>
            <h1 className="text-sm font-semibold" data-testid="text-agent-workspace-title">Agent Workspace</h1>
            <p className="text-[11px] text-muted-foreground">AG-UI over ContentForge Agent Runtime</p>
          </div>
          <div className="space-y-1" data-testid="panel-agent-backends">
            <p className="text-[11px] font-medium">Backend</p>
            <Select value={backendId} onValueChange={setBackendId}>
              <SelectTrigger aria-label="Agent backend" data-testid="select-agent-backend">
                <SelectValue placeholder="Select backend" />
              </SelectTrigger>
              <SelectContent>
                {availableBackends.map((row) => (
                  <SelectItem key={row.id} value={row.id}>{row.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1" data-testid="panel-agent-capabilities">
            <p className="text-[11px] font-medium">Capabilities</p>
            {capabilities.map((row) => (
              <div key={row.group} className="flex items-center justify-between text-[11px]">
                <span>{row.group}</span>
                <span className="text-muted-foreground">
                  {row.approvalRequired ? "approval required" : row.available ? "available" : "unavailable"}
                </span>
              </div>
            ))}
          </div>
          <div className="space-y-2" data-testid="list-agent-runs">
            <p className="text-[11px] font-medium">Run history</p>
            {runsQuery.isError ? (
              <ErrorState
                title="Couldn't load run history"
                description="Something went wrong while loading your agent runs."
                onRetry={() => runsQuery.refetch()}
              />
            ) : (
              <>
                {(runsQuery.data?.runs ?? []).map((run) => (
                  <AgentRunCard
                    key={run.id}
                    run={run}
                    active={run.id === selectedRunId}
                    onOpen={setSelectedRunId}
                  />
                ))}
                {runsQuery.data?.runs?.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">No runs yet.</p>
                )}
              </>
            )}
          </div>
        </aside>

        <section className="flex flex-col min-w-0">
          <div className="border-b p-3 space-y-2">
            <Label htmlFor="agent-composer" className="sr-only">Agent objective</Label>
            <Textarea
              id="agent-composer"
              aria-label="Agent objective"
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              className="min-h-[88px]"
              data-testid="textarea-agent-composer"
            />
            <div className="flex gap-2">
              <Button onClick={() => startMutation.mutate()} disabled={startMutation.isPending || !composer.trim()} data-testid="button-agent-start">
                {startMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
                Start run
              </Button>
              <Button variant="outline" onClick={retryContinue} disabled={!selectedRunId} data-testid="button-agent-retry">
                <RefreshCw className="h-4 w-4 mr-1" />Retry continue
              </Button>
            </div>
          </div>
          <ScrollArea className="flex-1 p-3">
            <div className="space-y-3">
              <Card data-testid="panel-agent-activity">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Bot className="h-4 w-4" />
                    Agent activity
                    {view.status ? (
                      view.status === "completed_with_errors" ? (
                        <Badge variant="destructive" data-testid="badge-run-status">Completed with errors</Badge>
                      ) : (
                        <Badge variant="secondary" data-testid="badge-run-status">{view.status}</Badge>
                      )
                    ) : null}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-1">
                  {view.activity.length === 0 && <p className="text-muted-foreground">No live activity yet.</p>}
                  {view.activity.map((line, i) => (
                    <p key={`${line}-${i}`}>{line}</p>
                  ))}
                  {view.error && (
                    <div className="text-destructive text-xs" data-testid="text-agent-error">
                      {view.error.class}: {view.error.message}
                      {view.error.retrySafe && (
                        <Button size="sm" variant="outline" className="ml-2" onClick={retryContinue} data-testid="button-error-retry">Retry</Button>
                      )}
                    </div>
                  )}
                  {view.waitingForApproval && (
                    <div className="flex items-center gap-2 text-xs" data-testid="text-auth-required">
                      <p>Privileged action requires explicit user authorization.</p>
                      <Button
                        size="sm"
                        onClick={() => resumeMutation.mutate()}
                        disabled={resumeMutation.isPending}
                        data-testid="button-run-approve"
                      >
                        Approve &amp; continue
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setView((prev) => ({ ...prev, waitingForApproval: false }))}
                        data-testid="button-run-dismiss"
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
              {view.toolCalls.map((call) => (
                <ToolCallCard
                  key={call.id}
                  call={call}
                  onOpen={(kind, id) => {
                    if (kind === "artifact") setSelectedArtifactId(id);
                  }}
                />
              ))}
              {story && <StoryCard story={story} />}
              {opportunities.map((opp) => (
                <OpportunityCard key={String(opp.id)} opportunity={opp} />
              ))}
              {visual && <VisualAssetCard asset={visual} />}
              {video && <VideoAssetCard asset={video} />}
              {audio && <AudioAssetCard asset={audio} />}
              {untrusted && <UntrustedSource text={untrusted} />}
            </div>
          </ScrollArea>
        </section>

        <aside className="border-l p-3 overflow-y-auto space-y-3">
          <ResearchPanel jobId={researchJobId} onJob={setResearchJobId} />
          <VideoPanel generationId={videoGenerationId} onGeneration={setVideoGenerationId} />
          <AudioPanel />
          <RepurposePanel
            storyId={typeof story?.id === "number" ? story.id : Number(story?.id) || null}
            planId={planId}
            onPlan={setPlanId}
            onOpenArtifact={async (opportunityId) => {
              try {
                const rows = (await readJson(`/api/opportunities/${opportunityId}/artifacts`)) as Array<{ id: number }>;
                if (Array.isArray(rows) && rows[0]?.id) setSelectedArtifactId(rows[0].id);
              } catch {
                /* opportunity may not have an artifact yet */
              }
            }}
          />
          <StyleIntelligencePanel />
          <h2 className="text-sm font-semibold mb-2">Artifact review</h2>
          {selectedArtifactId ? (
            <ArtifactReviewCard artifactId={selectedArtifactId} />
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="text-artifact-empty">No artifact selected.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
