import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CONTENT_PILLARS, POST_TYPES, TONES, PLATFORMS, CHAR_LIMITS } from "@/lib/constants";
import { Sparkles, Copy, Save, RefreshCw, Check, AlertTriangle, Zap, Loader2, TrendingUp, ArrowUp } from "lucide-react";
import { SiX, SiThreads } from "react-icons/si";
import type { Post, Tweet } from "@shared/schema";

function CharCount({ count, limit }: { count: number; limit: number }) {
  const isOver = count > limit;
  return (
    <span className={`text-xs tabular-nums ${isOver ? "text-red-500" : "text-muted-foreground"}`}>
      {count}/{limit}
      {isOver ? <AlertTriangle className="inline ml-1 h-3 w-3" /> : <Check className="inline ml-1 h-3 w-3 text-green-500" />}
    </span>
  );
}

function PlatformIcon({ platform }: { platform: string }) {
  if (platform === "x") return <SiX className="h-3 w-3" />;
  if (platform === "threads") return <SiThreads className="h-3 w-3" />;
  return (
    <span className="flex items-center gap-1">
      <SiX className="h-3 w-3" />
      <SiThreads className="h-3 w-3" />
    </span>
  );
}

interface GenerationResult {
  variations: Array<{
    tweets: Array<{ content: string; charCount: number }>;
  }>;
  model: string;
}

export default function GeneratePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pillar, setPillar] = useState("");
  const [postType, setPostType] = useState("tweet");
  const [tone, setTone] = useState("technical");
  const [platform, setPlatform] = useState("both");
  const [context, setContext] = useState("");
  const [selectedVariation, setSelectedVariation] = useState(0);
  const [editedContent, setEditedContent] = useState<string[][] | null>(null);
  const [viralScore, setViralScore] = useState<any>(null);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/generate", {
        pillar,
        postType,
        tone,
        platform,
        context,
      });
      return res.json() as Promise<GenerationResult>;
    },
    onSuccess: (data) => {
      setSelectedVariation(0);
      setEditedContent(
        data.variations.map((v) => v.tweets.map((t) => t.content))
      );
    },
    onError: (err) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editedContent || !generateMutation.data) return;
      const tweets = editedContent[selectedVariation].map((content, i) => ({
        content,
        position: i,
        charCount: content.length,
      }));
      const res = await apiRequest("POST", "/api/posts", {
        pillarId: pillar ? parseInt(pillar) : null,
        postType,
        tone,
        targetPlatform: platform,
        status: "draft",
        aiModel: generateMutation.data.model,
        tweets,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved as draft" });
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
    },
    onError: (err) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const viralScoreMutation = useMutation({
    mutationFn: async () => {
      if (!editedContent) return;
      const contentText = editedContent[selectedVariation].join("\n\n");
      const res = await apiRequest("POST", "/api/viral/score", {
        content: contentText,
        platform: platform === "both" ? "x" : platform,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setViralScore(data);
    },
    onError: (err) => {
      toast({ title: "Scoring failed", description: err.message, variant: "destructive" });
    },
  });

  const optimizeMutation = useMutation({
    mutationFn: async () => {
      if (!editedContent || !viralScore) return;
      const contentText = editedContent[selectedVariation].join("\n\n");
      const improvements = viralScore.parsed?.improvements || viralScore.improvements || [];
      const res = await apiRequest("POST", "/api/viral/optimize", {
        content: contentText,
        improvements,
        platform: platform === "both" ? "x" : platform,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.tweets) {
        const tweets = data.tweets.map((t: any) => t.content);
        const updated = [...(editedContent || [])];
        updated[selectedVariation] = tweets;
        setEditedContent(updated);
        setViralScore(null);
        toast({ title: "Content optimized. Score again to see improvement." });
      }
    },
    onError: (err) => {
      toast({ title: "Optimization failed", description: err.message, variant: "destructive" });
    },
  });

  const charLimit = platform === "threads" ? CHAR_LIMITS.threads : CHAR_LIMITS.x;
  const data = generateMutation.data;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const updateTweetContent = (variationIdx: number, tweetIdx: number, value: string) => {
    if (!editedContent) return;
    const updated = editedContent.map((v, vi) =>
      vi === variationIdx ? v.map((t, ti) => (ti === tweetIdx ? value : t)) : v
    );
    setEditedContent(updated);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h1 className="text-lg font-semibold" data-testid="text-page-title">Generate Content</h1>
          <p className="text-xs text-muted-foreground">AI-powered content creation for your personal brand</p>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
          <div className="space-y-4">
            <Card className="p-4 space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Content Pillar</label>
                  <Select value={pillar} onValueChange={setPillar}>
                    <SelectTrigger data-testid="select-pillar">
                      <SelectValue placeholder="Select a pillar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTENT_PILLARS.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                            {p.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Post Type</label>
                    <Select value={postType} onValueChange={setPostType}>
                      <SelectTrigger data-testid="select-post-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {POST_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Tone</label>
                    <Select value={tone} onValueChange={setTone}>
                      <SelectTrigger data-testid="select-tone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TONES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Target Platform</label>
                  <div className="flex gap-2">
                    {PLATFORMS.map((p) => (
                      <Button
                        key={p.value}
                        variant={platform === p.value ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPlatform(p.value)}
                        className="flex-1"
                        data-testid={`button-platform-${p.value}`}
                      >
                        <PlatformIcon platform={p.value} />
                        <span className="ml-1.5">{p.label}</span>
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Context (optional)</label>
                  <Textarea
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="Paste a link, article summary, or topic idea..."
                    className="resize-none text-sm"
                    rows={3}
                    data-testid="input-context"
                  />
                </div>
              </div>

              <Button
                className="w-full"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                data-testid="button-generate"
              >
                {generateMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate 3 Variations
                  </>
                )}
              </Button>
            </Card>
          </div>

          <div className="space-y-4">
            {generateMutation.isPending && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="p-4 space-y-3">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-3 w-16" />
                  </Card>
                ))}
              </div>
            )}

            {data && editedContent && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    {data.variations.map((_, i) => (
                      <Button
                        key={i}
                        variant={selectedVariation === i ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedVariation(i)}
                        data-testid={`button-variation-${i}`}
                      >
                        Variation {i + 1}
                      </Button>
                    ))}
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {data.model}
                  </Badge>
                </div>

                <div className="space-y-3">
                  {editedContent[selectedVariation]?.map((content, tIdx) => (
                    <Card key={tIdx} className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          {postType === "thread" ? `Tweet ${tIdx + 1}` : "Post"}
                        </span>
                        <div className="flex items-center gap-2">
                          <CharCount count={content.length} limit={charLimit} />
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleCopy(content)}
                            data-testid={`button-copy-${tIdx}`}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <Textarea
                        value={content}
                        onChange={(e) => updateTweetContent(selectedVariation, tIdx, e.target.value)}
                        className="resize-none text-sm border-0 focus-visible:ring-0"
                        rows={Math.max(2, Math.ceil(content.length / 60))}
                        data-testid={`input-tweet-${tIdx}`}
                      />
                    </Card>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                    data-testid="button-save-draft"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Save as Draft
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => viralScoreMutation.mutate()}
                    disabled={viralScoreMutation.isPending}
                    data-testid="button-viral-score"
                  >
                    {viralScoreMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => generateMutation.mutate()}
                    disabled={generateMutation.isPending}
                    data-testid="button-regenerate"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>

                {viralScore && (
                  <Card className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">Viral Score</span>
                      </div>
                      <span className={`text-2xl font-bold tabular-nums ${Number(viralScore.overallScore || viralScore.parsed?.overall_score || 0) >= 8 ? "text-green-400" : Number(viralScore.overallScore || viralScore.parsed?.overall_score || 0) >= 6 ? "text-yellow-400" : "text-red-400"}`}>{Number(viralScore.overallScore || viralScore.parsed?.overall_score || 0).toFixed(1)}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: "hook_power", label: "Hook Power" },
                        { key: "value_density", label: "Value Density" },
                        { key: "emotional_trigger", label: "Emotional Trigger" },
                        { key: "shareability", label: "Shareability" },
                        { key: "uniqueness", label: "Uniqueness" },
                        { key: "readability", label: "Readability" },
                        { key: "cta_strength", label: "CTA Strength" },
                        { key: "timeliness", label: "Timeliness" },
                      ].map(({ key, label }) => {
                        const dims = viralScore.parsed?.dimensions || viralScore.dimensionScores || {};
                        const dim = dims[key];
                        const val = Number(dim?.score || dim || 0);
                        return (
                          <div key={key} className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">{label}</span>
                            <div className="flex items-center gap-1">
                              <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${val * 10}%`, backgroundColor: val >= 8 ? "#22c55e" : val >= 6 ? "#eab308" : "#ef4444" }} />
                              </div>
                              <span className="tabular-nums w-6 text-right">{val.toFixed(1)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {(viralScore.parsed?.improvements || viralScore.improvements || []).length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t">
                        <p className="text-xs font-medium text-muted-foreground">Improvement Suggestions</p>
                        {(viralScore.parsed?.improvements || viralScore.improvements || []).slice(0, 3).map((s: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-xs">
                            <ArrowUp className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                            <span>{typeof s === "string" ? s : s.suggestion || s.text || JSON.stringify(s)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <Button variant="outline" size="sm" className="w-full" onClick={() => optimizeMutation.mutate()} disabled={optimizeMutation.isPending} data-testid="button-optimize">
                      {optimizeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <TrendingUp className="h-3 w-3 mr-1" />}
                      Auto-Optimize Content
                    </Button>
                  </Card>
                )}
              </div>
            )}

            {!generateMutation.isPending && !data && (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <p className="text-sm font-medium">Ready to generate</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Select a content pillar, post type, and tone, then hit generate to create 3 AI-powered variations
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
