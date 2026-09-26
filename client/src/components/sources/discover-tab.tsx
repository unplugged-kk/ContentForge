import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Compass,
  Search,
  SlidersHorizontal,
  Loader2,
  AlertTriangle,
  Info,
  CheckCircle2,
  Sparkles,
  Link2,
  FileText,
  Bookmark,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ErrorState } from "@/components/ui-shared/error-state";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  formatTimeWindow,
  formatResearchDepth,
  resolveResearchStatus,
  translateProviderLimitations,
  getCreateFromSourceUrl,
} from "@/lib/sources-research-state";
import { SourceCard } from "./source-card";
import { SourceDetailModal } from "./source-detail-modal";
import { CreateStoryDialog } from "./create-story-dialog";

export function DiscoverTab() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [query, setQuery] = useState("");
  const [windowPreset, setWindowPreset] = useState<string>("last_7d");
  const [depth, setDepth] = useState<string>("standard");
  const [seo, setSeo] = useState<boolean>(false);
  const [directUrl, setDirectUrl] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);

  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [selectedSource, setSelectedSource] = useState<any | null>(null);
  const [storyDialogOpen, setStoryDialogOpen] = useState(false);
  const [storyInitialData, setStoryInitialData] = useState<{ title?: string; body?: string }>({});

  // Capabilities query
  const capabilitiesQuery = useQuery({
    queryKey: ["/api/research/capabilities"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/research/capabilities");
      return res.json();
    },
  });

  // Active Job query
  const jobQuery = useQuery({
    queryKey: ["/api/research/jobs", activeJobId],
    enabled: activeJobId != null,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === "queued" || s === "running" || s === "in_progress") return 1200;
      return false;
    },
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/research/jobs/${activeJobId}`);
      return res.json();
    },
  });

  // Sources query
  const sourcesQuery = useQuery({
    queryKey: ["/api/research/jobs", activeJobId, "sources"],
    enabled: activeJobId != null && (jobQuery.data?.status === "complete" || jobQuery.data?.status === "completed"),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/research/jobs/${activeJobId}/sources`);
      return res.json() as Promise<any[]>;
    },
  });

  // Evidence query
  const evidenceQuery = useQuery({
    queryKey: ["/api/research/jobs", activeJobId, "evidence"],
    enabled: activeJobId != null && (jobQuery.data?.status === "complete" || jobQuery.data?.status === "completed"),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/research/jobs/${activeJobId}/evidence`);
      return res.json() as Promise<any[]>;
    },
  });

  // Analysis query
  const analysisQuery = useQuery({
    queryKey: ["/api/research/jobs", activeJobId, "analysis"],
    enabled: activeJobId != null && (jobQuery.data?.status === "complete" || jobQuery.data?.status === "completed"),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/research/jobs/${activeJobId}/analysis`);
      return res.json();
    },
  });

  // Saved items query to check saved status
  const savedVaultQuery = useQuery({
    queryKey: ["/api/vault"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/vault");
      return res.json() as Promise<any[]>;
    },
  });

  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set());

  // Save source mutation
  const saveMutation = useMutation({
    mutationFn: async (src: any) => {
      const res = await apiRequest("POST", "/api/vault", {
        title: src.title || "Saved Research Source",
        content: src.excerpt || src.title || src.canonicalUrl,
        category: "research",
        tags: [src.provider],
        sourceUrl: src.canonicalUrl,
        sourceType: src.provider,
      });
      return { json: await res.json(), url: src.canonicalUrl };
    },
    onSuccess: (result) => {
      if (result.url) {
        setSavedUrls((prev) => new Set(prev).add(result.url));
      }
      void queryClient.invalidateQueries({ queryKey: ["/api/vault"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/references"] });
      toast({ title: "Source Saved", description: "Saved to your knowledge base." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  // Create research job mutation
  const researchMutation = useMutation({
    mutationFn: async () => {
      const targetQuery = query.trim() || directUrl.trim();
      if (!targetQuery) throw new Error("Please enter a research topic or URL");

      // Dynamic provider list from capabilities or default to open providers
      const availableProviders = (capabilitiesQuery.data?.providers ?? [])
        .filter((p: any) => p.available)
        .map((p: any) => p.providerId);

      const providerIds = availableProviders.length > 0
        ? availableProviders.slice(0, 4)
        : ["rss", "hn", "web"];

      const body: Record<string, unknown> = {
        kind: directUrl.trim() ? "directed" : "directed",
        query: targetQuery,
        providerIds,
        windowPreset,
        depth,
        seo: seo && Boolean(capabilitiesQuery.data?.openseo?.available),
        idempotencyKey: `sources:${targetQuery.slice(0, 40)}:${Date.now()}`,
      };

      if (directUrl.trim()) {
        body.providerConfig = { web: { urls: [directUrl.trim()] } };
      }

      const res = await apiRequest("POST", "/api/research/jobs", body);
      return res.json() as Promise<{ id: number; status: string }>;
    },
    onSuccess: (data) => {
      setActiveJobId(data.id);
      void queryClient.invalidateQueries({ queryKey: ["/api/research/jobs"] });
    },
    onError: (err: Error) => {
      toast({ title: "Research failed", description: err.message, variant: "destructive" });
    },
  });

  const handleStartResearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (query.trim() || directUrl.trim()) {
      researchMutation.mutate();
    }
  };

  const isSavedUrl = (url?: string) => {
    if (!url || !savedVaultQuery.data) return false;
    return savedVaultQuery.data.some((item) => item.sourceUrl === url);
  };

  const job = jobQuery.data;
  const rawStatus = job?.status;
  const isPending = rawStatus === "queued" || rawStatus === "running" || rawStatus === "in_progress" || researchMutation.isPending;
  const isFailed = jobQuery.isError || researchMutation.isError || rawStatus === "failed";
  const isComplete = (rawStatus === "complete" || rawStatus === "completed") && !isPending;

  const statusResolution = resolveResearchStatus({
    jobStatus: rawStatus,
    warnings: job?.warnings,
    errorMessage: job?.errorMessage || researchMutation.error?.message,
  });

  // Read failures must be told apart from true empty results (brief truthfulness rule 5).
  const sourcesLoadFailed = sourcesQuery.isError;
  const evidenceLoadFailed = evidenceQuery.isError;

  const sources = sourcesQuery.data ?? [];
  const evidence = evidenceQuery.data ?? [];
  const analysisSnapshot = analysisQuery.data?.snapshot;
  const conflicts = analysisSnapshot?.conflicts ?? [];

  const limitations = translateProviderLimitations(capabilitiesQuery.data);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      {/* Title & Overview */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold tracking-tight" data-testid="text-discover-title">
            Discover &amp; Research
          </h2>
          <p className="text-xs text-muted-foreground">
            Investigate emerging stories, evaluate claims, and discover verified knowledge.
          </p>
        </div>
      </div>

      {/* Honest Provider Limitations Notice (if any are unconfigured/unavailable) */}
      {limitations.length > 0 && (
        <div className="rounded-lg border border-muted bg-muted/20 p-3 space-y-1.5 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>Research Provider Notice</span>
          </div>
          <p className="text-muted-foreground text-xs">
            Some intelligence integrations are currently unavailable:
          </p>
          <div className="flex flex-wrap gap-2 pt-0.5">
            {limitations.map((lim) => (
              <Badge key={lim.providerId} variant="outline" className="text-xs font-normal">
                {lim.userMessage}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Research Search & Controls Card */}
      <Card className="border-border shadow-xs">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <form onSubmit={handleStartResearch} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search topics, industry trends, or stories to research…"
                  className="pl-9 text-sm h-9"
                  data-testid="input-research-query"
                  disabled={isPending}
                />
              </div>
              <Button
                type="submit"
                disabled={isPending || (!query.trim() && !directUrl.trim())}
                data-testid="button-start-research"
                className="h-9 gap-1.5 shrink-0"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Compass className="h-4 w-4" />}
                {isPending ? "Researching…" : "Start Research"}
              </Button>
            </div>

            {/* Direct URL Toggle */}
            <div className="flex items-center justify-between text-xs pt-0.5">
              <button
                type="button"
                onClick={() => setShowUrlInput(!showUrlInput)}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground text-xs"
              >
                <Link2 className="h-3.5 w-3.5" />
                <span>{showUrlInput ? "Hide direct URL research" : "Research a specific URL"}</span>
              </button>

              {showUrlInput && (
                <span className="text-xs text-muted-foreground italic">
                  Protected with SSRF safety guards
                </span>
              )}
            </div>

            {showUrlInput && (
              <div className="pt-1">
                <Input
                  value={directUrl}
                  onChange={(e) => setDirectUrl(e.target.value)}
                  placeholder="https://example.com/article"
                  className="text-xs h-8"
                  data-testid="input-direct-url"
                  disabled={isPending}
                />
              </div>
            )}

            {/* Research Controls: Window, Depth, SEO */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t text-xs">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground">Time Window</Label>
                <Select value={windowPreset} onValueChange={setWindowPreset} disabled={isPending}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-time-window" aria-label="Time window">
                    <SelectValue placeholder="Select window" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="last_24h" className="text-xs">Last 24 hours</SelectItem>
                    <SelectItem value="last_7d" className="text-xs">Last 7 days</SelectItem>
                    <SelectItem value="last_30d" className="text-xs">Last 30 days</SelectItem>
                    <SelectItem value="custom" className="text-xs">Custom window</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground">Research Depth</Label>
                <Select value={depth} onValueChange={setDepth} disabled={isPending}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-research-depth" aria-label="Research depth">
                    <SelectValue placeholder="Select depth" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quick" className="text-xs">Quick (Rapid scan)</SelectItem>
                    <SelectItem value="standard" className="text-xs">Standard (Balanced depth)</SelectItem>
                    <SelectItem value="deep" className="text-xs">Deep (Comprehensive)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground">SEO Enhancement</Label>
                <div className="flex items-center justify-between rounded-md border h-8 px-2.5 bg-muted/20">
                  <span className="text-xs text-muted-foreground">
                    {capabilitiesQuery.data?.openseo?.available ? "OpenSEO enabled" : "SEO unavailable"}
                  </span>
                  <Switch
                    checked={seo && Boolean(capabilitiesQuery.data?.openseo?.available)}
                    onCheckedChange={setSeo}
                    disabled={isPending || !capabilitiesQuery.data?.openseo?.available}
                    aria-label="Toggle SEO research"
                  />
                </div>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* State A: Idle (No research started yet) */}
      {!activeJobId && !isPending && !isFailed && (
        <div className="rounded-lg border border-dashed p-8 text-center space-y-2 text-muted-foreground" data-testid="state-discover-idle">
          <Compass className="h-8 w-8 mx-auto opacity-40 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Discover What Is Happening</h3>
          <p className="text-xs max-w-md mx-auto">
            Search a topic above to research multi-provider sources, extract evidence claims, and uncover content angles.
          </p>
        </div>
      )}

      {/* State B: Searching / Researching */}
      {isPending && (
        <div className="rounded-lg border p-8 text-center space-y-3 bg-muted/10" data-testid="state-discover-searching">
          <Loader2 className="h-7 w-7 mx-auto animate-spin text-primary" />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Researching sources…</h3>
            <p className="text-xs text-muted-foreground">
              Synthesizing material across RSS feeds, Hacker News, and web intelligence ({formatTimeWindow(windowPreset)}, {formatResearchDepth(depth)} depth).
            </p>
          </div>
        </div>
      )}

      {/* State C: Error State with Retry */}
      {isFailed && (
        <ErrorState
          title="Couldn't complete research"
          description="Some sources or queries could not be executed at this time."
          onRetry={handleStartResearch}
        />
      )}

      {/* State D: Complete Results */}
      {isComplete && (
        <div className="space-y-6">
          {/* Research Summary Banner */}
          <div className="rounded-lg border bg-card p-4 space-y-2 shadow-xs" data-testid="panel-research-summary">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <h3 className="text-sm font-bold text-foreground">
                  {statusResolution.label}
                </h3>
              </div>

              <div className="flex items-center gap-1.5">
                {statusResolution.isDegraded && (
                  <Badge variant="destructive" className="text-xs" data-testid="badge-degraded-sources">
                    Degraded sources
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  {formatTimeWindow(windowPreset)}
                </Badge>
              </div>
            </div>

            {/* Real Metrics Row. A failed read must never render as a zero count. */}
            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground border-t">
              {sourcesLoadFailed ? (
                <span className="text-warning font-medium">Source count unavailable</span>
              ) : (
                <span><strong>{sources.length}</strong> sources reviewed</span>
              )}
              <span>·</span>
              {evidenceLoadFailed ? (
                <span className="text-warning font-medium">Finding count unavailable</span>
              ) : (
                <span><strong>{evidence.length}</strong> key findings</span>
              )}
              {conflicts.length > 0 && (
                <>
                  <span>·</span>
                  <span className="text-warning font-medium">
                    <strong>{conflicts.length}</strong> competing viewpoints
                  </span>
                </>
              )}
            </div>
            {(sourcesLoadFailed || evidenceLoadFailed || analysisQuery.isError) && (
              <p className="text-xs text-muted-foreground">
                Some results couldn't be loaded — this summary may be incomplete.
              </p>
            )}
          </div>

          {/* Source Result Cards */}
          {sourcesQuery.isError ? (
            <ErrorState
              title="Couldn't load sources"
              description="The research run finished, but its sources could not be retrieved. This is a read failure, not a topic with no matches."
              onRetry={() => void sourcesQuery.refetch()}
            />
          ) : sources.length > 0 ? (
            <div className="space-y-3" data-testid="list-research-results">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Identified Sources ({sources.length})
                </h3>
              </div>

              {sources.map((src) => {
                const srcEvidence = evidence.filter((e) => e.sourceId === src.id || e.canonicalUrl === src.canonicalUrl);
                const hasSrcConflicts = conflicts.some(
                  (c: any) => c.sourceUrlA === src.canonicalUrl || c.sourceUrlB === src.canonicalUrl,
                );

                return (
                  <SourceCard
                    key={src.id}
                    source={src}
                    corroborationCount={srcEvidence.length || 1}
                    hasConflicts={hasSrcConflicts}
                    isSaved={isSavedUrl(src.canonicalUrl)}
                    onOpen={() => setSelectedSource(src)}
                    onSave={() => saveMutation.mutate(src)}
                    onCreateStory={() => {
                      setStoryInitialData({
                        title: src.title || "Story from Research",
                        body: src.excerpt || "",
                      });
                      setStoryDialogOpen(true);
                    }}
                    onCreateContent={() => {
                      navigate(getCreateFromSourceUrl({ title: src.title, url: src.canonicalUrl }));
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
              <p className="text-sm font-medium">No sources found for this topic.</p>
              <p className="text-xs mt-1">Try broadening your search query or selecting a wider time window.</p>
            </div>
          )}
        </div>
      )}

      {/* Source Detail Modal */}
      {selectedSource && (
        <SourceDetailModal
          open={Boolean(selectedSource)}
          onOpenChange={(open) => {
            if (!open) setSelectedSource(null);
          }}
          source={selectedSource}
          evidenceError={evidenceQuery.isError}
          evidenceList={evidence.filter(
            (e) => e.sourceId === selectedSource.id || e.canonicalUrl === selectedSource.canonicalUrl,
          )}
          conflicts={conflicts.filter(
            (c: any) => c.sourceUrlA === selectedSource.canonicalUrl || c.sourceUrlB === selectedSource.canonicalUrl,
          )}
          researchContext={{
            query: job?.query || query,
            window: formatTimeWindow(windowPreset),
            depth: formatResearchDepth(depth),
          }}
          isSaved={isSavedUrl(selectedSource.canonicalUrl)}
          onSave={() => saveMutation.mutate(selectedSource)}
          onCreateStory={() => {
            setStoryInitialData({
              title: selectedSource.title || "Story from Research",
              body: selectedSource.excerpt || "",
            });
            setStoryDialogOpen(true);
          }}
          onCreateContent={() => {
            navigate(getCreateFromSourceUrl({ title: selectedSource.title, url: selectedSource.canonicalUrl }));
          }}
        />
      )}

      {/* Create Story Dialog */}
      <CreateStoryDialog
        open={storyDialogOpen}
        onOpenChange={setStoryDialogOpen}
        initialTitle={storyInitialData.title}
        initialBody={storyInitialData.body}
        researchJobId={activeJobId}
        evidenceRefs={evidence.map((e) => e.id).filter(Boolean)}
        provenance="researched"
      />
    </div>
  );
}
