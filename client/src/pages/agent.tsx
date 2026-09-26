import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Layers,
  FileText,
  Lightbulb,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { subscribeAgentStream } from "@/lib/agui-stream";
import { PageHeader } from "@/components/ui-shared/page-header";
import { ErrorState } from "@/components/ui-shared/error-state";
import { StatusBadge } from "@/components/ui-shared/status-badge";
import {
  deriveRunDisplayStatus,
  deriveRunOutcomeSummary,
  formatRelativeTime,
  humanizeToolName,
} from "@/lib/agent-workspace-state";
import { ArtifactReviewCard } from "@/components/agent/artifact-review";
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
  type ToolCallView,
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

const STARTER_PROMPTS = [
  {
    label: "Research & Draft X Post",
    prompt: "Research the latest developments around AI agents and prepare an X post.",
  },
  {
    label: "Repurpose Top Story",
    prompt: "Repurpose our latest top-performing story across LinkedIn and X.",
  },
  {
    label: "Synthesize Trends",
    prompt: "Synthesize current industry trends into three high-impact content opportunities.",
  },
];

export default function AgentWorkspacePage() {
  return <AgentWorkspaceInner />;
}

function AgentWorkspaceInner() {
  const { toast } = useToast();
  const [composer, setComposer] = useState("Research the latest developments around AI agents and prepare an X post.");
  const [backendId, setBackendId] = useState<string>("");
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [runDetail, setRunDetail] = useState<RunRecord | null>(null);
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
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  // Local, non-status-affecting collapse of the approval callout. It must never
  // touch `view.waitingForApproval`, which feeds deriveRunDisplayStatus (F1(a)).
  const [approvalHidden, setApprovalHidden] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);

  const eventsRef = useRef<AgentUiEvent[]>([]);
  const pumpLock = useRef(false);

  const runtimeQuery = useQuery<RuntimeResponse>({ queryKey: ["/api/agent/runtime"] });
  const toolsQuery = useQuery<{
    tools: Array<{ name: string; access?: string; requiresApproval?: boolean; capabilityStatus?: string }>;
  }>({
    queryKey: ["/api/agent/tools"],
  });
  const runsQuery = useQuery<{ runs: RunRecord[] }>({ queryKey: ["/api/agent/runs"] });

  const availableBackends = (runtimeQuery.data?.availableBackends ?? []).filter((row) => row.available);

  useEffect(() => {
    if (!backendId && runtimeQuery.data?.backend.id) setBackendId(runtimeQuery.data.backend.id);
  }, [backendId, runtimeQuery.data?.backend.id]);

  // Restore run from URL params (?runId=123, ?prompt=…) on initial load.
  // `getAskAgentUrl` (lib/insights-state.ts) emits ?prompt=; without this the
  // handoff from Insights landed on the hardcoded default objective (W-E patch).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const runParam = params.get("runId");
    if (runParam && !Number.isNaN(Number(runParam))) {
      setSelectedRunId(Number(runParam));
    }
    const promptParam = params.get("prompt");
    if (promptParam && promptParam.trim()) {
      setComposer(promptParam);
    }
  }, []);

  const selectRun = (id: number | null) => {
    setSelectedRunId(id);
    setApprovalHidden(false);
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set("runId", String(id));
    } else {
      url.searchParams.delete("runId");
    }
    window.history.replaceState(null, "", url.toString());
  };

  const capabilities = useMemo(() => mapCapabilities(toolsQuery.data?.tools ?? []), [toolsQuery.data?.tools]);

  const applyEvents = (events: AgentUiEvent[]) => {
    eventsRef.current = events;
    setView(reduceAgentEvents(events));
  };

  const hydrateRun = async (runId: number) => {
    const payload = (await readJson(`/api/agent/runs/${runId}/events`)) as { events: AgentUiEvent[] };
    applyEvents(payload.events ?? []);
    const detail = (await readJson(`/api/agent/runs/${runId}`)) as RunRecord;
    setRunDetail(detail);
    await hydrateDomain(detail);
    return detail;
  };

  const hydrateDomain = async (detail: RunRecord) => {
    const refs = collectRefs(detail.toolCalls ?? []);
    const storyId = Number(refs.storyId);
    const nextResearchJobId = Number(refs.researchJobId);
    const artifactId = Number(refs.artifactId);
    const visualId = Number(refs.visualAssetId);
    const videoId = Number(refs.videoAssetId);
    const audioId = Number(refs.audioAssetId);
    const nextVideoGenerationId = Number(refs.videoGenerationId);
    const nextPlanId = Number(refs.planId);
    if (nextPlanId > 0) setPlanId(nextPlanId);
    if (nextResearchJobId > 0) setResearchJobId(nextResearchJobId);
    if (storyId > 0) {
      try {
        setStory(asRecord(await readJson(`/api/stories/${storyId}`)));
        const opps = await readJson(`/api/opportunities?storyId=${storyId}`);
        if (Array.isArray(opps)) setOpportunities(opps.map(asRecord));
      } catch {
        setStory(null);
      }
    }
    if (nextResearchJobId > 0) {
      try {
        const evidence = await readJson(`/api/research/jobs/${nextResearchJobId}/evidence`);
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

  const waitForResearch = async (jobId: number) => {
    for (let i = 0; i < 90; i += 1) {
      const job = asRecord(await readJson(`/api/research/jobs/${jobId}`));
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
        setRunDetail(detail);
        await hydrateDomain(detail);
        const refs = collectRefs(detail.toolCalls ?? []);
        const nextJobId = Number(refs.researchJobId);
        const last = detail.toolCalls?.[detail.toolCalls.length - 1];
        const lastStatus = typeof last?.result?.status === "string" ? last.result.status : "";
        if (nextJobId > 0 && (lastStatus === "queued" || lastStatus === "in_progress")) {
          await waitForResearch(nextJobId);
        }
        const continued = await apiRequest("POST", `/api/agent/runs/${runId}/continue`, {});
        const body = (await continued.json()) as { done?: boolean; result?: { status?: string; error?: string } };
        const events = (await readJson(`/api/agent/runs/${runId}/events`)) as { events: AgentUiEvent[] };
        applyEvents(events.events ?? []);
        if (body.result?.status === "conflict" && /not complete/i.test(body.result.error ?? "")) {
          if (nextJobId > 0) await waitForResearch(nextJobId);
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
      selectRun(run.id);
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

  // Active run resolution
  const activeRun = useMemo(() => {
    if (runDetail) return runDetail;
    return runsQuery.data?.runs?.find((r) => r.id === selectedRunId) ?? null;
  }, [runDetail, runsQuery.data?.runs, selectedRunId]);

  // Truthful status derivation
  const displayStatus = useMemo(() => {
    return deriveRunDisplayStatus({
      rawStatus: activeRun?.status ?? view.status,
      toolCalls: activeRun?.toolCalls ?? view.toolCalls,
      waitingForApproval: view.waitingForApproval,
    });
  }, [activeRun?.status, activeRun?.toolCalls, view.status, view.toolCalls, view.waitingForApproval]);

  // Structured outcome summary
  const outcomeSummary = useMemo(() => {
    return deriveRunOutcomeSummary({
      status: displayStatus,
      toolCalls: activeRun?.toolCalls ?? view.toolCalls,
      story,
      opportunities,
      artifactsCount: selectedArtifactId ? 1 : 0,
    });
  }, [displayStatus, activeRun?.toolCalls, view.toolCalls, story, opportunities, selectedArtifactId]);

  // Normalization of displayed tool calls for the timeline
  const displayedToolCalls: ToolCallView[] = useMemo(() => {
    if (view.toolCalls.length > 0) return view.toolCalls;
    if (!activeRun?.toolCalls) return [];
    return activeRun.toolCalls.map((tc) => ({
      id: String(tc.id),
      name: tc.toolName,
      status: tc.status,
      summary: humanizeToolName(tc.toolName).title,
      renderer: tc.toolName as any,
      arguments: {},
      refs: tc.resourceRefs ?? {},
      errorClass: tc.errorClass ?? null,
      errorMessage: tc.errorMessage ?? null,
      result: tc.result ? { data: tc.result } : null,
    }));
  }, [view.toolCalls, activeRun?.toolCalls]);

  const handleOpenArtifact = (artifactId: number) => {
    setSelectedArtifactId(artifactId);
  };

  const handleOpenResearch = (jobId: number) => {
    setResearchJobId(jobId);
    setDiagnosticsOpen(true);
  };

  return (
    <div className="min-h-full bg-background flex flex-col" data-testid="page-agent-workspace">
      {/* Canonical PageHeader */}
      <PageHeader
        title="Agent"
        testId="page-header-agent"
        titleTestId="text-agent-workspace-title"
        description="Orchestrate research, cross-channel drafting, and publication workflows"
        action={
          <div className="flex items-center gap-2">
            {/* Backend Selector */}
            <div className="flex items-center gap-1.5" data-testid="panel-agent-backends">
              <span className="text-xs text-muted-foreground hidden sm:inline">Backend:</span>
              <Select value={backendId} onValueChange={setBackendId}>
                <SelectTrigger
                  className="h-8 w-[130px] sm:w-[150px] text-xs"
                  aria-label="Agent backend"
                  data-testid="select-agent-backend"
                >
                  <SelectValue placeholder="Select backend" />
                </SelectTrigger>
                <SelectContent>
                  {availableBackends.map((row) => (
                    <SelectItem key={row.id} value={row.id} className="text-xs">
                      {row.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Diagnostics Drawer Trigger */}
            <Sheet open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2.5 text-xs gap-1.5"
                  data-testid="button-open-diagnostics"
                  aria-label="Open technical diagnostics"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Diagnostics</span>
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="w-full sm:max-w-lg overflow-y-auto space-y-4"
                data-testid="drawer-technical-details"
              >
                <SheetHeader>
                  <SheetTitle>Technical Diagnostics & Subsystems</SheetTitle>
                  <SheetDescription>
                    Direct engine controls, research evidence, and generation pipelines.
                  </SheetDescription>
                </SheetHeader>
                <div className="space-y-4 pt-2">
                  {activeRun && (
                    <div
                      className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs"
                      data-testid="panel-run-identity"
                    >
                      <p className="font-medium">Run #{activeRun.id}</p>
                      <p className="text-muted-foreground">Backend: {activeRun.backendId}</p>
                      <p className="text-muted-foreground">Status: {displayStatus}</p>
                      <p className="text-muted-foreground">Started: {formatRelativeTime(activeRun.createdAt)}</p>
                    </div>
                  )}
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
                </div>
              </SheetContent>
            </Sheet>

            {/* Mobile Run History Drawer Trigger */}
            <Sheet open={mobileHistoryOpen} onOpenChange={setMobileHistoryOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="lg:hidden h-8 px-2.5 text-xs gap-1.5"
                  data-testid="button-open-mobile-history"
                  aria-label="Open run history"
                >
                  <History className="h-3.5 w-3.5" />
                  <span className="hidden xs:inline">Runs</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-full sm:max-w-xs overflow-y-auto space-y-4" data-testid="sheet-mobile-history">
                <SheetHeader>
                  <SheetTitle>Run History</SheetTitle>
                  <SheetDescription>Select a run to inspect its timeline and outputs.</SheetDescription>
                </SheetHeader>
                <div className="space-y-2 pt-2">
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
                          onOpen={(id) => {
                            selectRun(id);
                            setMobileHistoryOpen(false);
                          }}
                        />
                      ))}
                      {runsQuery.data?.runs?.length === 0 && (
                        <p className="text-xs text-muted-foreground">No runs yet.</p>
                      )}
                    </>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        }
      />

      {/* Main Responsive Grid: 2-Column on Desktop (>=lg), 1-Column Single Vertical Scroll on Mobile */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_20rem] xl:grid-cols-[1fr_22rem]">
        {/* Primary Orchestration Column */}
        <div className="flex flex-col min-w-0 p-4 sm:p-6 space-y-6 max-w-4xl mx-auto w-full">
          {/* Section 1: Composer Card */}
          <Card className="border-border shadow-sm">
            <CardContent className="p-4 sm:p-5 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="agent-composer" className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Agent Objective
                </Label>
                <Textarea
                  id="agent-composer"
                  aria-label="Agent objective"
                  placeholder="Ask ContentForge… e.g. Research latest developments in AI agents and draft an X post."
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  className="min-h-[84px] resize-y text-sm focus-visible:ring-1"
                  data-testid="textarea-agent-composer"
                />
              </div>

              {/* Starter Quick Actions & Execution CTAs */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground mr-1 hidden md:inline">Starters:</span>
                  {STARTER_PROMPTS.map((item) => (
                    <Button
                      key={item.label}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs font-normal bg-background"
                      onClick={() => setComposer(item.prompt)}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    onClick={() => startMutation.mutate()}
                    disabled={startMutation.isPending || !composer.trim()}
                    data-testid="button-agent-start"
                    size="sm"
                    className="h-8 gap-1.5"
                  >
                    {startMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    Start run
                  </Button>
                  <Button
                    variant="outline"
                    onClick={retryContinue}
                    disabled={!selectedRunId}
                    data-testid="button-agent-retry"
                    size="sm"
                    className="h-8 gap-1.5"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry continue
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Section 2: Active Run Header & Truthful Status Summary */}
          {activeRun ? (
            <div
              className="rounded-lg border bg-card p-4 space-y-3 shadow-sm"
              data-testid="panel-active-run-summary"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Run #{activeRun.id}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(activeRun.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-foreground line-clamp-2">
                    {activeRun.objective}
                  </p>
                </div>

                <div className="shrink-0">
                  <StatusBadge status={displayStatus} testId="badge-run-status" />
                </div>
              </div>

              {/* Structured Outcome Pills */}
              <div
                className="flex flex-wrap items-center gap-2 pt-1 border-t text-xs"
                data-testid="panel-run-outcome-summary"
              >
                <span className="text-muted-foreground font-medium">Output:</span>
                <Badge variant="outline" className="text-xs font-normal">
                  <FileText className="h-3 w-3 mr-1 text-muted-foreground" />
                  {outcomeSummary.storiesCreated} Stories
                </Badge>
                <Badge variant="outline" className="text-xs font-normal">
                  <Lightbulb className="h-3 w-3 mr-1 text-muted-foreground" />
                  {outcomeSummary.opportunitiesCreated} Opportunities
                </Badge>
                <Badge variant="outline" className="text-xs font-normal">
                  <Layers className="h-3 w-3 mr-1 text-muted-foreground" />
                  {outcomeSummary.artifactsCreated} Artifacts
                </Badge>
                {outcomeSummary.warningCount > 0 && (
                  <Badge variant="destructive" className="text-xs" data-testid="badge-run-warnings">
                    {outcomeSummary.warningCount} Warnings
                  </Badge>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
              <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm font-medium">Ready to Orchestrate</p>
              <p className="text-xs mt-1">
                Enter an objective above or choose a starter prompt to launch an agent run.
              </p>
            </div>
          )}

          {/* Section 3: Human Approval Callout — the decision, and always truthful (F1(a), F1(c)) */}
          {(view.waitingForApproval || displayStatus === "waiting_for_approval") && !approvalHidden && (
            <div
              className="rounded-lg border border-warning/30 bg-warning/10 p-4 space-y-3"
              data-testid="panel-auth-callout"
            >
              <div className="flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-warning mt-0.5 shrink-0" />
                <div className="space-y-1 min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-warning">
                    Authorization Required
                  </h3>
                  <p className="text-xs text-foreground" data-testid="text-auth-required">
                    Privileged action requires explicit user authorization.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={() => resumeMutation.mutate()}
                  disabled={resumeMutation.isPending}
                  data-testid="button-run-approve"
                  className="h-8"
                >
                  {resumeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  Approve &amp; continue
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setApprovalHidden(true)}
                  data-testid="button-run-hide-approval"
                  className="h-8"
                >
                  Hide request
                </Button>
              </div>
            </div>
          )}

          {/* When the callout is hidden the run status is NOT changed — the badge
              still reads "Waiting for approval" and approval stays reachable. */}
          {(view.waitingForApproval || displayStatus === "waiting_for_approval") && approvalHidden && (
            <div
              className="rounded-lg border bg-card p-3 flex flex-wrap items-center justify-between gap-2"
              data-testid="banner-approval-hidden"
            >
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge status="waiting_for_approval" />
                This run is still waiting for authorization — nothing was approved.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => setApprovalHidden(false)}
                data-testid="button-run-show-approval"
              >
                Show request
              </Button>
            </div>
          )}

          {/* Section 4: Generated Artifacts & Review — the decision, above the execution detail (F1(c)) */}
          <section className="space-y-4 pt-2">
            <div className="flex items-center justify-between border-b pb-2">
              <h2 className="text-base font-semibold tracking-tight">Generated Artifacts &amp; Results</h2>
              {selectedArtifactId ? (
                <Badge variant="outline" className="text-xs font-normal">
                  Artifact #{selectedArtifactId} Selected
                </Badge>
              ) : null}
            </div>

            {selectedArtifactId ? (
              <ArtifactReviewCard artifactId={selectedArtifactId} />
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                <p className="text-sm" data-testid="text-artifact-empty">
                  No artifact selected.
                </p>
                <p className="text-xs mt-1">
                  When the agent synthesizes an artifact, review, schedule, and publishing options will appear here.
                </p>
              </div>
            )}

            {/* Generated domain entities */}
            {story && <StoryCard story={story} />}
            {opportunities.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Ideas ({opportunities.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {opportunities.map((opp) => (
                    <OpportunityCard key={String(opp.id)} opportunity={opp} />
                  ))}
                </div>
              </div>
            )}
            {visual && <VisualAssetCard asset={visual} />}
            {video && <VideoAssetCard asset={video} />}
            {audio && <AudioAssetCard asset={audio} />}
            {untrusted && <UntrustedSource text={untrusted} />}
          </section>

          {/* Section 5: Repurpose Progress (if active plan running) */}
          {planId && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold tracking-tight">Active Repurposing Plan</h3>
              <RepurposePanel
                storyId={typeof story?.id === "number" ? story.id : Number(story?.id) || null}
                planId={planId}
                onPlan={setPlanId}
                onOpenArtifact={handleOpenArtifact}
              />
            </div>
          )}

          {/* Section 6: Execution Timeline & Activity Feed — technical detail, below the decision (F1(c)) */}
          <Card data-testid="panel-agent-activity" className="border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  Execution Timeline
                </CardTitle>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1"
                  onClick={() => setTimelineOpen((prev) => !prev)}
                  aria-expanded={timelineOpen}
                  data-testid="button-toggle-execution-steps"
                >
                  {timelineOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {timelineOpen ? "Hide steps" : "Show steps"}
                </Button>
              </div>
            </CardHeader>
            {timelineOpen && (
              <CardContent className="space-y-3 text-sm">
                {view.error && (
                  <div
                    className="text-destructive text-xs border border-destructive/20 bg-destructive/5 rounded-md p-3 flex items-start justify-between gap-2"
                    data-testid="text-agent-error"
                  >
                    <div>
                      <span className="font-semibold">{view.error.class}:</span> {view.error.message}
                    </div>
                    {view.error.retrySafe && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs px-2 shrink-0"
                        onClick={retryContinue}
                        data-testid="button-error-retry"
                      >
                        Retry
                      </Button>
                    )}
                  </div>
                )}

                {displayedToolCalls.length === 0 && view.activity.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">
                    No execution steps recorded yet. Start a run above to watch the agent work.
                  </p>
                )}

                {/* Tool Calls List */}
                <div className="space-y-2">
                  {displayedToolCalls.map((call) => (
                    <ToolCallCard
                      key={call.id}
                      call={call}
                      onOpen={(kind, id) => {
                        if (kind === "artifact") handleOpenArtifact(id);
                        if (kind === "research") handleOpenResearch(id);
                      }}
                    />
                  ))}
                </div>

                {/* Compact Raw AG-UI Events Log */}
                {view.activity.length > 0 && (
                  <details className="mt-2 text-xs text-muted-foreground border-t pt-2">
                    <summary className="cursor-pointer font-mono hover:text-foreground">
                      Raw event stream ({view.activity.length} events)
                    </summary>
                    <div className="mt-2 font-mono bg-muted/30 p-2.5 rounded max-h-36 overflow-y-auto space-y-1 text-xs">
                      {view.activity.map((line, i) => (
                        <p key={`${line}-${i}`}>{line}</p>
                      ))}
                    </div>
                  </details>
                )}
              </CardContent>
            )}
          </Card>
        </div>

        {/* Secondary Desktop Sidebar (>=lg): Capabilities & Run History */}
        <aside className="hidden lg:flex flex-col border-l bg-muted/10 p-4 space-y-6 overflow-y-auto">
          {/* Capabilities Summary */}
          <div className="space-y-2" data-testid="panel-agent-capabilities">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Capabilities
              </p>
              {!toolsQuery.isError && (
                <Badge variant="outline" className="text-xs">
                  {capabilities.filter((c) => c.available).length}/{capabilities.length} Active
                </Badge>
              )}
            </div>
            {toolsQuery.isError ? (
              <ErrorState
                title="Couldn't load capabilities"
                description="Something went wrong while loading what the agent can do."
                onRetry={() => toolsQuery.refetch()}
              />
            ) : (
              <div className="space-y-1.5 rounded-md border bg-card p-2.5">
                {capabilities.map((row) => (
                  <div key={row.group} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{row.group}</span>
                    <span
                      className={`text-xs ${
                        row.approvalRequired
                          ? "text-warning font-medium"
                          : row.available
                          ? "text-success"
                          : "text-muted-foreground"
                      }`}
                    >
                      {row.approvalRequired ? "approval req." : row.available ? "available" : "unavailable"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Desktop Run History */}
          <div className="space-y-2 flex-1 min-h-0 flex flex-col" data-testid="list-agent-runs">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Run History
              </p>
              {runsQuery.data?.runs?.length ? (
                <span className="text-xs text-muted-foreground">
                  {runsQuery.data.runs.length} total
                </span>
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
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
                      onOpen={selectRun}
                    />
                  ))}
                  {runsQuery.data?.runs?.length === 0 && (
                    <div className="rounded-md border border-dashed p-4 text-center">
                      <p className="text-xs text-muted-foreground">No runs yet.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
