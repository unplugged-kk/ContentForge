import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui-shared/page-header";
import { EmptyState } from "@/components/ui-shared/empty-state";
import { ErrorState } from "@/components/ui-shared/error-state";
import { StatusBadge } from "@/components/ui-shared/status-badge";
import { ChannelIcon } from "@/components/ui-shared/channel-icon";
import {
  deriveAttentionItems,
  isSetupRequiredPublication,
  formatDateBucket,
  formatTimeOfDay,
  previewArtifactPayload,
  type ArtifactLike,
  type PublicationLike,
  type RunLike,
} from "@/lib/today-schedule-state";
import { formatRelativeTime } from "@/lib/agent-workspace-state";
import {
  Sparkles,
  Database,
  Bot,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Sparkle,
} from "lucide-react";
import type { Post, Tweet } from "@shared/schema";

interface PostWithTweets extends Post {
  tweets: Tweet[];
}

interface OccurrenceRow {
  id: number;
  occurrenceTime: string;
  status: string;
  channel: string;
  artifact: ArtifactLike & { readiness: string };
}

function PlatformBadge({ platform }: { platform?: string | null }) {
  if (!platform) return <span className="text-[11px] font-medium text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
      <ChannelIcon channel={platform} decorative />
      <span className="capitalize">{platform}</span>
    </span>
  );
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function endOfToday(): Date {
  const start = startOfToday();
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

export default function TodayPage() {
  const reviewQuery = useQuery<ArtifactLike[]>({ queryKey: ["/api/artifacts?readiness=in_review&limit=10"] });
  const runsQuery = useQuery<{ runs: RunLike[] }>({ queryKey: ["/api/agent/runs?limit=10"] });
  const publicationsQuery = useQuery<PublicationLike[]>({ queryKey: ["/api/publications?limit=20"] });

  const from = startOfToday().toISOString();
  const to = endOfToday().toISOString();
  const occurrencesQuery = useQuery<OccurrenceRow[]>({
    queryKey: [`/api/schedule-occurrences?from=${from}&to=${to}&limit=50`],
  });
  const queuePostsQuery = useQuery<PostWithTweets[]>({ queryKey: ["/api/posts/queue/today"] });
  const recentArtifactsQuery = useQuery<ArtifactLike[]>({ queryKey: ["/api/artifacts?limit=5"] });

  const attentionSourcesErrored = [reviewQuery.isError, runsQuery.isError, publicationsQuery.isError].some(Boolean);
  const attentionLoading = reviewQuery.isLoading || runsQuery.isLoading || publicationsQuery.isLoading;
  const failedPublications = (publicationsQuery.data ?? []).filter((p) => p.state === "failed");
  const setupRequiredPublications = failedPublications.filter(isSetupRequiredPublication);
  const publicationFailures = failedPublications.filter((publication) => !isSetupRequiredPublication(publication));
  const unknownPublications = (publicationsQuery.data ?? []).filter((p) => p.result?.outcome === "unknown");
  const runsNeedingApproval = (runsQuery.data?.runs ?? []).filter((r) => r.needsApproval);

  const attentionItems = deriveAttentionItems({
    artifactsNeedingReview: reviewQuery.data ?? [],
    runsNeedingApproval,
    failedPublications: [...publicationFailures, ...setupRequiredPublications],
    unknownPublications,
  });

  // Merge legacy queue-today posts with canonical occurrences-today, sorted by time.
  type ScheduleRow =
    | { source: "post"; time: string; post: PostWithTweets }
    | { source: "occurrence"; time: string; occurrence: OccurrenceRow };
  const scheduleRows: ScheduleRow[] = [
    ...(queuePostsQuery.data ?? [])
      .filter((p) => p.scheduledAt)
      .map((post): ScheduleRow => ({ source: "post", time: post.scheduledAt as unknown as string, post })),
    ...(occurrencesQuery.data ?? []).map(
      (occurrence): ScheduleRow => ({ source: "occurrence", time: occurrence.occurrenceTime, occurrence }),
    ),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const scheduleSectionError = queuePostsQuery.isError && occurrencesQuery.isError;

  // Recent activity: bounded, composed from existing timestamped rows — no invented event feed.
  type ActivityRow = { id: string; time: string; label: string };
  const activityRows: ActivityRow[] = [
    ...(recentArtifactsQuery.data ?? []).map((a): ActivityRow => ({
      id: `artifact-${a.id}`,
      time: a.createdAt,
      label: `Generated a ${a.channel} draft`,
    })),
    ...(publicationsQuery.data ?? []).slice(0, 5).map((p): ActivityRow => ({
      id: `publication-${p.id}`,
      time: p.createdAt,
      label:
        p.state === "published"
          ? `Published to ${p.channel}`
          : p.state === "failed"
            ? `${p.channel} publication failed`
            : `${p.channel} publication ${p.state}`,
    })),
  ]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 8);
  const activityError = recentArtifactsQuery.isError && publicationsQuery.isError;

  return (
    <div className="flex flex-col h-full overflow-y-auto" data-testid="page-today">
      <PageHeader
        title="Today"
        description="What needs your attention right now"
        testId="page-header-today"
        titleTestId="text-page-title"
        action={
          <Button asChild size="sm" className="gap-1.5" data-testid="button-today-create">
            <Link href="/create">
              <Sparkles className="h-3.5 w-3.5" />
              Create content
            </Link>
          </Button>
        }
      />

      <div className="p-6 space-y-6 max-w-6xl w-full mx-auto">
        {/* Attention */}
        <section className="space-y-3" data-testid="section-attention">
          <h2 className="text-base font-medium tracking-tight">Attention</h2>
          {attentionLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : attentionSourcesErrored && attentionItems.length === 0 ? (
            <ErrorState
              title="Couldn't load attention status"
              description="Some server-backed attention sources could not be checked. No clean status is being inferred."
              onRetry={() => {
                void reviewQuery.refetch();
                void runsQuery.refetch();
                void publicationsQuery.refetch();
              }}
            />
          ) : attentionItems.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="You're all caught up"
              description="Nothing needs your attention right now."
              testId="empty-attention"
              action={
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="outline"><Link href="/create">Create something</Link></Button>
                  <Button asChild size="sm" variant="outline"><Link href="/sources">Research a topic</Link></Button>
                </div>
              }
            />
          ) : (
            <div className="space-y-2" data-testid="list-attention">
              {attentionItems.map((item, index) => (
                <Card
                  key={item.id}
                  className="p-4 flex items-center justify-between gap-4 rise-in"
                  style={{ animationDelay: `${Math.min(index * 40, 200)}ms` }}
                  data-testid={`card-attention-${item.id}`}
                  data-attention-kind={item.kind}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <AlertTriangle
                      className={`h-4 w-4 mt-0.5 shrink-0 ${item.severity === "action_required" ? "text-primary" : "text-amber-600 dark:text-amber-400"}`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1">{item.subtitle}</p>
                    </div>
                  </div>
                  <Button asChild size="sm" variant={item.severity === "action_required" ? "default" : "outline"} className="shrink-0 text-xs">
                    <Link href={item.actionUrl}>{item.actionLabel}</Link>
                  </Button>
                </Card>
              ))}
              {attentionSourcesErrored && (
                <p className="text-[11px] text-muted-foreground">Some attention sources couldn't be checked — this list may be incomplete.</p>
              )}
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Today's Schedule */}
          <section className="space-y-3" data-testid="section-today-schedule">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium tracking-tight">Today's Schedule</h2>
              <Button asChild variant="outline" size="sm" className="text-xs h-8"><Link href="/schedule">Manage</Link></Button>
            </div>
            {queuePostsQuery.isLoading || occurrencesQuery.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : scheduleSectionError ? (
              <ErrorState
                title="Couldn't load today's schedule"
                description="Something went wrong while loading what's due today."
                onRetry={() => {
                  void queuePostsQuery.refetch();
                  void occurrencesQuery.refetch();
                }}
              />
            ) : scheduleRows.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="Nothing scheduled for today"
                description="Draft a new post or let the Agent build content."
                action={<Button asChild size="sm" variant="outline"><Link href="/create">Draft a post</Link></Button>}
              />
            ) : (
              <div className="space-y-2">
                {scheduleRows.map((row) =>
                  row.source === "post" ? (
                    <Card key={`post-${row.post.id}`} className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground">{formatTimeOfDay(row.time)}</span>
                          <PlatformBadge platform={row.post.targetPlatform} />
                          <StatusBadge status={row.post.status || "draft"} />
                        </div>
                        <p className="text-sm text-foreground line-clamp-1">{row.post.tweets?.[0]?.content || "Empty post"}</p>
                      </div>
                      <Button asChild variant="ghost" size="sm" className="shrink-0 text-xs"><Link href="/schedule">View</Link></Button>
                    </Card>
                  ) : (
                    <Card key={`occ-${row.occurrence.id}`} className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground">{formatTimeOfDay(row.time)}</span>
                          <span className="text-[11px] font-medium text-muted-foreground capitalize">{row.occurrence.channel}</span>
                          <StatusBadge status={row.occurrence.status} />
                        </div>
                        <p className="text-sm text-foreground line-clamp-1">{previewArtifactPayload(row.occurrence.artifact.payload) || "(empty)"}</p>
                      </div>
                      <Button asChild variant="ghost" size="sm" className="shrink-0 text-xs">
                        <Link href="/schedule?tab=publications">View</Link>
                      </Button>
                    </Card>
                  ),
                )}
              </div>
            )}
          </section>

          {/* Recent Activity */}
          <section className="space-y-3" data-testid="section-recent-activity">
            <h2 className="text-base font-medium tracking-tight">Recent Activity</h2>
            {recentArtifactsQuery.isLoading && publicationsQuery.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : activityError ? (
              <ErrorState
                title="Couldn't load recent activity"
                description="Something went wrong while loading what ContentForge has been doing."
                onRetry={() => {
                  void recentArtifactsQuery.refetch();
                  void publicationsQuery.refetch();
                }}
              />
            ) : activityRows.length === 0 ? (
              <EmptyState icon={Sparkle} title="Nothing yet" description="Activity will show up here as you create and publish content." />
            ) : (
              <div className="space-y-1.5">
                {activityRows.map((row) => (
                  <div key={row.id} className="flex items-center gap-2 text-xs py-1.5 border-b last:border-0">
                    <span className="text-muted-foreground shrink-0 w-14">{formatRelativeTime(row.time)}</span>
                    <span className="text-foreground truncate">{row.label}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Quick Actions */}
        <section className="space-y-3" data-testid="today-quick-actions">
          <h2 className="text-base font-medium tracking-tight">Quick Actions</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Button asChild variant="outline" className="h-auto flex-col items-start gap-1 p-4" data-testid="button-quick-action-create">
              <Link href="/create">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Create</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto flex-col items-start gap-1 p-4" data-testid="button-quick-action-sources">
              <Link href="/sources">
                <Database className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Research</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto flex-col items-start gap-1 p-4" data-testid="button-quick-action-agent">
              <Link href="/agent">
                <Bot className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Ask Agent</span>
              </Link>
            </Button>
            <Button
              variant="outline"
              className="h-auto flex-col items-start gap-1 p-4"
              data-testid="button-quick-action-capture"
              onClick={() => window.dispatchEvent(new Event("contentforge:open-quick-capture"))}
            >
              <Clock className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Capture a link</span>
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
