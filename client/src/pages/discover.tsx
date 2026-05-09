import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Compass, Loader2, RefreshCw, ExternalLink, TrendingUp, Bookmark,
  BookmarkCheck, Sparkles, Filter, Zap, Flame, Star, Rss, ShieldCheck,
  MessageSquare, AlignLeft, FileText, Newspaper, Send, Calendar, Pencil, Trash2,
  CheckCircle2, ChevronRight,
} from "lucide-react";
import type { DiscoveredIdea, RssSource, MonitoredAccount } from "@shared/schema";
import { X_OFFICIAL_DOCS } from "@shared/xDeveloperRisk";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";

const categoryLabels: Record<string, string> = {
  ai: "AI / ML", devops: "DevOps", mlops: "MLOps", tech: "Tech",
  leadership: "Leadership", system_design: "System Design", ai_research: "AI Research",
  kubernetes: "Kubernetes", platform_engineering: "Platform Eng", sre: "SRE",
  finops: "FinOps", security: "Security", iac: "IaC", all: "All Categories",
};

const sourceTypeLabels: Record<string, string> = {
  hackernews: "Hacker News", reddit: "Reddit", rss: "RSS Feed",
  github: "GitHub", arxiv: "ArXiv", x_account: "X Account", trends: "Google Trends",
};

type ContentTypeOption = {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  tweetCount: string;
};

const CONTENT_TYPE_OPTIONS: ContentTypeOption[] = [
  {
    id: "tweet",
    label: "Single Tweet",
    description: "One punchy tweet with a strong hook. Best for hot takes.",
    icon: <MessageSquare className="h-5 w-5" />,
    tweetCount: "1 tweet",
  },
  {
    id: "thread",
    label: "Thread (5–7 tweets)",
    description: "Standard thread with hook + insights + question. High reach.",
    icon: <AlignLeft className="h-5 w-5" />,
    tweetCount: "5–7 tweets",
  },
  {
    id: "long_thread",
    label: "Long Thread (8–12 tweets)",
    description: "Deep dive with tool names, metrics, and real examples.",
    icon: <FileText className="h-5 w-5" />,
    tweetCount: "8–12 tweets",
  },
  {
    id: "article_thread",
    label: "Article Thread (15–20 tweets)",
    description: "Weekend-style deep narrative. Context → analysis → lessons → implications.",
    icon: <Newspaper className="h-5 w-5" />,
    tweetCount: "15–20 tweets",
  },
];

type DraftResult = {
  postId: number;
  postType: string;
  tweetCount: number;
  hashtags: string[];
};

type MarketPulse = {
  breakingTopics: string[];
  trendingKeywords: string[];
  boostTopics: string[];
  fetchedAt: string;
};

export default function DiscoverPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [showSources, setShowSources] = useState(false);
  const [showPulse, setShowPulse] = useState(false);

  // Per-idea loading — tracks which idea IDs are currently generating
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());

  // Dialog state
  const [dialogIdea, setDialogIdea] = useState<DiscoveredIdea | null>(null);
  const [selectedType, setSelectedType] = useState("thread");
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("08:00");

  const { data: ideas = [], isLoading: ideasLoading } = useQuery<DiscoveredIdea[]>({
    queryKey: ["/api/discover/ideas"],
  });
  const { data: rssSources = [] } = useQuery<RssSource[]>({ queryKey: ["/api/discover/rss-sources"] });
  const { data: accounts = [] } = useQuery<MonitoredAccount[]>({ queryKey: ["/api/discover/monitored-accounts"] });
  const { data: pulse } = useQuery<MarketPulse>({
    queryKey: ["/api/autopilot/market-pulse"],
    enabled: showPulse,
    staleTime: 5 * 60 * 1000,
  });

  const autopostMutation = useMutation({
    mutationFn: async (payload: {
      id: number;
      autopost: boolean;
      autopostPlatform?: string;
      autopostTone?: string;
      autopostPostType?: string;
      autopostPillarId?: number | null;
    }) => {
      const res = await apiRequest("PATCH", `/api/discover/rss-sources/${payload.id}/autopost`, payload);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/discover/rss-sources"] }),
    onError: (err: any) => toast({ title: "Autopost update failed", description: err.message, variant: "destructive" }),
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/discover/refresh", {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/discover/ideas"] });
      toast({ title: "Discovery complete", description: `Found ${data.newIdeasCount || 0} new ideas` });
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

  const deleteIdeaMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/discover/ideas/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/discover/ideas"] });
      toast({ title: "Idea deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  function openCreateDialog(idea: DiscoveredIdea) {
    const validTypes = CONTENT_TYPE_OPTIONS.map((o) => o.id);
    const suggested = idea.contentTypeSuggestion || "";
    setSelectedType(validTypes.includes(suggested) ? suggested : "thread");
    setDraftResult(null);
    setShowScheduleForm(false);
    const now = new Date();
    now.setMinutes(now.getMinutes() + 10);
    setScheduleDate(now.toISOString().slice(0, 10));
    setScheduleTime(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
    setDialogIdea(idea);
  }

  async function handleCreateDraft() {
    if (!dialogIdea) return;
    const ideaId = dialogIdea.id;
    setLoadingIds((prev) => new Set(prev).add(ideaId));
    try {
      const res = await apiRequest("POST", `/api/discover/ideas/${ideaId}/expand`, { postType: selectedType });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create draft");
      }
      const data: DraftResult = await res.json();
      setDraftResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/discover/ideas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
    } catch (err: any) {
      toast({ title: "Draft creation failed", description: err.message, variant: "destructive" });
      setDialogIdea(null);
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(ideaId);
        return next;
      });
    }
  }

  async function handlePublishNow() {
    if (!draftResult) return;
    try {
      const res = await apiRequest("POST", `/api/posts/${draftResult.postId}/publish`, {});
      const data = await res.json();
      toast({
        title: data.tweetUrl ? "Posted to X!" : "Published",
        description: data.tweetUrl ? `Live: ${data.tweetUrl}` : "Post is live",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
      setDialogIdea(null);
    } catch (err: any) {
      toast({ title: "Publish failed", description: err.message, variant: "destructive" });
    }
  }

  async function handleScheduleDraft() {
    if (!draftResult) return;
    if (!scheduleDate) {
      toast({ title: "Select a date", variant: "destructive" });
      return;
    }
    try {
      const iso = `${scheduleDate}T${scheduleTime}:00`;
      await apiRequest("PATCH", `/api/posts/${draftResult.postId}/status`, {
        status: "scheduled",
        scheduledAt: iso,
      });
      toast({ title: "Post scheduled", description: `Scheduled for ${new Date(iso).toLocaleString()}` });
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/posts/queue/today"] });
      setDialogIdea(null);
      setDraftResult(null);
      setShowScheduleForm(false);
    } catch (err: any) {
      toast({ title: "Schedule failed", description: err.message, variant: "destructive" });
    }
  }

  const filteredIdeas = ideas
    .filter((idea) => {
      if (filterCategory !== "all" && idea.category !== filterCategory) return false;
      if (filterSource !== "all" && idea.sourceType !== filterSource) return false;
      return true;
    })
    .sort((a, b) => Number(b.viralScore || 0) - Number(a.viralScore || 0));

  return (
    <div className="flex flex-col h-full overflow-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-discover-title">Idea Discovery</h1>
          <p className="text-sm text-muted-foreground">AI-powered scanning of HN, Reddit, RSS &amp; more. Ranked by viral potential.</p>
          <Alert className="mt-3 max-w-2xl" data-testid="alert-discover-compliance">
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle className="text-sm">Multi-source research</AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">
              This feed pulls from HN, Reddit, RSS, GitHub, ArXiv, Google Trends — not x.com scraping.{" "}
              <strong className="text-foreground">X posts</strong> use the{" "}
              <a href={X_OFFICIAL_DOCS.developerGuidelines} target="_blank" rel="noopener noreferrer" className="underline font-medium text-foreground">
                official X API
              </a>.
            </AlertDescription>
          </Alert>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setShowPulse(!showPulse)}>
            <Flame className="h-3 w-3 mr-1 text-orange-400" />
            Market Pulse
          </Button>
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

      {/* Market Pulse panel */}
      {showPulse && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-400" />
              Today's Market Intelligence
              {pulse && (
                <span className="text-[10px] text-muted-foreground font-normal ml-auto">
                  fetched {new Date(pulse.fetchedAt).toLocaleTimeString()}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!pulse ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading market pulse...
              </div>
            ) : (
              <>
                {pulse.boostTopics.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-orange-400 uppercase tracking-wide mb-1">
                      Breaking — post these NOW for 1.5× reach
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {pulse.boostTopics.map((t, i) => (
                        <Badge key={i} className="text-[10px] bg-orange-500/20 text-orange-300 border-orange-500/30">
                          <Zap className="h-2.5 w-2.5 mr-0.5" />{t.length > 70 ? t.substring(0, 67) + "…" : t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {pulse.breakingTopics.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                      Breaking Tech Topics (HN front page)
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {pulse.breakingTopics.slice(0, 8).map((t, i) => (
                        <Badge key={i} variant="outline" className="text-[10px]">
                          {t.length > 60 ? t.substring(0, 57) + "…" : t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {pulse.trendingKeywords.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                      Trending Keywords
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {pulse.trendingKeywords.slice(0, 15).map((kw, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">{kw}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sources panel */}
      {showSources && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Rss className="h-4 w-4" /> RSS Feeds</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-64 overflow-y-auto">
              {rssSources.length === 0 ? (
                <p className="text-xs text-muted-foreground">No RSS sources configured</p>
              ) : rssSources.map((src) => (
                <div key={src.id} className="space-y-2 rounded-md border border-border/60 p-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className="text-[10px] shrink-0">{src.category}</Badge>
                      <span className="truncate">{src.name}</span>
                      {src.autopost ? (
                        <Badge variant="secondary" className="text-[10px]" data-testid={`badge-autopost-${src.id}`}>
                          AUTO
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-muted-foreground hidden sm:inline">Autopost</span>
                      <Switch
                        checked={!!src.autopost}
                        data-testid={`toggle-autopost-${src.id}`}
                        onCheckedChange={(on) =>
                          autopostMutation.mutate({
                            id: src.id,
                            autopost: on,
                            autopostPlatform: src.autopostPlatform || "x",
                            autopostTone: src.autopostTone || "educational",
                            autopostPostType: src.autopostPostType || "thread",
                          })
                        }
                      />
                      <Badge variant={src.isActive ? "default" : "secondary"} className="text-[10px]">
                        {src.isActive ? "Active" : "Paused"}
                      </Badge>
                    </div>
                  </div>
                  {src.autopost ? (
                    <div className="flex flex-wrap gap-2 items-center text-xs">
                      <Select
                        value={src.autopostPlatform || "x"}
                        onValueChange={(autopostPlatform) =>
                          autopostMutation.mutate({ id: src.id, autopost: true, autopostPlatform })
                        }
                      >
                        <SelectTrigger className="h-8 w-[120px]" data-testid={`select-autopost-platform-${src.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="x">X</SelectItem>
                          <SelectItem value="threads">Threads</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={src.autopostTone || "educational"}
                        onValueChange={(autopostTone) =>
                          autopostMutation.mutate({ id: src.id, autopost: true, autopostTone })
                        }
                      >
                        <SelectTrigger className="h-8 w-[130px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="educational">Educational</SelectItem>
                          <SelectItem value="technical">Technical</SelectItem>
                          <SelectItem value="provocative">Provocative</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={src.autopostPostType || "thread"}
                        onValueChange={(autopostPostType) =>
                          autopostMutation.mutate({ id: src.id, autopost: true, autopostPostType })
                        }
                      >
                        <SelectTrigger className="h-8 w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="thread">Thread</SelectItem>
                          <SelectItem value="tweet">Tweet</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
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

      {/* Filters */}
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
              <p className="text-xs text-muted-foreground">HN, Reddit × 15, RSS × 20, GitHub, ArXiv, Google Trends → AI ranking</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ideas list */}
      {ideasLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredIdeas.length === 0 ? (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center gap-3">
            <Compass className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">No ideas yet. Click "Scan Now" to start.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredIdeas.map((idea, index) => {
            const viralScore = Number(idea.viralScore || 0);
            const scoreColor = viralScore >= 8 ? "text-green-400" : viralScore >= 6 ? "text-yellow-400" : "text-muted-foreground";
            const isLoading = loadingIds.has(idea.id);
            return (
              <Card key={idea.id} data-testid={`card-idea-${idea.id}`}>
                <CardContent className="flex items-start gap-4 py-4">
                  {/* Score */}
                  <div className="flex flex-col items-center gap-1 shrink-0 w-12">
                    <span className={`text-lg font-bold ${scoreColor}`}>{viralScore.toFixed(1)}</span>
                    <div className="flex items-center gap-0.5">
                      {viralScore >= 8
                        ? <Flame className="h-3 w-3 text-orange-400" />
                        : viralScore >= 6
                        ? <TrendingUp className="h-3 w-3 text-yellow-400" />
                        : <Star className="h-3 w-3 text-muted-foreground" />}
                    </div>
                    <span className="text-[9px] text-muted-foreground">#{index + 1}</span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-medium line-clamp-2">{idea.title}</h3>
                      <div className="flex items-center gap-1 shrink-0">
                        <Badge variant="secondary" className="text-[10px]">
                          {sourceTypeLabels[idea.sourceType || "rss"] || idea.sourceType}
                        </Badge>
                        {idea.category && (
                          <Badge variant="outline" className="text-[10px]">
                            {categoryLabels[idea.category] || idea.category}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {idea.summary && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{idea.summary}</p>
                    )}

                    {(idea.contentAngles as string[] || []).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(idea.contentAngles as string[]).slice(0, 3).map((angle, i) => (
                          <Badge key={i} variant="outline" className="text-[10px]">
                            <Zap className="h-2 w-2 mr-0.5" />{angle}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {idea.suggestedHook && (
                      <p className="text-[11px] text-blue-400 italic line-clamp-1">
                        Hook: {idea.suggestedHook}
                      </p>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      {idea.sourceUrl && (
                        <a
                          href={idea.sourceUrl} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-primary flex items-center gap-0.5"
                        >
                          <ExternalLink className="h-3 w-3" /> Source
                        </a>
                      )}
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => bookmarkMutation.mutate(idea.id)}
                        data-testid={`button-bookmark-idea-${idea.id}`}
                      >
                        {idea.isBookmarked
                          ? <BookmarkCheck className="h-3 w-3 text-primary" />
                          : <Bookmark className="h-3 w-3" />}
                      </Button>
                      <Button
                        variant="outline" size="sm"
                        onClick={() => openCreateDialog(idea)}
                        disabled={isLoading}
                        data-testid={`button-expand-idea-${idea.id}`}
                      >
                        {isLoading
                          ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          : <Sparkles className="h-3 w-3 mr-1" />}
                        {idea.status === "used" ? "Create Again" : "Create Draft"}
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => deleteIdeaMutation.mutate(idea.id)}
                        disabled={deleteIdeaMutation.isPending}
                        data-testid={`button-delete-idea-${idea.id}`}
                        title="Delete idea"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Draft Dialog */}
      <Dialog
        open={!!dialogIdea}
        onOpenChange={(open) => {
          if (!open) { setDialogIdea(null); setDraftResult(null); }
        }}
      >
        <DialogContent className="max-w-lg">
          {!draftResult ? (
            <>
              <DialogHeader>
                <DialogTitle>Create Draft</DialogTitle>
                <DialogDescription className="line-clamp-2 text-xs">
                  {dialogIdea?.title}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2 py-2">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
                  Choose content format
                </p>
                {CONTENT_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setSelectedType(opt.id)}
                    className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                      selectedType === opt.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/40 hover:bg-muted/50"
                    }`}
                  >
                    <div className={`mt-0.5 shrink-0 ${selectedType === opt.id ? "text-primary" : "text-muted-foreground"}`}>
                      {opt.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{opt.label}</span>
                        <Badge variant="outline" className="text-[10px]">{opt.tweetCount}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                    </div>
                    {selectedType === opt.id && (
                      <ChevronRight className="h-4 w-4 text-primary shrink-0 mt-1" />
                    )}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setDialogIdea(null)}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleCreateDraft}
                  disabled={dialogIdea ? loadingIds.has(dialogIdea.id) : false}
                >
                  {dialogIdea && loadingIds.has(dialogIdea.id)
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Generating…</>
                    : <><Sparkles className="h-4 w-4 mr-2" />Generate Draft</>}
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                  Draft Created
                </DialogTitle>
                <DialogDescription>
                  {draftResult.tweetCount} tweet{draftResult.tweetCount !== 1 ? "s" : ""} generated
                  as a {draftResult.postType.replace(/_/g, " ")}.
                  {draftResult.hashtags.length > 0 && (
                    <span className="block mt-1 text-blue-400">
                      {draftResult.hashtags.map((h) => `#${h}`).join(" ")}
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2 py-2">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                  What do you want to do?
                </p>

                <button
                  onClick={handlePublishNow}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-green-500/40 bg-green-500/5 hover:bg-green-500/10 transition-colors text-left"
                >
                  <Send className="h-5 w-5 text-green-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Post Now</p>
                    <p className="text-xs text-muted-foreground">Publish immediately to X (@devopsbyte)</p>
                  </div>
                </button>

                <button
                  onClick={() => setShowScheduleForm((s) => !s)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors text-left"
                >
                  <Calendar className="h-5 w-5 text-blue-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Schedule</p>
                    <p className="text-xs text-muted-foreground">Pick a date and time on the calendar</p>
                  </div>
                </button>

                {showScheduleForm && (
                  <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
                    <p className="text-xs font-medium">Pick date &amp; time</p>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className="h-9 rounded-md border bg-background px-2 text-sm flex-1"
                      />
                      <input
                        type="time"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className="h-9 rounded-md border bg-background px-2 text-sm w-32"
                      />
                    </div>
                    <Button className="w-full" onClick={handleScheduleDraft}>
                      <Calendar className="h-4 w-4 mr-2" />
                      Confirm Schedule
                    </Button>
                  </div>
                )}

                <button
                  onClick={() => { setDialogIdea(null); navigate("/queue"); }}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors text-left"
                >
                  <Pencil className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Review &amp; Edit</p>
                    <p className="text-xs text-muted-foreground">Open the draft in Queue to modify before posting</p>
                  </div>
                </button>
              </div>

              <Button
                variant="outline" className="w-full"
                onClick={() => { setDialogIdea(null); setDraftResult(null); }}
              >
                Done
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
