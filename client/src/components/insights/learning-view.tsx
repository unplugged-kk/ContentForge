import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui-shared/error-state";
import { EmptyState } from "@/components/ui-shared/empty-state";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  formatMetricValue,
  formatMetricRate,
  humanizeConfidence,
  formatEvidenceQuality,
  formatStyleProvenance,
  formatChannelName,
  formatContentType,
  getAskAgentUrl,
  type MetricTotal,
} from "@/lib/insights-state";
import {
  Sparkles,
  Layers,
  BarChart2,
  Bot,
  Compass,
  PenTool,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  RefreshCw,
  ShieldCheck,
  Eye,
  BookOpen,
} from "lucide-react";

interface StyleProfileItem {
  id: number;
  name: string;
  confidence: string | null;
  sampleCount: number | null;
  isActive: boolean;
  channel: string | null;
  structuredObservation?: Record<string, any> | null;
  stylePromptSnippet?: string | null;
  createdAt: string | null;
}

interface LearningSummaryData {
  publishedCount: number;
  successRate: number | null;
  approvalRate: number | null;
  byChannel: Array<{ channel: string; published: number; observedMetrics: number }>;
  byFormat: Array<{ format: string; published: number }>;
  byStory: Array<{ storyId: number; publications: number }>;
  signalCounts: Record<string, number>;
  metricTotals: MetricTotal[];
}

interface LearningProposalItem {
  id: number;
  userId: number;
  observationId: number | null;
  proposalType: string;
  targetScope: string;
  title: string;
  rationale: string;
  expectedImpactHypothesis: string;
  evidenceQuality: string;
  evidenceSummary: {
    sampleCount?: number;
    candidateValue?: string | number;
    baselineValue?: string | number;
    differencePercentage?: string | number;
    publicationIds?: number[];
    artifactIds?: number[];
    [key: string]: any;
  };
  status: "proposed" | "accepted" | "rejected" | "superseded" | "expired";
  reviewedAt: string | null;
  reviewedBy: number | null;
  reviewNotes: string | null;
  createdAt: string;
}

interface LearningObservationItem {
  id: number;
  userId: number;
  dimension: string;
  observationType: string;
  targetScope: string;
  candidatePopulation: Record<string, any>;
  comparisonPopulation: Record<string, any>;
  metricName: string;
  candidateValue: string | null;
  comparisonValue: string | null;
  differencePercentage: string | null;
  evidenceQuality: string;
  evidenceEntityIds: Record<string, number[]>;
  measurementWindow: string | null;
  createdAt: string;
}

function formatProposalType(type: string): string {
  switch (type) {
    case "format_distribution":
      return "Format & Distribution";
    case "style_association":
      return "Voice & Style";
    case "workflow_reliability":
      return "Workflow Reliability";
    case "cost_efficiency":
      return "Production Efficiency";
    default:
      return type.replace(/_/g, " ");
  }
}

export function LearningView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedEvidence, setExpandedEvidence] = useState<Record<number, boolean>>({});

  // Query 1: Style Profiles (Writing style intelligence)
  const {
    data: styleData,
    isLoading: isStyleLoading,
    error: styleError,
    refetch: refetchStyle,
  } = useQuery<{ profiles: StyleProfileItem[] }>({
    queryKey: ["/api/style/profiles"],
    retry: false,
  });

  // Query 2: Learning Summary (Publication patterns & metric totals)
  const {
    data: learningSummary,
    isLoading: isSummaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useQuery<LearningSummaryData>({
    queryKey: ["/api/learning/summary"],
  });

  // Query 3: Proposals (Phase 29.1 optimization recommendations)
  const {
    data: proposalsData,
    isLoading: isProposalsLoading,
    error: proposalsError,
    refetch: refetchProposals,
  } = useQuery<LearningProposalItem[]>({
    queryKey: ["/api/learning/proposals"],
  });

  // Query 4: Observations (Phase 29.1 empirical pattern inferences)
  const {
    data: observationsData,
    isLoading: isObservationsLoading,
  } = useQuery<LearningObservationItem[]>({
    queryKey: ["/api/learning/observations"],
  });

  // Mutation: Accept proposal (Human action, non-mutating)
  const acceptMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/learning/proposals/${id}/accept`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/learning/proposals"] });
      toast({
        title: "Proposal accepted",
        description: "Recorded in learning history. In Phase 29.1, production generation policies remain unchanged.",
      });
    },
    onError: () => {
      toast({
        title: "Action failed",
        description: "Could not accept the proposal. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Mutation: Dismiss proposal
  const rejectMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/learning/proposals/${id}/reject`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/learning/proposals"] });
      toast({
        title: "Proposal dismissed",
        description: "Proposal marked as dismissed in your learning history.",
      });
    },
    onError: () => {
      toast({
        title: "Action failed",
        description: "Could not dismiss the proposal. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Mutation: Trigger extraction
  const extractMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/learning/extract", {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/learning/proposals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/learning/observations"] });
      toast({
        title: "Learning extraction complete",
        description: `Analyzed ${data.stats?.publicationsAnalyzed ?? 0} publications. Generated ${data.proposals?.length ?? 0} optimization proposals.`,
      });
    },
    onError: () => {
      toast({
        title: "Extraction failed",
        description: "Could not complete pattern extraction.",
        variant: "destructive",
      });
    },
  });

  const toggleEvidence = (id: number) => {
    setExpandedEvidence((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const profiles = styleData?.profiles || [];
  const proposals = proposalsData || [];
  const observations = observationsData || [];

  const isStyleUnconfigured =
    styleError &&
    (styleError.message?.includes("503") || (styleError as any).status === 503);

  return (
    <div className="space-y-8 pb-12" data-testid="container-learning-view">
      {/* Editorial Disclaimer Banner */}
      <div className="bg-muted/40 border rounded-lg p-3.5 flex items-start gap-3 text-xs text-muted-foreground">
        <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Evidence-Based Learning Surface</p>
          <p>
            Observations below reflect patterns detected in your published content, analyzed reference writing,
            and review actions. ContentForge surfaces observed evidence rather than unsubstantiated recommendations.
          </p>
        </div>
      </div>

      {/* ── TIER 1: PROPOSED (OPTIMIZATION CANDIDATES) ── */}
      <div className="space-y-4" data-testid="section-learning-proposals">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-amber-500" />
              <h2 className="text-lg font-semibold text-foreground">Optimization Proposals</h2>
              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">
                Proposed
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Candidate optimizations grounded in empirical observations. All proposals are human-reviewable; production policies remain unchanged.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8 gap-1.5 shrink-0 self-start sm:self-auto"
            onClick={() => extractMutation.mutate()}
            disabled={extractMutation.isPending}
            data-testid="button-run-extraction"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${extractMutation.isPending ? "animate-spin" : ""}`} />
            Analyze Signals
          </Button>
        </div>

        {isProposalsLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : proposalsError ? (
          <ErrorState
            title="Couldn't load optimization proposals"
            description="Failed to fetch proposals."
            onRetry={() => refetchProposals()}
          />
        ) : proposals.length === 0 ? (
          <Card className="border-dashed bg-muted/20" data-testid="empty-learning-proposals">
            <CardContent className="py-8 text-center space-y-3">
              <Lightbulb className="h-8 w-8 text-muted-foreground mx-auto" />
              <div className="space-y-1 max-w-md mx-auto">
                <p className="text-sm font-semibold text-foreground">No Optimization Proposals Yet</p>
                <p className="text-xs text-muted-foreground">
                  As you publish and review content across channels (minimum 3 samples), ContentForge evaluates format engagement, voice consistency, and dispatch reliability to propose evidence-backed adjustments.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => extractMutation.mutate()}
                disabled={extractMutation.isPending}
              >
                Evaluate Existing Data
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4" data-testid="list-learning-proposals">
            {proposals.map((prop) => {
              const quality = formatEvidenceQuality(prop.evidenceQuality);
              const isExpanded = !!expandedEvidence[prop.id];

              return (
                <Card
                  key={prop.id}
                  className="border transition-colors hover:border-border/80"
                  data-testid={`card-proposal-${prop.id}`}
                >
                  <CardHeader className="pb-3 pt-4 px-4 sm:px-6">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">{prop.title}</span>
                          <Badge variant="outline" className="text-[10px] uppercase font-medium">
                            {formatProposalType(prop.proposalType)}
                          </Badge>
                          <Badge variant={quality.variant as any} className="text-[10px]">
                            {quality.label} ({quality.sampleDescription})
                          </Badge>
                        </div>
                        <p className="text-xs text-foreground/90 font-medium leading-relaxed">
                          {prop.rationale}
                        </p>
                      </div>

                      {/* Status / Review Actions */}
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto pt-1 sm:pt-0">
                        {prop.status === "proposed" ? (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => acceptMutation.mutate(prop.id)}
                              disabled={acceptMutation.isPending || rejectMutation.isPending}
                              data-testid={`button-accept-proposal-${prop.id}`}
                            >
                              <Check className="h-3 w-3" />
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                              onClick={() => rejectMutation.mutate(prop.id)}
                              disabled={acceptMutation.isPending || rejectMutation.isPending}
                              data-testid={`button-dismiss-proposal-${prop.id}`}
                            >
                              <X className="h-3 w-3" />
                              Dismiss
                            </Button>
                          </>
                        ) : prop.status === "accepted" ? (
                          <Badge variant="default" className="text-xs bg-emerald-600 gap-1 py-1" data-testid={`badge-status-accepted-${prop.id}`}>
                            <Check className="h-3 w-3" />
                            Accepted (Human Reviewed)
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs gap-1 py-1" data-testid={`badge-status-rejected-${prop.id}`}>
                            Dismissed
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="pt-0 pb-3.5 px-4 sm:px-6 space-y-2.5 text-xs text-muted-foreground border-t border-border/40 mt-1">
                    <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          <strong>Hypothesis:</strong> {prop.expectedImpactHypothesis}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground self-start sm:self-auto gap-1"
                        onClick={() => toggleEvidence(prop.id)}
                        data-testid={`button-toggle-evidence-${prop.id}`}
                      >
                        <ShieldCheck className="h-3 w-3 text-primary" />
                        {isExpanded ? "Hide Evidence Details" : "Inspect Evidence & Lineage"}
                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </Button>
                    </div>

                    {/* Expandable Evidence Drawer */}
                    {isExpanded && (
                      <div
                        className="p-3 rounded-md bg-muted/40 border text-[11px] space-y-2 mt-2"
                        data-testid={`drawer-evidence-${prop.id}`}
                      >
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div className="p-2 rounded bg-background/60 border">
                            <span className="text-muted-foreground block text-[10px]">Verified Samples</span>
                            <span className="font-semibold text-foreground text-xs" data-testid="text-evidence-sample-count">
                              {prop.evidenceSummary?.sampleCount ?? "—"} publications
                            </span>
                          </div>
                          <div className="p-2 rounded bg-background/60 border">
                            <span className="text-muted-foreground block text-[10px]">Candidate Avg</span>
                            <span className="font-semibold text-foreground text-xs">
                              {prop.evidenceSummary?.candidateValue ?? "—"}
                            </span>
                          </div>
                          <div className="p-2 rounded bg-background/60 border">
                            <span className="text-muted-foreground block text-[10px]">Comparison Baseline</span>
                            <span className="font-semibold text-foreground text-xs">
                              {prop.evidenceSummary?.baselineValue ?? "—"}
                            </span>
                          </div>
                          <div className="p-2 rounded bg-background/60 border">
                            <span className="text-muted-foreground block text-[10px]">Observed Delta</span>
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400 text-xs">
                              +{prop.evidenceSummary?.differencePercentage}%
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground pt-1">
                          <span><strong>Scope:</strong> {prop.targetScope}</span>
                          {prop.evidenceSummary?.publicationIds && (
                            <span>
                              <strong>Source Publications:</strong> {prop.evidenceSummary.publicationIds.join(", ")}
                            </span>
                          )}
                          {prop.reviewedAt && (
                            <span>
                              <strong>Reviewed:</strong> {new Date(prop.reviewedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ── TIER 2: LEARNED (INFERRED PATTERNS & VOICE) ── */}
      <div className="space-y-4" data-testid="section-learning-inferences">
        <div className="flex items-center gap-2 pb-2 border-b">
          <BookOpen className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Inferred Patterns & Voice</h2>
          <Badge variant="outline" className="text-xs">
            Learned
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Section 1: Writing Style & Voice */}
          <Card data-testid="card-learning-voice">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PenTool className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base font-semibold">Writing Style Patterns</CardTitle>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  Style Profiles
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              {isStyleLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : isStyleUnconfigured ? (
                <div className="py-6 text-center text-xs text-muted-foreground space-y-2">
                  <AlertCircle className="h-6 w-6 mx-auto text-amber-500" />
                  <p className="font-medium text-foreground">Style Intelligence Not Configured</p>
                  <p>Style reference analysis is currently unavailable in this deployment.</p>
                </div>
              ) : styleError ? (
                <ErrorState
                  title="Couldn't load style patterns"
                  description="Failed to load style profiles."
                  onRetry={() => refetchStyle()}
                />
              ) : profiles.length === 0 ? (
                <EmptyState
                  icon={PenTool}
                  title="No style profiles recorded"
                  description="Analyze references or past content in Sources to surface writing voice patterns."
                  action={
                    <Button asChild size="sm" variant="outline" data-testid="button-learning-explore-sources">
                      <Link href="/sources">Analyze References</Link>
                    </Button>
                  }
                  testId="empty-learning-style"
                />
              ) : (
                <div className="space-y-3" data-testid="list-learning-style-profiles">
                  {profiles.map((p) => {
                    const conf = humanizeConfidence(p.confidence);
                    return (
                      <div
                        key={p.id}
                        className="p-3 border rounded-md bg-card/50 space-y-2 text-xs"
                        data-testid={`card-style-profile-${p.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-foreground text-sm">{p.name}</span>
                          <div className="flex items-center gap-1.5">
                            {p.isActive && (
                              <Badge variant="default" className="text-[10px] bg-emerald-600">
                                Active
                              </Badge>
                            )}
                            <Badge variant={conf.variant as any} className="text-[10px]" data-testid="badge-confidence">
                              {conf.label}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-muted-foreground text-[11px]">
                          {formatStyleProvenance(p.sampleCount)}
                          {p.channel ? ` · Channel: ${formatChannelName(p.channel)}` : ""}
                        </p>
                        {p.stylePromptSnippet && (
                          <p className="text-muted-foreground line-clamp-2 bg-muted/30 p-2 rounded text-[11px] font-mono">
                            {p.stylePromptSnippet}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 2: Inferred Empirical Observations */}
          <Card data-testid="card-learning-observations">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base font-semibold">Empirical Observations</CardTitle>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  Pattern Inferences
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              {isObservationsLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : observations.length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  title="No multi-sample observations yet"
                  description="Publish content across channels to build comparison datasets for empirical pattern detection."
                  action={
                    <Button asChild size="sm" variant="outline">
                      <Link href="/create">Create Content</Link>
                    </Button>
                  }
                  testId="empty-learning-observations"
                />
              ) : (
                <div className="space-y-3" data-testid="list-learning-observations">
                  {observations.map((obs) => {
                    const quality = formatEvidenceQuality(obs.evidenceQuality);
                    return (
                      <div
                        key={obs.id}
                        className="p-3 border rounded-md bg-card/50 space-y-1.5 text-xs"
                        data-testid={`card-observation-${obs.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-foreground capitalize">
                            {obs.observationType.replace(/_/g, " ")}
                          </span>
                          <Badge variant={quality.variant as any} className="text-[10px]">
                            {quality.label}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground text-[11px]">
                          Scope: <code>{obs.targetScope}</code>
                        </p>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                          <span>
                            Candidate: <strong>{obs.candidateValue ?? "—"}</strong> vs Baseline: <strong>{obs.comparisonValue ?? "—"}</strong>
                          </span>
                          {obs.differencePercentage && Number(obs.differencePercentage) !== 0 && (
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              {Number(obs.differencePercentage) > 0 ? "+" : ""}{obs.differencePercentage}%
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── TIER 3: OBSERVED (MEASURED FACTS & COVERAGE) ── */}
      <div className="space-y-4" data-testid="section-learning-observed">
        <div className="flex items-center gap-2 pb-2 border-b">
          <Eye className="h-5 w-5 text-blue-500" />
          <h2 className="text-lg font-semibold text-foreground">Measured Production Signals</h2>
          <Badge variant="outline" className="text-xs">
            Observed
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Section 1: Production Lifecycle & Approval Signals */}
          <Card data-testid="card-learning-lifecycle">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <CardTitle className="text-base font-semibold">Workflow & Approval Signals</CardTitle>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  Production Signals
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              {isSummaryLoading ? (
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-20" />
                  <Skeleton className="h-20" />
                </div>
              ) : summaryError ? (
                <ErrorState
                  title="Couldn't load workflow signals"
                  description="Failed to load lifecycle learning summary."
                  onRetry={() => refetchSummary()}
                />
              ) : !learningSummary || learningSummary.publishedCount === 0 ? (
                <EmptyState
                  icon={Layers}
                  title="Not enough workflow data yet"
                  description="Publish content and review generation drafts to build editorial learning signals."
                  action={
                    <Button asChild size="sm" variant="outline">
                      <Link href="/create">Create Content</Link>
                    </Button>
                  }
                  testId="empty-learning-workflow"
                />
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 border rounded-md bg-muted/20">
                      <div className="text-xs text-muted-foreground">Draft Approval Rate</div>
                      <div className="text-xl font-semibold tabular-nums mt-1" data-testid="text-approval-rate">
                        {formatMetricRate(learningSummary.approvalRate)}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Approved vs rejected drafts</p>
                    </div>
                    <div className="p-3 border rounded-md bg-muted/20">
                      <div className="text-xs text-muted-foreground">Publication Delivery Rate</div>
                      <div className="text-xl font-semibold tabular-nums mt-1" data-testid="text-success-rate">
                        {formatMetricRate(learningSummary.successRate)}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Successful dispatch rate</p>
                    </div>
                  </div>

                  {/* Content formats breakdown */}
                  {learningSummary.byFormat.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        Observed Format Distribution
                      </h3>
                      <div className="space-y-1.5">
                        {learningSummary.byFormat.map((f) => (
                          <div
                            key={f.format}
                            className="flex items-center justify-between text-xs py-1 border-b border-border/40 last:border-0"
                          >
                            <span className="font-medium text-foreground">{formatContentType(f.format)}</span>
                            <span className="text-muted-foreground tabular-nums">{f.published} published</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 2: Ingested Channel Performance Signals */}
          <Card data-testid="card-learning-performance-signals">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-blue-500" />
                  <CardTitle className="text-base font-semibold">Channel Performance Signals</CardTitle>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  Platform Ingestion
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {isSummaryLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : summaryError ? (
                <ErrorState
                  title="Couldn't load performance signals"
                  description="Failed to fetch ingested platform metrics."
                  onRetry={() => refetchSummary()}
                />
              ) : !learningSummary || learningSummary.metricTotals.length === 0 ? (
                <EmptyState
                  icon={BarChart2}
                  title="No platform signals recorded yet"
                  description="As content is published and metrics are ingested from connected accounts, aggregated signals will appear here."
                  testId="empty-learning-signals"
                />
              ) : (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="py-2 px-3 font-medium">Metric</th>
                          <th className="py-2 px-3 font-medium">Observed Total</th>
                          <th className="py-2 px-3 font-medium">Measurement Coverage</th>
                          <th className="py-2 px-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {learningSummary.metricTotals.map((m) => {
                          const hasObserved = m.observedCount > 0;
                          return (
                            <tr key={m.metric} className="border-b border-border/40 hover:bg-muted/30">
                              <td className="py-2.5 px-3 font-medium text-foreground capitalize">
                                {m.metric}
                              </td>
                              <td className="py-2.5 px-3 tabular-nums font-semibold" data-testid={`metric-total-${m.metric}`}>
                                {formatMetricValue(m.total, hasObserved ? "observed" : "not_available")}
                              </td>
                              <td className="py-2.5 px-3 text-muted-foreground">
                                {hasObserved
                                  ? `Observed on ${m.observedCount} ${m.observedCount === 1 ? "item" : "items"}`
                                  : "Not observed yet"}
                                {m.notAvailableCount > 0
                                  ? ` (${m.notAvailableCount} unavailable on channel)`
                                  : ""}
                              </td>
                              <td className="py-2.5 px-3">
                                <Badge
                                  variant={hasObserved ? "outline" : "secondary"}
                                  className="text-[10px]"
                                >
                                  {hasObserved ? "Observed data" : "Not measured"}
                                </Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <HelpCircle className="h-3.5 w-3.5 shrink-0" />
                    Unavailable platform metrics are left as unmeasured rather than coerced to zero.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Canonical Bridges & Action Handoffs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
        <Card className="p-4 border-dashed bg-muted/20 flex flex-col justify-between">
          <div className="space-y-1.5 mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5 text-foreground">
              <Compass className="h-4 w-4 text-primary" />
              Explore Topics in Sources
            </h3>
            <p className="text-xs text-muted-foreground">
              Investigate topic angles and evidence in the Sources workspace before creating.
            </p>
          </div>
          <Button asChild size="sm" variant="outline" className="w-full" data-testid="button-learning-sources">
            <Link href="/sources">Open Sources</Link>
          </Button>
        </Card>

        <Card className="p-4 border-dashed bg-muted/20 flex flex-col justify-between">
          <div className="space-y-1.5 mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5 text-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              Create From Observations
            </h3>
            <p className="text-xs text-muted-foreground">
              Take observed style and format insights directly into the Create Studio.
            </p>
          </div>
          <Button asChild size="sm" variant="outline" className="w-full" data-testid="button-learning-create">
            <Link href="/create">Open Studio</Link>
          </Button>
        </Card>

        <Card className="p-4 border-dashed bg-muted/20 flex flex-col justify-between">
          <div className="space-y-1.5 mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5 text-foreground">
              <Bot className="h-4 w-4 text-primary" />
              Ask Agent
            </h3>
            <p className="text-xs text-muted-foreground">
              Consult the Agent to analyze patterns or suggest new content angles.
            </p>
          </div>
          <Button asChild size="sm" variant="outline" className="w-full" data-testid="button-learning-agent">
            <Link href={getAskAgentUrl("Analyze our recent content performance and suggest angles")}>
              Consult Agent
            </Link>
          </Button>
        </Card>
      </div>
    </div>
  );
}
