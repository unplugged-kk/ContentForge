import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui-shared/error-state";
import { EmptyState } from "@/components/ui-shared/empty-state";
import { ConfirmDialog } from "@/components/ui-shared/confirm-dialog";
import { AutomatedOptimizationPanel } from "./automated-optimization-panel";
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
  FlaskConical,
  TrendingUp,
  Sliders,
  Play,
  Pause,
  FileText,
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

interface ExperimentVariantItem {
  id: number;
  experimentId: number;
  variantKey: string;
  name: string;
  description: string | null;
  isControl: boolean;
  trafficWeight: number;
  policySnapshot: Record<string, any>;
}

interface ExperimentEvaluationItem {
  id: number;
  experimentId: number;
  primaryMetric: string;
  controlMetrics: { sampleCount: number; mean: string };
  variantMetrics: Array<{
    variantId: number;
    variantKey: string;
    sampleCount: number;
    mean: string;
    difference: string | null;
    differencePercentage: string | null;
  }>;
  guardrailResults: Array<{
    metric: string;
    status: "passed" | "regressed" | "inconclusive";
    controlValue: string;
    variantValue: string;
    message: string;
  }>;
  evidenceQuality: string;
  recommendedDecision: string;
  summary: string;
  evaluatedAt: string;
}

interface ExperimentItem {
  id: number;
  userId: number;
  name: string;
  hypothesis: string;
  objective: string;
  targetScope: string;
  experimentType: string;
  primaryMetric: string;
  guardrailMetrics: string[];
  status: "draft" | "ready" | "running" | "paused" | "completed" | "cancelled";
  minSampleSize: number;
  startedAt: string | null;
  completedAt: string | null;
  winningVariantId: number | null;
  decision: string | null;
  decisionNotes: string | null;
  decidedAt: string | null;
  sourceProposalId: number | null;
  createdAt: string;
  variants?: ExperimentVariantItem[];
  assignmentsCount?: number;
  latestEvaluation?: ExperimentEvaluationItem | null;
}

interface PolicyCandidateItem {
  id: number;
  userId: number;
  experimentId: number;
  variantId: number;
  evaluationId: number | null;
  title: string;
  targetScope: string;
  proposedConfiguration: Record<string, any>;
  rationale: string;
  status: "candidate" | "under_review" | "approved_for_future" | "rejected" | "archived";
  reviewedAt: string | null;
  reviewNotes: string | null;
  identityKey: string;
  createdAt: string;
  updatedAt: string;
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

function formatDecisionBadge(decision: string | null): { label: string; variant: "default" | "secondary" | "outline" | "destructive" } {
  switch (decision) {
    case "variant_preferred":
      return { label: "Variant Preferred", variant: "default" };
    case "variant_promising":
      return { label: "Variant Promising", variant: "default" };
    case "control_preferred":
      return { label: "Control Preferred", variant: "outline" };
    case "guardrail_failed":
      return { label: "Guardrail Regressed", variant: "destructive" };
    case "inconclusive":
      return { label: "Inconclusive", variant: "secondary" };
    case "pending":
    default:
      return { label: "Evaluation Pending", variant: "outline" };
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

  const [expandedExperiment, setExpandedExperiment] = useState<Record<number, boolean>>({});
  const toggleExperiment = (id: number) => {
    setExpandedExperiment((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Query 5: Controlled Experiments (Phase 29.2)
  const {
    data: experimentsData,
    isLoading: isExperimentsLoading,
    error: experimentsError,
    refetch: refetchExperiments,
  } = useQuery<ExperimentItem[]>({
    queryKey: ["/api/experiments"],
  });

  // Query 6: Policy Candidates (Phase 29.2)
  const {
    data: policyCandidatesData,
    isLoading: isCandidatesLoading,
    error: candidatesError,
    refetch: refetchCandidates,
  } = useQuery<PolicyCandidateItem[]>({
    queryKey: ["/api/policy-candidates"],
  });

  // Mutation: Create experiment from proposal
  const createExperimentFromProposalMutation = useMutation({
    mutationFn: async (prop: LearningProposalItem) => {
      const isReliability = prop.proposalType === "workflow_reliability";
      const res = await apiRequest("POST", "/api/experiments", {
        name: `Test: ${prop.title}`,
        hypothesis: prop.expectedImpactHypothesis || prop.rationale,
        objective: prop.title,
        targetScope: prop.targetScope,
        experimentType: prop.proposalType,
        primaryMetric: isReliability ? "publication_delivery_rate" : "likes",
        guardrailMetrics: ["publication_failure_rate"],
        sourceProposalId: prop.id,
        status: "running",
        minSampleSize: 3,
        variants: [
          {
            variantKey: "control",
            name: "Current Baseline",
            isControl: true,
            trafficWeight: 50,
            policySnapshot: { baseline: true, scope: prop.targetScope },
          },
          {
            variantKey: "variant_a",
            name: `Optimized (${prop.title.slice(0, 30)})`,
            isControl: false,
            trafficWeight: 50,
            policySnapshot: {
              proposalId: prop.id,
              scope: prop.targetScope,
              hypothesis: prop.expectedImpactHypothesis,
            },
          },
        ],
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/experiments"] });
      toast({
        title: "Controlled Experiment Launched",
        description: `Running experiment "${data.name}" with 50/50 deterministic allocation.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to create experiment",
        description: err?.message || "Could not initialize experiment.",
        variant: "destructive",
      });
    },
  });

  // Mutation: Evaluate experiment
  const evaluateExperimentMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/experiments/${id}/evaluate`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/experiments"] });
      toast({
        title: "Evaluation updated",
        description: "Primary metrics and guardrails recalculated against latest signals.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Evaluation failed",
        description: err?.message || "Could not evaluate experiment.",
        variant: "destructive",
      });
    },
  });

  // Mutation: Record experiment decision
  const decideExperimentMutation = useMutation({
    mutationFn: async ({ id, decision, notes }: { id: number; decision: string; notes?: string }) => {
      const res = await apiRequest("POST", `/api/experiments/${id}/decide`, { decision, notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/experiments"] });
      toast({
        title: "Decision recorded",
        description: "Experiment decision saved. Staged for policy candidate creation.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to record decision",
        description: err?.message || "Could not save decision.",
        variant: "destructive",
      });
    },
  });

  // Mutation: Complete experiment
  const completeExperimentMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/experiments/${id}/complete`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/experiments"] });
      toast({
        title: "Experiment completed",
        description: "Experiment completed and closed to new assignments.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to complete experiment",
        description: err?.message || "Could not complete experiment.",
        variant: "destructive",
      });
    },
  });

  // Mutation: Promote variant to policy candidate
  const promoteCandidateMutation = useMutation({
    mutationFn: async ({ experimentId, variantId, title }: { experimentId: number; variantId: number; title?: string }) => {
      const res = await apiRequest("POST", `/api/experiments/${experimentId}/policy-candidate`, {
        variantId,
        title,
        reviewNotes: "Promoted from validated experiment decision.",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/experiments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policy-candidates"] });
      toast({
        title: "Policy Candidate Generated",
        description: "Pre-production candidate staged for human review. Zero production mutation.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to promote candidate",
        description: err?.message || "Could not generate policy candidate.",
        variant: "destructive",
      });
    },
  });

  // Mutation: Review policy candidate (Approve or Reject)
  const reviewCandidateMutation = useMutation({
    mutationFn: async ({ candidateId, status, notes }: { candidateId: number; status: "approved_for_future" | "rejected"; notes?: string }) => {
      const res = await apiRequest("POST", `/api/policy-candidates/${candidateId}/review`, {
        status,
        notes: notes || `Marked ${status} by human reviewer`,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policy-candidates"] });
      toast({
        title: "Policy Candidate Reviewed",
        description: "Governance decision saved. Live production policies remain unmutated.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Review failed",
        description: err?.message || "Could not update policy candidate.",
        variant: "destructive",
      });
    },
  });

  // Phase 29.3 -- human-gated policy activation. A candidate never becomes
  // active on its own; these two mutations are the only path, and each is
  // gated behind its own explicit confirmation dialog.
  const [activateCandidateId, setActivateCandidateId] = useState<number | null>(null);
  const [rollbackCandidateId, setRollbackCandidateId] = useState<number | null>(null);

  // Server-derived activation state: which candidate IDs have been activated
  // and not subsequently rolled back. Survives browser reload, second tab,
  // and app restart -- authoritative truth comes from policyActivations table.
  const { data: activatedIdsData } = useQuery<{ activatedCandidateIds: number[] }>({
    queryKey: ["/api/policy-candidates/activated-ids"],
  });
  const activatedCandidateIds = useMemo(
    () => new Set(activatedIdsData?.activatedCandidateIds ?? []),
    [activatedIdsData],
  );

  const activateMutation = useMutation({
    mutationFn: async (candidateId: number) => {
      const res = await apiRequest("POST", `/api/policy-candidates/${candidateId}/activate`, {
        reason: "Activated by human editor from Insights > Learning governance review.",
      });
      return res.json();
    },
    onSuccess: () => {
      setActivateCandidateId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/policy-candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policy-candidates/activated-ids"] });
      toast({
        title: "Policy Activated for Future Generations",
        description: "A new immutable revision is now the active production policy for this scope. Existing content is unchanged.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Activation failed",
        description: err?.message || "Could not activate this policy candidate.",
        variant: "destructive",
      });
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: async (candidateId: number) => {
      const res = await apiRequest("POST", `/api/policy-candidates/${candidateId}/rollback`, {
        reason: "Rolled back by human editor from Insights > Learning governance review.",
      });
      return res.json();
    },
    onSuccess: () => {
      setRollbackCandidateId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/policy-candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policy-candidates/activated-ids"] });
      toast({
        title: "Policy Rolled Back",
        description: "Future generations resolve the prior revision again. Existing generated content is unchanged.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Rollback failed",
        description: err?.message || "Could not roll back this policy activation.",
        variant: "destructive",
      });
    },
  });

  const profiles = styleData?.profiles || [];
  const proposals = proposalsData || [];
  const observations = observationsData || [];
  const experiments = experimentsData || [];
  const policyCandidates = policyCandidatesData || [];

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
                      <div className="flex flex-wrap items-center gap-2 shrink-0 self-end sm:self-auto pt-1 sm:pt-0">
                        {prop.status === "proposed" ? (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 text-xs gap-1 bg-emerald-700 hover:bg-emerald-800 text-white"
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
                          <Badge variant="default" className="text-xs bg-emerald-700 gap-1 py-1" data-testid={`badge-status-accepted-${prop.id}`}>
                            <Check className="h-3 w-3" />
                            Accepted (Human Reviewed)
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs gap-1 py-1" data-testid={`badge-status-rejected-${prop.id}`}>
                            Dismissed
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 border-primary/30 text-foreground hover:bg-primary/10"
                          onClick={() => createExperimentFromProposalMutation.mutate(prop)}
                          disabled={createExperimentFromProposalMutation.isPending}
                          data-testid={`button-create-experiment-${prop.id}`}
                        >
                          <FlaskConical className={`h-3 w-3 ${createExperimentFromProposalMutation.isPending ? "animate-spin" : ""}`} />
                          Test in Experiment
                        </Button>
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

      {/* ── TIER 1.5: CONTROLLED EXPERIMENTS (HYPOTHESIZE → EXPERIMENT → MEASURE → DECIDE) ── */}
      <div className="space-y-4" data-testid="section-controlled-experiments">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-blue-500" />
              <h2 className="text-lg font-semibold text-foreground">Controlled Experiments</h2>
              <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30">
                Optimization Engine
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Hypothesize → Experiment → Measure → Decide. Controlled 50/50 variant testing with guardrails. Zero automated production mutation.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8 gap-1.5 shrink-0 self-start sm:self-auto"
            onClick={() => refetchExperiments()}
            disabled={isExperimentsLoading}
            data-testid="button-refresh-experiments"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isExperimentsLoading ? "animate-spin" : ""}`} />
            Refresh Experiments
          </Button>
        </div>

        {isExperimentsLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : experimentsError ? (
          <ErrorState
            title="Couldn't load controlled experiments"
            description="Failed to fetch experiments."
            onRetry={() => refetchExperiments()}
          />
        ) : experiments.length === 0 ? (
          <Card className="border-dashed bg-muted/20" data-testid="empty-controlled-experiments">
            <CardContent className="py-8 text-center space-y-3">
              <FlaskConical className="h-8 w-8 text-muted-foreground mx-auto" />
              <div className="space-y-1 max-w-md mx-auto">
                <p className="text-sm font-semibold text-foreground">No Controlled Experiments Active</p>
                <p className="text-xs text-muted-foreground">
                  Launch a controlled experiment from any optimization proposal above or configure a variant test. ContentForge allocates incoming opportunities deterministically to measure empirical delta against control.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4" data-testid="list-controlled-experiments">
            {experiments.map((exp) => {
              const isExpanded = !!expandedExperiment[exp.id];
              const evalData = exp.latestEvaluation;
              const decBadge = formatDecisionBadge(exp.decision);
              const isRunning = exp.status === "running";
              const isCompleted = exp.status === "completed";

              return (
                <Card
                  key={exp.id}
                  className="border transition-colors hover:border-border/80"
                  data-testid={`card-experiment-${exp.id}`}
                >
                  <CardHeader className="pb-3 pt-4 px-4 sm:px-6">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="text-sm font-semibold text-foreground"
                            data-testid={`text-experiment-name-${exp.id}`}
                          >
                            {exp.name}
                          </span>
                          <Badge variant="outline" className="text-[10px] uppercase font-medium">
                            {formatProposalType(exp.experimentType)}
                          </Badge>
                          <Badge
                            variant={isRunning ? "default" : isCompleted ? "secondary" : "outline"}
                            className={`text-[10px] capitalize ${
                              isRunning ? "bg-blue-600 text-white" : isCompleted ? "bg-emerald-700 text-white" : ""
                            }`}
                            data-testid={`badge-experiment-status-${exp.id}`}
                          >
                            {exp.status}
                          </Badge>
                          {exp.decision && exp.decision !== "pending" && (
                            <Badge variant={decBadge.variant} className="text-[10px]" data-testid={`badge-experiment-decision-${exp.id}`}>
                              {decBadge.label}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-foreground/90 font-medium leading-relaxed">
                          <strong>Hypothesis:</strong> {exp.hypothesis}
                        </p>
                      </div>

                      {/* Top Action Buttons */}
                      <div className="flex flex-wrap items-center gap-2 shrink-0 self-end sm:self-auto pt-1 sm:pt-0">
                        {isRunning && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                            onClick={() => completeExperimentMutation.mutate(exp.id)}
                            disabled={completeExperimentMutation.isPending}
                            data-testid={`button-complete-experiment-${exp.id}`}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Complete
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 border-primary/30 text-foreground hover:bg-primary/10"
                          onClick={() => evaluateExperimentMutation.mutate(exp.id)}
                          disabled={evaluateExperimentMutation.isPending}
                          data-testid={`button-evaluate-experiment-${exp.id}`}
                        >
                          <TrendingUp className={`h-3 w-3 ${evaluateExperimentMutation.isPending ? "animate-spin" : ""}`} />
                          Evaluate Signals
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="pt-0 pb-3.5 px-4 sm:px-6 space-y-2.5 text-xs text-muted-foreground border-t border-border/40 mt-1">
                    {/* Metadata strip */}
                    <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                        <span><strong>Scope:</strong> <code>{exp.targetScope}</code></span>
                        <span><strong>Primary Metric:</strong> <span className="capitalize">{exp.primaryMetric}</span></span>
                        <span><strong>Guardrails:</strong> {exp.guardrailMetrics && exp.guardrailMetrics.length > 0 ? exp.guardrailMetrics.join(", ") : "None"}</span>
                        <span><strong>Assignments:</strong> {exp.assignmentsCount ?? 0}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground self-start sm:self-auto gap-1"
                        onClick={() => toggleExperiment(exp.id)}
                        data-testid={`button-toggle-experiment-details-${exp.id}`}
                      >
                        <ShieldCheck className="h-3 w-3 text-primary" />
                        {isExpanded ? "Hide Evaluation & Variants" : "Inspect Results & Variants"}
                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </Button>
                    </div>

                    {/* Variants preview bar */}
                    {exp.variants && exp.variants.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                        <span className="text-muted-foreground">Variants:</span>
                        {exp.variants.map((v) => (
                          <span
                            key={v.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted/40 border text-[11px]"
                          >
                            <span className="font-semibold text-foreground">{v.name}</span>
                            {v.isControl ? (
                              <Badge variant="outline" className="text-[9px] py-0 px-1">Control</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[9px] py-0 px-1">Variant</Badge>
                            )}
                            <span className="text-muted-foreground text-[10px]">({v.trafficWeight}%)</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Expandable Evaluation & Decision Drawer */}
                    {isExpanded && (
                      <div
                        className="p-3.5 rounded-md bg-muted/40 border text-[11px] space-y-3 mt-2"
                        data-testid={`drawer-experiment-details-${exp.id}`}
                      >
                        {evalData ? (
                          <div className="space-y-3" data-testid={`drawer-experiment-eval-${exp.id}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-foreground text-xs">Empirical Evaluation</span>
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                  data-testid="badge-experiment-evidence-quality"
                                >
                                  {evalData.evidenceQuality.replace(/_/g, " ")} evidence
                                </Badge>
                                <Badge
                                  variant={
                                    evalData.recommendedDecision.includes("variant")
                                      ? "default"
                                      : evalData.recommendedDecision === "guardrail_failed"
                                      ? "destructive"
                                      : "outline"
                                  }
                                  className="text-[10px]"
                                  data-testid="badge-recommended-decision"
                                >
                                  Recommendation: {evalData.recommendedDecision.replace(/_/g, " ")}
                                </Badge>
                              </div>
                              <span className="text-muted-foreground text-[10px]">
                                Evaluated {new Date(evalData.evaluatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>

                            {/* Non-causal narrative */}
                            <p className="text-foreground/90 bg-background/60 p-2.5 rounded border text-xs leading-relaxed italic">
                              {evalData.summary}
                            </p>

                            {/* Metric comparisons */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <div className="p-2 rounded bg-background/60 border">
                                <span className="text-muted-foreground block text-[10px]">Control Mean</span>
                                <span className="font-semibold text-foreground text-xs">
                                  {evalData.controlMetrics.mean}
                                </span>
                                <span className="text-muted-foreground block text-[9px]">
                                  {evalData.controlMetrics.sampleCount} samples
                                </span>
                              </div>
                              {evalData.variantMetrics.map((vm) => (
                                <div key={vm.variantId} className="p-2 rounded bg-background/60 border col-span-1 sm:col-span-3">
                                  <span className="text-muted-foreground block text-[10px]">
                                    Variant ({vm.variantKey}) Mean & Delta
                                  </span>
                                  <div className="flex items-baseline gap-2">
                                    <span className="font-semibold text-foreground text-xs">{vm.mean}</span>
                                    {vm.differencePercentage && (
                                      <span
                                        className={`font-semibold text-xs ${
                                          Number(vm.differencePercentage) > 0
                                            ? "text-emerald-600 dark:text-emerald-400"
                                            : Number(vm.differencePercentage) < 0
                                            ? "text-rose-600"
                                            : "text-muted-foreground"
                                        }`}
                                      >
                                        {Number(vm.differencePercentage) > 0 ? "+" : ""}
                                        {vm.differencePercentage}%
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-muted-foreground block text-[9px]">
                                    {vm.sampleCount} samples (diff: {vm.difference ?? "0.00"})
                                  </span>
                                </div>
                              ))}
                            </div>

                            {/* Guardrails table */}
                            {evalData.guardrailResults && evalData.guardrailResults.length > 0 && (
                              <div className="space-y-1">
                                <span className="font-semibold text-foreground text-[11px]">Guardrail Safety Checks</span>
                                <div className="rounded border bg-background/60 overflow-hidden">
                                  <table className="w-full text-[10px] text-left">
                                    <thead className="border-b bg-muted/30 text-muted-foreground">
                                      <tr>
                                        <th className="p-1.5 font-medium">Metric</th>
                                        <th className="p-1.5 font-medium">Control</th>
                                        <th className="p-1.5 font-medium">Variant</th>
                                        <th className="p-1.5 font-medium">Status</th>
                                        <th className="p-1.5 font-medium">Message</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {evalData.guardrailResults.map((g) => (
                                        <tr key={g.metric} className="border-b border-border/40 last:border-0">
                                          <td className="p-1.5 font-mono text-foreground">{g.metric}</td>
                                          <td className="p-1.5 tabular-nums">{g.controlValue}</td>
                                          <td className="p-1.5 tabular-nums">{g.variantValue}</td>
                                          <td className="p-1.5">
                                            <Badge
                                              variant={g.status === "passed" ? "default" : g.status === "regressed" ? "destructive" : "secondary"}
                                              className="text-[9px] py-0 px-1"
                                            >
                                              {g.status}
                                            </Badge>
                                          </td>
                                          <td className="p-1.5 text-muted-foreground">{g.message}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            {/* Human Decision Gate & Candidate Promotion */}
                            <div className="pt-2 border-t border-border/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                              <div className="space-y-0.5">
                                <span className="font-semibold text-foreground text-xs block">Human Decision Gate</span>
                                <span className="text-muted-foreground text-[10px]">
                                  Decide based on observed evidence. Acceptance promotes the variant to a policy candidate without touching production.
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                {exp.decision === "pending" ? (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="default"
                                      className="h-7 text-xs gap-1 bg-emerald-700 hover:bg-emerald-800 text-white"
                                      onClick={() =>
                                        decideExperimentMutation.mutate({
                                          id: exp.id,
                                          decision: "variant_promising",
                                          notes: "Observed positive primary metric delta with stable guardrails",
                                        })
                                      }
                                      disabled={decideExperimentMutation.isPending}
                                      data-testid={`button-decide-promising-${exp.id}`}
                                    >
                                      <Check className="h-3 w-3" />
                                      Accept Variant
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                                      onClick={() =>
                                        decideExperimentMutation.mutate({
                                          id: exp.id,
                                          decision: "control_preferred",
                                          notes: "Control retained",
                                        })
                                      }
                                      disabled={decideExperimentMutation.isPending}
                                      data-testid={`button-decide-control-${exp.id}`}
                                    >
                                      Prefer Control
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs text-muted-foreground"
                                      onClick={() =>
                                        decideExperimentMutation.mutate({
                                          id: exp.id,
                                          decision: "inconclusive",
                                          notes: "Inconclusive results",
                                        })
                                      }
                                      disabled={decideExperimentMutation.isPending}
                                      data-testid={`button-decide-inconclusive-${exp.id}`}
                                    >
                                      Inconclusive
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Badge variant="default" className="text-xs bg-primary/20 text-foreground border-primary/30">
                                      Decision: {exp.decision ? exp.decision.replace(/_/g, " ") : "Recorded"}
                                    </Badge>
                                    {(exp.decision === "variant_promising" || exp.decision === "variant_preferred") && (
                                      <Button
                                        size="sm"
                                        variant="default"
                                        className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                                        onClick={() => {
                                          const nonControl = exp.variants?.find((v) => !v.isControl);
                                          if (nonControl) {
                                            promoteCandidateMutation.mutate({
                                              experimentId: exp.id,
                                              variantId: nonControl.id,
                                              title: `Candidate from ${exp.name}`,
                                            });
                                          }
                                        }}
                                        disabled={promoteCandidateMutation.isPending}
                                        data-testid={`button-promote-candidate-${exp.id}`}
                                      >
                                        <ShieldCheck className="h-3 w-3" />
                                        Promote to Policy Candidate
                                      </Button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="py-4 text-center space-y-2">
                            <p className="text-muted-foreground">
                              No evaluation run yet for this experiment. Click "Evaluate Signals" above to analyze published assignments.
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7"
                              onClick={() => evaluateExperimentMutation.mutate(exp.id)}
                              disabled={evaluateExperimentMutation.isPending}
                            >
                              Run Initial Evaluation
                            </Button>
                          </div>
                        )}
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
                              <Badge variant="default" className="text-[10px] bg-emerald-700">
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

      {/* ── TIER 4: POLICY CANDIDATES (HUMAN GOVERNANCE REQUIRED) ── */}
      <div className="space-y-4" data-testid="section-policy-candidates">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              <h2 className="text-lg font-semibold text-foreground">Policy Candidates</h2>
                  <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                Human Review Required
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Candidate generation and distribution policies promoted from validated experiments. Explicit human review is required before any future production rollout. Live production policies remain completely unmutated.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8 gap-1.5 shrink-0 self-start sm:self-auto"
            onClick={() => refetchCandidates()}
            disabled={isCandidatesLoading}
            data-testid="button-refresh-candidates"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isCandidatesLoading ? "animate-spin" : ""}`} />
            Refresh Candidates
          </Button>
        </div>

        {isCandidatesLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : candidatesError ? (
          <ErrorState
            title="Couldn't load policy candidates"
            description="Failed to fetch candidate policies."
            onRetry={() => refetchCandidates()}
          />
        ) : policyCandidates.length === 0 ? (
          <Card className="border-dashed bg-muted/20" data-testid="empty-policy-candidates">
            <CardContent className="py-8 text-center space-y-3">
              <ShieldCheck className="h-8 w-8 text-muted-foreground mx-auto" />
              <div className="space-y-1 max-w-md mx-auto">
                <p className="text-sm font-semibold text-foreground">No Policy Candidates Staged</p>
                <p className="text-xs text-muted-foreground">
                  When a controlled experiment proves a statistically promising variant without guardrail regressions, you can promote it into a Policy Candidate for formal governance review.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4" data-testid="list-policy-candidates">
            {policyCandidates.map((candidate) => {
              const isUnderReview = candidate.status === "candidate" || candidate.status === "under_review";
              const isApproved = candidate.status === "approved_for_future";
              const isRejected = candidate.status === "rejected";

              return (
                <Card
                  key={candidate.id}
                  className="border transition-colors hover:border-border/80"
                  data-testid={`card-policy-candidate-${candidate.id}`}
                >
                  <CardHeader className="pb-3 pt-4 px-4 sm:px-6">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">{candidate.title}</span>
                          <Badge variant="outline" className="text-[10px] uppercase font-medium">
                            {candidate.targetScope}
                          </Badge>
                          <Badge
                            variant={isApproved ? "default" : isRejected ? "destructive" : "secondary"}
                            className={`text-[10px] ${
                              isApproved
                                ? "bg-emerald-700 text-white"
                                : isUnderReview
                                ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
                                : ""
                            }`}
                            data-testid={`badge-candidate-status-${candidate.id}`}
                          >
                            {isApproved
                              ? "Approved for Future Rollout"
                              : isRejected
                              ? "Rejected"
                              : "Review Pending"}
                          </Badge>
                        </div>
                        <p className="text-xs text-foreground/90 font-medium leading-relaxed">
                          {candidate.rationale}
                        </p>
                      </div>

                      {/* Review Actions */}
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto pt-1 sm:pt-0">
                        {isUnderReview ? (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 text-xs gap-1 bg-emerald-700 hover:bg-emerald-800 text-white"
                              onClick={() =>
                                reviewCandidateMutation.mutate({
                                  candidateId: candidate.id,
                                  status: "approved_for_future",
                                  notes: "Approved by human editor for future rollout consideration",
                                })
                              }
                              disabled={reviewCandidateMutation.isPending}
                              data-testid={`button-approve-candidate-${candidate.id}`}
                            >
                              <Check className="h-3 w-3" />
                              Approve for Future
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                              onClick={() =>
                                reviewCandidateMutation.mutate({
                                  candidateId: candidate.id,
                                  status: "rejected",
                                  notes: "Rejected during governance review",
                                })
                              }
                              disabled={reviewCandidateMutation.isPending}
                              data-testid={`button-reject-candidate-${candidate.id}`}
                            >
                              <X className="h-3 w-3" />
                              Reject
                            </Button>
                          </>
                        ) : isApproved ? (
                          <div className="flex flex-col items-end gap-1.5">
                            <Badge variant="default" className="text-xs bg-emerald-700 gap-1 py-1">
                              <Check className="h-3 w-3" />
                              Approved by Human Reviewer
                            </Badge>
                            {activatedCandidateIds.has(candidate.id) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1"
                                onClick={() => setRollbackCandidateId(candidate.id)}
                                data-testid={`button-rollback-candidate-${candidate.id}`}
                              >
                                Roll Back
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                                onClick={() => setActivateCandidateId(candidate.id)}
                                data-testid={`button-activate-candidate-${candidate.id}`}
                              >
                                <ShieldCheck className="h-3 w-3" />
                                Activate for Future Generations
                              </Button>
                            )}
                          </div>
                        ) : (
                          <Badge variant="secondary" className="text-xs gap-1 py-1">
                            Rejected by Reviewer
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="pt-0 pb-3.5 px-4 sm:px-6 space-y-2.5 text-xs text-muted-foreground border-t border-border/40 mt-1">
                    <div className="pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                      <span><strong>Scope:</strong> <code>{candidate.targetScope}</code></span>
                      {candidate.experimentId && (
                        <span><strong>Source Experiment:</strong> #{candidate.experimentId}</span>
                      )}
                      <span><strong>Created:</strong> {new Date(candidate.createdAt).toLocaleDateString()}</span>
                      {candidate.reviewedAt && (
                        <span><strong>Reviewed:</strong> {new Date(candidate.reviewedAt).toLocaleDateString()}</span>
                      )}
                    </div>

                    {candidate.proposedConfiguration && Object.keys(candidate.proposedConfiguration).length > 0 && (
                      <div className="pt-1">
                        <span className="text-[10px] text-muted-foreground font-semibold block mb-1">
                          Candidate Policy Snapshot (Pre-Production):
                        </span>
                        <pre className="text-[10px] bg-muted/40 p-2 rounded font-mono overflow-x-auto border border-border/40 max-h-32">
                          {JSON.stringify(candidate.proposedConfiguration, null, 2)}
                        </pre>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
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

      <AutomatedOptimizationPanel />

      <ConfirmDialog
        open={activateCandidateId !== null}
        onOpenChange={(open) => !open && setActivateCandidateId(null)}
        title="Activate for Future Generations?"
        description={(() => {
          const c = policyCandidates.find((x) => x.id === activateCandidateId);
          if (!c) return "";
          return `You're about to change future generation behavior. Scope: ${c.targetScope}. Reason: ${c.rationale} This creates a new immutable policy revision and makes it the active production policy for this scope -- existing generated content is never altered, and this can be rolled back at any time.`;
        })()}
        confirmLabel="Activate for Future Generations"
        loading={activateMutation.isPending}
        onConfirm={() => activateCandidateId !== null && activateMutation.mutate(activateCandidateId)}
      />

      <ConfirmDialog
        open={rollbackCandidateId !== null}
        onOpenChange={(open) => !open && setRollbackCandidateId(null)}
        title="Roll Back This Activation?"
        description={(() => {
          const c = policyCandidates.find((x) => x.id === rollbackCandidateId);
          if (!c) return "";
          return `Scope: ${c.targetScope}. This reactivates the revision that was active immediately before this candidate. Existing generated content will not change -- only future generations are affected.`;
        })()}
        confirmLabel="Roll Back"
        destructive
        loading={rollbackMutation.isPending}
        onConfirm={() => rollbackCandidateId !== null && rollbackMutation.mutate(rollbackCandidateId)}
      />
    </div>
  );
}
