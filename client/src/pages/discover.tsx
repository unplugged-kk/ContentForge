import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Compass, Loader2, RefreshCw, ExternalLink, TrendingUp, Bookmark, BookmarkCheck, Sparkles, Filter, Zap, Flame, Star, Rss, ShieldCheck, Radio } from "lucide-react";
import type { DiscoveredIdea, RssSource, MonitoredAccount } from "@shared/schema";
import { X_OFFICIAL_DOCS } from "@shared/xDeveloperRisk";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const categoryLabels: Record<string, string> = {
  ai: "AI / ML",
  devops: "DevOps",
  mlops: "MLOps",
  tech: "Tech",
  leadership: "Leadership",
  system_design: "System Design",
  ai_research: "AI Research",
  all: "All Categories",
};

const sourceTypeLabels: Record<string, string> = {
  hackernews: "Hacker News",
  reddit: "Reddit",
  rss: "RSS Feed",
  github: "GitHub",
  arxiv: "ArXiv",
  trends: "Google Trends",
  x_account: "X Account",
};

export type MarketPulsePayload = {
  breakingTopics: string[];
  trendingKeywords: string[];
  boostTopics: string[];
  xAlgorithmContext: string;
  fetchedAt: string;
};

export default function DiscoverPage() {
  const { toast } = useToast();
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [showSources, setShowSources] = useState(false);

  const { data: ideas = [], isLoading: ideasLoading } = useQuery<DiscoveredIdea[]>({
    queryKey: ["/api/discover/ideas"],
  });

  const { data: pulse, isLoading: pulseLoading } = useQuery<MarketPulsePayload>({
    queryKey: ["/api/autopilot/market-pulse"],
    staleTime: 1000 * 60 * 5,
  });

  const { data: rssSources = [] } = useQuery<RssSource[]>({ queryKey: ["/api/discover/rss-sources"] });
  const { data: accounts = [] } = useQuery<MonitoredAccount[]>({ queryKey: ["/api/discover/monitored-accounts"] });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/discover/refresh", {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/discover/ideas"] });
      toast({ title: `Discovery complete`, description: `Found ${data.newIdeasCount || 0} new ideas` });
    },
    onError: (err: any) => {
      toast({ title: "Discovery failed", description: err.message, variant: "destructive" });
    },
  });

  const bookmarkMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/discover/ideas/${id}/bookmark`, {});
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/discover/ideas"] }),
  });

  const expandMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/discover/ideas/${id}/expand`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
      toast({ title: "Draft created from idea" });
    },
  });

  const filteredIdeas = ideas.filter((idea) => {
    if (filterCategory !== "all" && idea.category !== filterCategory) return false;
    if (filterSource !== "all" && idea.sourceType !== filterSource) return false;
    return true;
  }).sort((a, b) => Number(b.viralScore || 0) - Number(a.viralScore || 0));

  return (
    <div className="flex flex-col h-full overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-discover-title">Idea Discovery</h1>
          <p className="text-sm text-muted-foreground">AI-powered scanning of HN, Reddit, RSS feeds & more. Ranked by viral potential.</p>
          <Alert className="mt-3 max-w-2xl" data-testid="alert-discover-compliance">
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle className="text-sm">Multi-source research</AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">
              This feed pulls from many places (RSS, HN, Reddit, GitHub, ArXiv, …) — not just X. You use it to spot topics, then AI and your edits shape posts for reach and engagement.{" "}
              <strong className="text-foreground">When content lives on X,</strong> we use the{" "}
              <a href={X_OFFICIAL_DOCS.developerGuidelines} target="_blank" rel="noopener noreferrer" className="underline font-medium text-foreground">
                official X API
              </a>{" "}
              (never scraping x.com). Details: <code className="rounded bg-muted px-1">docs/X_API_COMPLIANCE_AND_RISK.md</code>.
            </AlertDescription>
          </Alert>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setShowSources(!showSources)} data-testid="button-toggle-sources">
            <Rss className="h-3 w-3 mr-1" />
            Sources ({rssSources.length + accounts.length})
          </Button>
          <Button onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending} data-testid="button-refresh-discover">
            {refreshMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Scan Now
          </Button>
        </div>
      </div>

      <Card data-testid="card-market-pulse">
        <CardHeader className="pb-2 flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Radio className="h-4 w-4" />
            Today&apos;s market pulse
          </CardTitle>
          <div className="flex items-center gap-2">
            {pulse?.fetchedAt && (
              <span className="text-[10px] text-muted-foreground" data-testid="text-pulse-fetched-at">
                Updated {format(new Date(pulse.fetchedAt), "MMM d, HH:mm")}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={pulseLoading}
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/autopilot/market-pulse"] })}
              data-testid="button-refresh-market-pulse"
            >
              {pulseLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <p className="text-muted-foreground">
            Hacker News front page + Google Trends RSS (US, India, UK). These signals feed the morning briefing so ideas tied to what&apos;s hot rank higher.
          </p>
          {pulseLoading && !pulse ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : pulse ? (
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="font-medium text-foreground mb-2 flex items-center gap-1">
                  <Flame className="h-3.5 w-3.5 text-orange-400" /> Niche &amp; breaking
                </p>
                <ul className="space-y-1.5 text-muted-foreground max-h-44 overflow-y-auto" data-testid="list-pulse-breaking">
                  {pulse.breakingTopics.slice(0, 12).map((t, i) => (
                    <li key={i} className="line-clamp-2 border-l-2 border-orange-500/40 pl-2">{t}</li>
                  ))}
                  {pulse.breakingTopics.length === 0 && (
                    <li className="italic text-muted-foreground">No DevOps/AI keyword overlap on titles yet — check trending keywords.</li>
                  )}
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground mb-2 flex items-center gap-1">
                  <TrendingUp className="h-3.5 w-3.5" /> Trending keywords
                </p>
                <div className="flex flex-wrap gap-1 max-h-44 overflow-y-auto" data-testid="list-pulse-keywords">
                  {pulse.trendingKeywords.slice(0, 28).map((k) => (
                    <Badge key={k} variant="secondary" className="text-[10px] font-normal">
                      {k}
                    </Badge>
                  ))}
                  {pulse.trendingKeywords.length === 0 && (
                    <span className="italic text-muted-foreground">No repeated terms extracted.</span>
                  )}
                </div>
              </div>
              <div>
                <p className="font-medium text-foreground mb-2">Score boost today</p>
                <ul className="space-y-1 text-muted-foreground max-h-44 overflow-y-auto" data-testid="list-pulse-boost">
                  {pulse.boostTopics.slice(0, 8).map((t, i) => (
                    <li key={i} className="line-clamp-2">• {t}</li>
                  ))}
                  {pulse.boostTopics.length === 0 && (
                    <li className="italic text-muted-foreground">Same as breaking when niche matches exist.</li>
                  )}
                </ul>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {showSources && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Rss className="h-4 w-4" /> RSS Feeds</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rssSources.length === 0 ? (
                <p className="text-xs text-muted-foreground">No RSS sources configured</p>
              ) : rssSources.map((src) => (
                <div key={src.id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-[10px] shrink-0">{src.category}</Badge>
                    <span className="truncate">{src.name}</span>
                  </div>
                  <Badge variant={src.isActive ? "default" : "secondary"} className="text-[10px] shrink-0">
                    {src.isActive ? "Active" : "Paused"}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Star className="h-4 w-4" /> Monitored Accounts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {accounts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No accounts monitored</p>
              ) : accounts.map((acc) => (
                <div key={acc.id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-[10px] shrink-0">{acc.category}</Badge>
                    <span>@{acc.username}</span>
                    {acc.displayName && <span className="text-muted-foreground text-xs">({acc.displayName})</span>}
                  </div>
                  <Badge variant="secondary" className="text-[10px] shrink-0">{acc.platform}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[160px]" data-testid="select-filter-category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {Object.entries(categoryLabels).filter(([k]) => k !== "all").map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterSource} onValueChange={setFilterSource}>
          <SelectTrigger className="w-[160px]" data-testid="select-filter-source"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {Object.entries(sourceTypeLabels).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{filteredIdeas.length} ideas</span>
      </div>

      {refreshMutation.isPending && (
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium">Scanning sources...</p>
              <p className="text-xs text-muted-foreground">Fetching HN, Reddit, RSS feeds and ranking by viral potential</p>
            </div>
          </CardContent>
        </Card>
      )}

      {ideasLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredIdeas.length === 0 ? (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center gap-3">
            <Compass className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">No ideas discovered yet. Click "Scan Now" to start.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredIdeas.map((idea, index) => {
            const viralScore = Number(idea.viralScore || 0);
            const scoreColor = viralScore >= 8 ? "text-green-400" : viralScore >= 6 ? "text-yellow-400" : "text-muted-foreground";
            return (
              <Card key={idea.id} data-testid={`card-idea-${idea.id}`}>
                <CardContent className="flex items-start gap-4 py-4">
                  <div className="flex flex-col items-center gap-1 shrink-0 w-12">
                    <span className={`text-lg font-bold ${scoreColor}`}>{viralScore.toFixed(1)}</span>
                    <div className="flex items-center gap-0.5">
                      {viralScore >= 8 ? <Flame className="h-3 w-3 text-orange-400" /> : viralScore >= 6 ? <TrendingUp className="h-3 w-3 text-yellow-400" /> : <Star className="h-3 w-3 text-muted-foreground" />}
                    </div>
                    <span className="text-[9px] text-muted-foreground">#{index + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-medium line-clamp-2">{idea.title}</h3>
                      <div className="flex items-center gap-1 shrink-0">
                        <Badge variant="secondary" className="text-[10px]">{sourceTypeLabels[idea.sourceType || "rss"] || idea.sourceType}</Badge>
                        {idea.category && <Badge variant="outline" className="text-[10px]">{categoryLabels[idea.category] || idea.category}</Badge>}
                      </div>
                    </div>
                    {idea.summary && <p className="text-xs text-muted-foreground line-clamp-2">{idea.summary}</p>}
                    {idea.contentAngles && (idea.contentAngles as string[]).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(idea.contentAngles as string[]).slice(0, 3).map((angle, i) => (
                          <Badge key={i} variant="outline" className="text-[10px]">
                            <Zap className="h-2 w-2 mr-0.5" />
                            {angle}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      {idea.sourceUrl && (
                        <a href={idea.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary flex items-center gap-0.5">
                          <ExternalLink className="h-3 w-3" /> Source
                        </a>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => bookmarkMutation.mutate(idea.id)} data-testid={`button-bookmark-idea-${idea.id}`}>
                        {idea.isBookmarked ? <BookmarkCheck className="h-3 w-3 text-primary" /> : <Bookmark className="h-3 w-3" />}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => expandMutation.mutate(idea.id)} disabled={expandMutation.isPending} data-testid={`button-expand-idea-${idea.id}`}>
                        {expandMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                        Create Draft
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
