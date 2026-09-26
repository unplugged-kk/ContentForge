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
  if (!platform) return <span className="text-xs font-medium text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
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
  // One artifacts query. Today previously fetched /api/artifacts twice under two
  // different react-query keys on a single mount (D1 duplicate keys); the review
  // subset is derived from the same window instead of a second request.
  const artifactsQuery = useQuery<ArtifactLike[]>({ queryKey: ["/api/artifacts?limit=30"] });
  const runsQuery = useQuery<{ runs: RunLike[] }>({ queryKey: ["/api/agent/runs?limit=10"] });
  // One publications key, shared in intent with publications-view (D1 duplicate keys).
  const publicationsQuery = useQuery<PublicationLike[]>({ queryKey: ["/api/publications?limit=30"] });
  // Failures are deliberately NOT limited to the newest window: the server already
  // supports ?state= (server/content/routes.ts:1192). Without this a failure older
  // than the newest 20 was silently dropped from the one surface that promises
  // "what needs your attention right now" (D1 HIGH).
  const failedPublicationsQuery = useQuery<PublicationLike[]>({
    queryKey: ["/api/publications?state=failed&limit=50"],
  });

  const from = startOfToday().toISOString();
  const to = endOfToday().toISOString();
  const occurrencesQuery = useQuery<OccurrenceRow[]>({
    queryKey: [`/api/schedule-occurrences?from=${from}&to=${to}&limit=50`],
  });
  const queuePostsQuery = useQuery<PostWithTweets[]>({ queryKey: ["/api/posts/queue/today"] });

  const attentionSourcesErrored = [
    artifactsQuery.isError,
    runsQuery.isError,
    publicationsQuery.isError,
    failedPublicationsQuery.isError,
  ].some(Boolean);
  const attentionLoading =
    artifactsQuery.isLoading || runsQuery.isLoading || publicationsQuery.isLoading || failedPublicationsQuery.isLoading;
  const reviewArtifacts = (artifactsQuery.data ?? []).filter(
    (artifact) => (artifact as ArtifactLike & { readiness?: string }).readiness === "in_review",
  );
  const failedPublications = failedPublicationsQuery.data ?? [];
  // An unconfirmed publication is stored as `state: "failed"` with
  // `result.outcome: "unknown"` (server/content/publication.ts outcome classification),
  // so the state-only failure read returns it while the outcome read lists it too — the
  // same row, twice. Partition by publication id, using isSetupRequiredPublication as the
  // model, so it renders exactly once as unknown: never as a failure, never dropped.
  // Unknowns are collected from both reads so a row past the outcome window is not lost.
  const unknownById = new Map<number, PublicationLike>();
  for (const publication of publicationsQuery.data ?? []) {
    if (publication.result?.outcome === "unknown") unknownById.set(publication.id, publication);
  }
  for (const publication of failedPublications) {
    if (publication.result?.outcome === "unknown") unknownById.set(publication.id, publication);
  }
  const unknownPublications = Array.from(unknownById.values());
  const unknownPublicationIds = new Set(unknownPublications.map((publication) => publication.id));
  const setupRequiredPublications = failedPublications.filter(isSetupRequiredPublication);
  const publicationFailures = failedPublications.filter(
    (publication) => !unknownPublicationIds.has(publication.id) && !isSetupRequiredPublication(publication),
  );
  const runsNeedingApproval = (runsQuery.data?.runs ?? []).filter((r) => r.needsApproval);
  // Honest window disclosure: the failure read is capped by the server limit.
  const publicationsWindowTruncated = failedPublications.length >= 50;

  const attentionItems = deriveAttentionItems({
    artifactsNeedingReview: reviewArtifacts,
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
  // A single failing leg leaves the other leg's rows in place, so the combined
  // section is disclosed as possibly incomplete rather than shown as whole (D1).
  const scheduleSectionErrored = queuePostsQuery.isError || occurrencesQuery.isError;
  const scheduleSectionError = queuePostsQuery.isError && occurrencesQuery.isError;

  // Recent activity: bounded, composed from existing timestamped rows — no invented
  // event feed. Failures are separated from routine work so an hour-old failure is
  // not crowded out of the cap by routine generation (WT-08).
  type ActivityRow = { id: string; time: string; label: string; isFailure: boolean };
  const activityRows: ActivityRow[] = [
    ...(artifactsQuery.data ?? []).map((a): ActivityRow => ({
      id: `artifact-${a.id}`,
      time: a.createdAt,
      label: `Generated a ${a.channel} draft`,
      isFailure: false,
    })),
    ...(publicationsQuery.data ?? []).slice(0, 5).map((p): ActivityRow => ({
      id: `publication-${p.id}`,
      time: p.createdAt,
      label:
        p.state === "published"
          ? `Published to ${p.channel}`
          : p.state === "failed"
            ? `${p.channel} publication failed`
            : p.result?.outcome === "unknown"
              ? `${p.channel} publication needs verification`
              : `${p.channel} publication ${p.state}`,
      isFailure: p.state === "failed" || p.result?.outcome === "unknown",
    })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  const activityFailures = activityRows.filter((row) => row.isFailure).slice(0, 8);
  const activityRoutine = activityRows.filter((row) => !row.isFailure).slice(0, Math.max(0, 8 - activityFailures.length));
  const activityRendered = activityFailures.length + activityRoutine.length;
  const activityError = artifactsQuery.isError && publicationsQuery.isError;

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
                void artifactsQuery.refetch();
                void runsQuery.refetch();
                void publicationsQuery.refetch();
                void failedPublicationsQuery.refetch();
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
                      className={`h-4 w-4 mt-0.5 shrink-0 ${item.severity === "action_required" ? "text-primary" : "text-warning"}`}
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
              {(attentionSourcesErrored || publicationsWindowTruncated) && (
                <p className="text-xs text-muted-foreground">
                  {attentionSourcesErrored ? "Some attention sources couldn't be checked — this list may be incomplete." : ""}
                  {attentionSourcesErrored && publicationsWindowTruncated ? " " : ""}
                  {publicationsWindowTruncated ? "Showing the 50 most recent failures; older ones may not be listed." : ""}
                </p>
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
                          <span className="text-xs font-medium text-muted-foreground capitalize">{row.occurrence.channel}</span>
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
                {scheduleSectionErrored && (
                  <p className="text-xs text-muted-foreground">
                    Some of today's schedule couldn't be checked — this list may be incomplete.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Recent Activity */}
          <section className="space-y-3" data-testid="section-recent-activity">
            <h2 className="text-base font-medium tracking-tight">Recent Activity</h2>
            {artifactsQuery.isLoading && publicationsQuery.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : activityError ? (
              <ErrorState
                title="Couldn't load recent activity"
                description="Something went wrong while loading what ContentForge has been doing."
                onRetry={() => {
                  void artifactsQuery.refetch();
                  void publicationsQuery.refetch();
                }}
              />
            ) : activityRows.length === 0 ? (
              <EmptyState icon={Sparkle} title="Nothing yet" description="Activity will show up here as you create and publish content." />
            ) : (
              <div className="space-y-3">
                {activityFailures.length > 0 && (
                  <div className="space-y-1.5" data-testid="list-activity-failures">
                    <p className="text-xs font-medium text-warning">Failures</p>
                    {activityFailures.map((row) => (
                      <div key={row.id} className="flex items-center gap-2 text-xs py-1.5 border-b last:border-0">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                        <span className="text-muted-foreground shrink-0 w-14">{formatRelativeTime(row.time)}</span>
                        <span className="text-foreground truncate">{row.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                {activityRoutine.length > 0 && (
                  <div className="space-y-1.5" data-testid="list-activity-routine">
                    <p className="text-xs font-medium text-muted-foreground">
                      {activityFailures.length > 0 ? "Routine" : "Recent"}
                    </p>
                    {activityRoutine.map((row) => (
                      <div key={row.id} className="flex items-center gap-2 text-xs py-1.5 border-b last:border-0">
                        <span className="text-muted-foreground shrink-0 w-14">{formatRelativeTime(row.time)}</span>
                        <span className="text-foreground truncate">{row.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                {activityRows.length > activityRendered && (
                  <p className="text-xs text-muted-foreground">Showing the {activityRendered} most recent updates.</p>
                )}
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
