import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, TrendingUp, Eye, Heart, MessageCircle, Repeat2, Bookmark } from "lucide-react";
import { SiX, SiThreads } from "react-icons/si";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from "recharts";
import { CONTENT_PILLARS } from "@/lib/constants";
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

function StatCard({ label, value, icon: Icon, trend }: {
  label: string; value: string | number; icon: any; trend?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="text-2xl font-semibold tabular-nums" data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
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

export default function AnalyticsPage() {
  const { data: summary, isLoading } = useQuery<AnalyticsSummary>({
    queryKey: ["/api/analytics/summary"],
  });

  const { data: insights } = useQuery<InsightsPayload>({
    queryKey: ["/api/analytics/insights"],
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b">
          <h1 className="text-lg font-semibold">Analytics</h1>
          <p className="text-xs text-muted-foreground">Track your content performance</p>
        </div>
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
            <Card className="p-4"><Skeleton className="h-48" /></Card>
            <Card className="p-4"><Skeleton className="h-48" /></Card>
          </div>
        </div>
      </div>
    );
  }

  const stats = summary || {
    totalPosts: 0, totalImpressions: 0, totalLikes: 0, totalReplies: 0,
    totalRetweets: 0, totalBookmarks: 0,
    byPillar: [], byPlatform: [], topPosts: [], recentUsage: [],
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <h1 className="text-lg font-semibold" data-testid="text-analytics-title">Analytics</h1>
        <p className="text-xs text-muted-foreground">Track your content performance</p>
      </div>
      <div className="flex-1 overflow-auto p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Total Posts" value={stats.totalPosts} icon={BarChart3} />
          <StatCard label="Impressions" value={stats.totalImpressions} icon={Eye} />
          <StatCard label="Likes" value={stats.totalLikes} icon={Heart} />
          <StatCard label="Replies" value={stats.totalReplies} icon={MessageCircle} />
        </div>

        {insights ? (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card className="p-4 xl:col-span-3">
              <h3 className="text-sm font-medium mb-3">Top performing posts</h3>
              <ul data-testid="list-top-posts" className="space-y-2 max-h-56 overflow-y-auto">
                {insights.topPosts.length === 0 ? (
                  <li className="text-xs text-muted-foreground">No posted content with analytics yet.</li>
                ) : (
                  insights.topPosts.map((p) => (
                    <li key={p.postId} className="text-xs border-b border-border/60 pb-2">
                      <span className="font-medium mr-2">#{p.postId}</span>
                      <span className="text-muted-foreground">score {p.score}</span>
                      <p className="mt-1 line-clamp-2">{p.preview}</p>
                    </li>
                  ))
                )}
              </ul>
            </Card>
            <Card className="p-4 xl:col-span-2">
              <h3 className="text-sm font-medium mb-3">Best time to post (UTC hour)</h3>
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
              <h3 className="text-sm font-medium mb-3">Pillar performance</h3>
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

        <Tabs defaultValue="pillars">
          <TabsList>
            <TabsTrigger value="pillars" data-testid="tab-pillars">By Pillar</TabsTrigger>
            <TabsTrigger value="platform" data-testid="tab-platform">By Platform</TabsTrigger>
            <TabsTrigger value="usage" data-testid="tab-usage">AI Usage</TabsTrigger>
          </TabsList>

          <TabsContent value="pillars" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="p-4">
                <h3 className="text-sm font-medium mb-4">Posts by Content Pillar</h3>
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
                    No data yet
                  </div>
                )}
              </Card>
              <Card className="p-4">
                <h3 className="text-sm font-medium mb-4">Impressions by Pillar</h3>
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
                    No data yet
                  </div>
                )}
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="platform" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="p-4">
                <h3 className="text-sm font-medium mb-4">Platform Breakdown</h3>
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
                    No data yet
                  </div>
                )}
              </Card>
              <Card className="p-4">
                <h3 className="text-sm font-medium mb-4">Engagement Summary</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Repeat2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Retweets/Reposts</span>
                    </div>
                    <span className="text-sm font-medium tabular-nums">{stats.totalRetweets.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bookmark className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Bookmarks</span>
                    </div>
                    <span className="text-sm font-medium tabular-nums">{stats.totalBookmarks.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Heart className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Likes</span>
                    </div>
                    <span className="text-sm font-medium tabular-nums">{stats.totalLikes.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageCircle className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Replies</span>
                    </div>
                    <span className="text-sm font-medium tabular-nums">{stats.totalReplies.toLocaleString()}</span>
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="usage" className="mt-4">
            <Card className="p-4">
              <h3 className="text-sm font-medium mb-4">AI Token Usage</h3>
              {stats.recentUsage.length > 0 ? (
                <div className="space-y-2">
                  {stats.recentUsage.slice(0, 10).map((log) => (
                    <div key={log.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">{log.model}</Badge>
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

        {stats.topPosts.length > 0 && (
          <Card className="p-4">
            <h3 className="text-sm font-medium mb-3">Top Performing Posts</h3>
            <div className="space-y-2">
              {stats.topPosts.map((post) => (
                <div key={post.id} className="flex items-start justify-between gap-3 py-2 border-b last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{post.tweets?.[0]?.content || "Untitled"}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Badge variant="outline" className="text-[10px]">{post.postType}</Badge>
                      {post.targetPlatform === "x" && <SiX className="h-3 w-3 text-muted-foreground" />}
                      {post.targetPlatform === "threads" && <SiThreads className="h-3 w-3 text-muted-foreground" />}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                    <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{(post.analytics?.[0]?.impressions || 0).toLocaleString()}</span>
                    <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{(post.analytics?.[0]?.likes || 0).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
