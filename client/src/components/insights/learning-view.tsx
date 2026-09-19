import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui-shared/error-state";
import { EmptyState } from "@/components/ui-shared/empty-state";
import {
  formatMetricValue,
  formatMetricRate,
  humanizeConfidence,
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

export function LearningView() {
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

  const profiles = styleData?.profiles || [];
  const isStyleUnconfigured =
    styleError &&
    (styleError.message?.includes("503") || (styleError as any).status === 503);

  return (
    <div className="space-y-6 pb-12" data-testid="container-learning-view">
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

      {/* Grid of Sections: Independent failure resilience */}
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

        {/* Section 2: Production Lifecycle & Approval Signals */}
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
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Observed Format Distribution
                    </h2>
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
      </div>

      {/* Section 3: Ingested Channel Performance Signals */}
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

      {/* Canonical Bridges & Action Handoffs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
        <Card className="p-4 border-dashed bg-muted/20 flex flex-col justify-between">
          <div className="space-y-1.5 mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Compass className="h-4 w-4 text-primary" />
              Explore Topics in Sources
            </h2>
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
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              Create From Observations
            </h2>
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
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Bot className="h-4 w-4 text-primary" />
              Ask Agent
            </h2>
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
