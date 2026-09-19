import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui-shared/page-header";
import { EmptyState } from "@/components/ui-shared/empty-state";
import { ErrorState } from "@/components/ui-shared/error-state";
import { StatusBadge } from "@/components/ui-shared/status-badge";
import { Sparkles, Calendar, Database, Bot, Clock, ArrowRight, Sun, Info } from "lucide-react";
import { SiX, SiThreads } from "react-icons/si";
import { format } from "date-fns";
import type { Post, Tweet } from "@shared/schema";

interface PostWithTweets extends Post {
  tweets: Tweet[];
}

function PlatformBadge({ platform }: { platform?: string | null }) {
  if (platform === "x") return <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><SiX className="h-2.5 w-2.5" /> X</span>;
  if (platform === "threads") return <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><SiThreads className="h-2.5 w-2.5" /> Threads</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
      <SiX className="h-2.5 w-2.5" />
      <SiThreads className="h-2.5 w-2.5" />
    </span>
  );
}

export default function TodayPage() {
  const { data: queuePosts = [], isLoading, isError, refetch } = useQuery<PostWithTweets[]>({
    queryKey: ["/api/posts/queue/today"],
  });

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
        {/* Quick Launchpad */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="today-quick-actions">
          <Card className="hover:border-primary/50 transition-colors">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Create</CardTitle>
                <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                </div>
              </div>
              <CardDescription className="text-xs">Post, thread, hooks, carousel</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-1">
              <Button asChild variant="ghost" size="sm" className="w-full justify-between px-2 h-8 text-xs">
                <Link href="/create">
                  Launch Create <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:border-primary/50 transition-colors">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Schedule</CardTitle>
                <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                  <Calendar className="h-3.5 w-3.5" />
                </div>
              </div>
              <CardDescription className="text-xs">Queue and content calendar</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-1">
              <Button asChild variant="ghost" size="sm" className="w-full justify-between px-2 h-8 text-xs">
                <Link href="/schedule">
                  View Schedule <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:border-primary/50 transition-colors">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Sources</CardTitle>
                <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                  <Database className="h-3.5 w-3.5" />
                </div>
              </div>
              <CardDescription className="text-xs">Ideas, vault, and research</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-1">
              <Button asChild variant="ghost" size="sm" className="w-full justify-between px-2 h-8 text-xs">
                <Link href="/sources">
                  Explore Sources <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:border-primary/50 transition-colors">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Agent</CardTitle>
                <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                  <Bot className="h-3.5 w-3.5" />
                </div>
              </div>
              <CardDescription className="text-xs">Autonomous workspace</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-1">
              <Button asChild variant="ghost" size="sm" className="w-full justify-between px-2 h-8 text-xs">
                <Link href="/agent">
                  Open Agent <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Due Today Section (Truthful live data from /api/posts/queue/today) */}
        <div className="space-y-3" data-testid="section-today-queue">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-base font-medium tracking-tight">Today's Publications</h2>
              <p className="text-xs text-muted-foreground">Items queued and scheduled for publication today</p>
            </div>
            <Button asChild variant="outline" size="sm" className="text-xs h-8">
              <Link href="/schedule">Manage Queue</Link>
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : isError ? (
            <ErrorState
              title="Couldn't load today's publications"
              description="Failed to fetch scheduled posts for today."
              onRetry={() => refetch()}
            />
          ) : queuePosts.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No publications scheduled for today"
              description="Your queue for today is currently clear. Draft a new post or let the Agent build content."
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href="/create">Draft a post</Link>
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {queuePosts.map((post) => {
                const firstTweet = post.tweets?.[0]?.content || "Empty post";
                const isThread = (post.tweets?.length || 0) > 1;
                return (
                  <Card key={post.id} className="p-4 flex items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <PlatformBadge platform={post.targetPlatform} />
                        {isThread && (
                          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-mono">
                            {post.tweets.length} tweets
                          </span>
                        )}
                        <StatusBadge status={post.status || "draft"} />
                      </div>
                      <p className="text-sm font-normal text-foreground line-clamp-2">{firstTweet}</p>
                      {post.scheduledAt && (
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(post.scheduledAt), "h:mm a")}
                        </p>
                      )}
                    </div>
                    <Button asChild variant="ghost" size="sm" className="shrink-0 text-xs">
                      <Link href="/schedule">View</Link>
                    </Button>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Phase 28.2F Roadmap Card: Restrained, honest expectation */}
        <Card className="border-dashed bg-muted/30">
          <CardContent className="p-4 flex items-start gap-3">
            <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <p className="font-medium text-foreground">Morning Briefing & Action Center</p>
              <p className="text-muted-foreground leading-relaxed">
                Phase 28.2F will establish the comprehensive morning briefing, proactive alerts,
                and attention loop. In this Phase (28.2B), Today anchors the canonical product shell
                and provides immediate access to live publications.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
