import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState } from "@/components/ui-shared/error-state";
import { EmptyState } from "@/components/ui-shared/empty-state";
import {
  BarChart3,
  TrendingUp,
  Eye,
  Heart,
  MessageCircle,
  Repeat2,
  Bookmark,
  ExternalLink,
  CheckCircle2,
  HelpCircle,
  Sparkles,
} from "lucide-react";
import { SiX, SiThreads } from "react-icons/si";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  formatMetricValue,
  formatMetricRate,
  formatChannelName,
  formatContentType,
  formatDateWindow,
} from "@/lib/insights-state";
import type { Analytics, Post, Tweet, AiUsageLog } from "@shared/schema";

interface PostWithTweets extends Post {
  tweets: Tweet[];
  analytics?: Analytics[];
}

interface AnalyticsSummary {
  totalPosts: number;
  totalImpressions: number;
  totalLikes: number;
  totalReplies: number;
  totalRetweets: number;
  totalBookmarks: number;
  byPillar: Array<{ pillar: string; color: string; count: number; impressions: number }>;
  byPlatform: Array<{ platform: string; count: number; impressions: number; likes: number }>;
  topPosts: PostWithTweets[];
  recentUsage: AiUsageLog[];
}

interface LearningSummary {
  publishedCount: number;
  successRate: number | null;
  approvalRate: number | null;
  byChannel: Array<{ channel: string; published: number; observedMetrics: number }>;
  byFormat: Array<{ format: string; published: number }>;
  byStory: Array<{ storyId: number; publications: number }>;
  signalCounts: Record<string, number>;
}

function StatCard({
  label,
  value,
  icon: Icon,
  subtitle,
  trend,
}: {
  label: string;
  value: string | number;
  icon: any;
  subtitle?: string;
  trend?: string;
}) {
  return (
    <Card className="p-4 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div
          className="text-2xl font-semibold tabular-nums"
          data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}
        >
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
      </div>
      {subtitle && <p className="text-[10px] text-muted-foreground mt-1.5">{subtitle}</p>}
      {trend && <p className="text-[10px] text-green-500 mt-1">{trend}</p>}
    </Card>
  );
}

const CHART_COLORS = ["#3B82F6", "#8B5CF6", "#06B6D4", "#10B981", "#F59E0B", "#EF4444"];

type InsightsPayload = {
  topPosts: Array<{ postId: number; score: number; preview: string; tweets: string[] }>;
  bestHours: Array<{ hour: number; avgEngagement: number; posts: number }>;
  pillarStats: Array<{ pillarId: number; pillarName: string; posts: number; avgEngagement: number }>;
};

export default function AnalyticsPage({ hideHeader = false }: { hideHeader?: boolean } = {}) {
  const {
    data: summary,
    isLoading,
    isError,
    refetch,
  } = useQuery<AnalyticsSummary>({
    queryKey: ["/api/analytics/summary"],
  });

  const { data: insights } = useQuery<InsightsPayload>({
    queryKey: ["/api/analytics/insights"],
  });

  const { data: learningSummary } = useQuery<LearningSummary>({
    queryKey: ["/api/learning/summary"],
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        {!hideHeader && (
          <div className="p-4 border-b">
            <h1 className="text-lg font-semibold">Analytics</h1>
            <p className="text-xs text-muted-foreground">Track your content performance</p>
          </div>
        )}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-3 w-20 mb-2" />
                <Skeleton className="h-8 w-16" />
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card className="p-4">
              <Skeleton className="h-48" />
            </Card>
            <Card className="p-4">
              <Skeleton className="h-48" />
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col h-full">
        {!hideHeader && (
          <div className="p-4 border-b">
            <h1 className="text-lg font-semibold">Analytics</h1>
            <p className="text-xs text-muted-foreground">Track your content performance</p>
          </div>
        )}
        <ErrorState
          title="Couldn't load performance data"
          description="Something went wrong while loading your performance analytics."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const stats = summary || {
    totalPosts: 0,
    totalImpressions: 0,
    totalLikes: 0,
    totalReplies: 0,
    totalRetweets: 0,
    totalBookmarks: 0,
    byPillar: [],
    byPlatform: [],
    topPosts: [],
    recentUsage: [],
  };

  const hasAnyData =
    stats.totalPosts > 0 ||
    stats.totalImpressions > 0 ||
    (learningSummary && learningSummary.publishedCount > 0);

  return (
    <div className="flex flex-col h-full" data-testid="container-analytics">
      {!hideHeader && (
        <div className="p-4 border-b">
          <h1 className="text-lg font-semibold" data-testid="text-analytics-title">
            Analytics
          </h1>
          <p className="text-xs text-muted-foreground">Track your content performance</p>
        </div>
      )}

      {!hasAnyData ? (
        <div className="p-6">
          <EmptyState
            icon={BarChart3}
            title="No performance data yet"
            description="Publish content to start seeing how it performs across your connected channels."
            action={
              <Button asChild size="sm" data-testid="button-empty-create-content">
                <Link href="/create">Create Content</Link>
              </Button>
            }
            testId="empty-performance-state"
          />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {/* Time window notice */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pb-1">
            <span>Scope: {formatDateWindow("all")}</span>
            <span>Real metrics synced from connected platforms</span>
          </div>

          {/* Primary KPI Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Total Posts"
              value={stats.totalPosts}
              icon={BarChart3}
              subtitle="Published posts"
            />
            <StatCard
              label="Impressions"
              value={stats.totalImpressions}
              icon={Eye}
              subtitle="Total observed views"
            />
            <StatCard
              label="Likes"
              value={stats.totalLikes}
              icon={Heart}
              subtitle="Audience likes"
            />
            <StatCard
              label="Replies"
              value={stats.totalReplies}
              icon={MessageCircle}
              subtitle="Direct audience replies"
            />
          </div>

          {/* Published & Approval Quality Strip from Learning Summary */}
          {learningSummary && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card className="p-3 bg-muted/20">
                <div className="text-xs text-muted-foreground">Total Published Items</div>
                <div className="text-lg font-semibold tabular-nums mt-0.5" data-testid="text-published-count">
                  {learningSummary.publishedCount} items
                </div>
                <p className="text-[10px] text-muted-foreground">All-time across channels</p>
              </Card>
              <Card className="p-3 bg-muted/20">
                <div className="text-xs text-muted-foreground">Draft Approval Rate</div>
                <div className="text-lg font-semibold tabular-nums mt-0.5">
                  {formatMetricRate(learningSummary.approvalRate)}
                </div>
                <p className="text-[10px] text-muted-foreground">Generated drafts approved</p>
              </Card>
              <Card className="p-3 bg-muted/20">
                <div className="text-xs text-muted-foreground">Delivery Success Rate</div>
                <div className="text-lg font-semibold tabular-nums mt-0.5">
                  {formatMetricRate(learningSummary.successRate)}
                </div>
                <p className="text-[10px] text-muted-foreground">Publish dispatch success</p>
              </Card>
            </div>
          )}

          {/* Top Posts & Performance Insights */}
          {insights ? (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <Card className="p-4 xl:col-span-3">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-medium">Top performing content</h2>
                  <span className="text-[11px] text-muted-foreground">
                    Ranked by engagement score (likes, reposts, replies)
                  </span>
                </div>
                <ul data-testid="list-top-posts" className="space-y-3 max-h-64 overflow-y-auto">
                  {insights.topPosts.length === 0 ? (
                    <li className="text-xs text-muted-foreground">No posted content with analytics yet.</li>
                  ) : (
                    insights.topPosts.map((p) => (
                      <li
                        key={p.postId}
                        className="text-xs border-b border-border/60 pb-3 flex items-start justify-between gap-4"
                        data-testid={`row-top-post-${p.postId}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-foreground">Post #{p.postId}</span>
                            <Badge variant="secondary" className="text-[10px]">
                              score: {p.score}
                            </Badge>
                          </div>
                          <p className="line-clamp-2 text-muted-foreground">{p.preview}</p>
                        </div>
                        <Button asChild size="sm" variant="ghost" className="h-7 text-xs shrink-0" data-testid={`button-view-content-${p.postId}`}>
                          <Link href="/today">View content</Link>
                        </Button>
                      </li>
                    ))
                  )}
                </ul>
              </Card>

              <Card className="p-4 xl:col-span-2">
                <h2 className="text-sm font-medium mb-3">Best time to post (UTC hour)</h2>
                <div data-testid="chart-best-hours" className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={insights.bestHours}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="avgEngagement" fill="#3B82F6" name="Avg engagement" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-4 xl:col-span-1">
                <h2 className="text-sm font-medium mb-3">Pillar performance</h2>
                <div data-testid="chart-pillar-stats" className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={insights.pillarStats} margin={{ left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="pillarName" width={100} tick={{ fontSize: 9 }} />
                      <Tooltip />
                      <Bar dataKey="avgEngagement" fill="#8B5CF6" name="Avg engagement" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          ) : null}

          {/* Breakdown Tabs */}
          <Tabs defaultValue="pillars">
            <TabsList>
              <TabsTrigger value="pillars" data-testid="tab-pillars">
                By Pillar
              </TabsTrigger>
              <TabsTrigger value="platform" data-testid="tab-platform">
                By Platform
              </TabsTrigger>
              <TabsTrigger value="usage" data-testid="tab-usage">
                AI Usage
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pillars" className="mt-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card className="p-4">
                  <h2 className="text-sm font-medium mb-4">Posts by Content Pillar</h2>
                  {stats.byPillar.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={stats.byPillar}
                          dataKey="count"
                          nameKey="pillar"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          label={({ pillar, count }) => `${pillar}: ${count}`}
                        >
                          {stats.byPillar.map((entry, i) => (
                            <Cell key={i} fill={entry.color || CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">
                      No pillar data yet
                    </div>
                  )}
                </Card>
                <Card className="p-4">
                  <h2 className="text-sm font-medium mb-4">Impressions by Pillar</h2>
                  {stats.byPillar.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={stats.byPillar}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="pillar" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="impressions" radius={[4, 4, 0, 0]}>
                          {stats.byPillar.map((entry, i) => (
                            <Cell key={i} fill={entry.color || CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">
                      No pillar data yet
                    </div>
                  )}
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="platform" className="mt-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card className="p-4">
                  <h2 className="text-sm font-medium mb-4">Platform Breakdown</h2>
                  {stats.byPlatform.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={stats.byPlatform}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="platform" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#3B82F6" name="Posts" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="likes" fill="#EF4444" name="Likes" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">
                      No platform breakdown data yet
                    </div>
                  )}
                </Card>
                <Card className="p-4">
                  <h2 className="text-sm font-medium mb-4">Engagement Summary</h2>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Repeat2 className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Retweets/Reposts</span>
                      </div>
                      <span className="text-sm font-medium tabular-nums">
                        {stats.totalRetweets.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bookmark className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Bookmarks</span>
                      </div>
                      <span className="text-sm font-medium tabular-nums">
                        {stats.totalBookmarks.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Heart className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Likes</span>
                      </div>
                      <span className="text-sm font-medium tabular-nums">
                        {stats.totalLikes.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MessageCircle className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Replies</span>
                      </div>
                      <span className="text-sm font-medium tabular-nums">
                        {stats.totalReplies.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="usage" className="mt-4">
              <Card className="p-4">
                <h2 className="text-sm font-medium mb-4">AI Token Usage</h2>
                {stats.recentUsage.length > 0 ? (
                  <div className="space-y-2">
                    {stats.recentUsage.slice(0, 10).map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between py-1.5 border-b last:border-0"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {log.model}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{log.feature}</span>
                        </div>
                        <div className="text-xs tabular-nums text-muted-foreground">
                          {log.totalTokens?.toLocaleString()} tokens
                          {log.latencyMs && <span className="ml-2">{log.latencyMs}ms</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
                    No AI usage data yet
                  </div>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
