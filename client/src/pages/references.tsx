import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Search, Loader2, ExternalLink, Bookmark, BookmarkCheck, Trash2, Wand2, Globe, FileText, Eye } from "lucide-react";
import type { Reference, Pillar } from "@shared/schema";

export default function ReferencesPage() {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [inputMode, setInputMode] = useState<"url" | "text">("url");
  const [selectedRef, setSelectedRef] = useState<number | null>(null);
  const [genContentType, setGenContentType] = useState("thread");
  const [generatedContent, setGeneratedContent] = useState<any>(null);

  const { data: references = [], isLoading } = useQuery<Reference[]>({ queryKey: ["/api/references"] });

  const analyzeMutation = useMutation({
    mutationFn: async (data: { url?: string; text?: string }) => {
      const res = await apiRequest("POST", "/api/references/analyze", data);
      return res.json();
    },
    onSuccess: (ref) => {
      queryClient.invalidateQueries({ queryKey: ["/api/references"] });
      setSelectedRef(ref.id);
      setUrl("");
      setPastedText("");
      toast({ title: "Content analyzed successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async ({ id, contentType }: { id: number; contentType: string }) => {
      const res = await apiRequest("POST", `/api/references/${id}/generate`, { contentType });
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedContent(data);
      toast({ title: "Content generated from reference" });
    },
  });

  const bookmarkMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/references/${id}/bookmark`, {});
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/references"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/references/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/references"] });
      if (selectedRef) setSelectedRef(null);
      toast({ title: "Reference deleted" });
    },
  });

  const saveDraftMutation = useMutation({
    mutationFn: async (variation: any) => {
      const res = await apiRequest("POST", "/api/posts", {
        postType: genContentType === "thread" ? "thread" : "tweet",
        tone: "conversational",
        targetPlatform: "both",
        status: "draft",
        aiModel: "gpt-4o-mini",
        tweets: variation.tweets.map((t: any, i: number) => ({
          content: t.content,
          position: i,
          charCount: t.charCount || t.content.length,
        })),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
      toast({ title: "Draft saved" });
    },
  });

  const activeRef = references.find((r) => r.id === selectedRef);
  const analysis = activeRef?.analysisJson as any;

  return (
    <div className="flex flex-col h-full overflow-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-references-title">Source Analysis</h1>
        <p className="text-sm text-muted-foreground">Analyze any content source, then generate original content inspired by it</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Button variant={inputMode === "url" ? "default" : "outline"} size="sm" onClick={() => setInputMode("url")} data-testid="button-mode-url">
              <Globe className="h-3 w-3 mr-1" /> URL
            </Button>
            <Button variant={inputMode === "text" ? "default" : "outline"} size="sm" onClick={() => setInputMode("text")} data-testid="button-mode-text">
              <FileText className="h-3 w-3 mr-1" /> Paste Text
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {inputMode === "url" ? (
            <div className="flex gap-2">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste any URL — blog post, tweet, newsletter, GitHub, YouTube..." className="flex-1" data-testid="input-reference-url" />
              <Button onClick={() => analyzeMutation.mutate({ url })} disabled={!url || analyzeMutation.isPending} data-testid="button-analyze">
                {analyzeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Search className="h-4 w-4 mr-1" />}
                Analyze
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Textarea value={pastedText} onChange={(e) => setPastedText(e.target.value)} placeholder="Paste content here (for paywalled articles, PDFs, or any text)..." className="min-h-[120px]" data-testid="input-reference-text" />
              <Button onClick={() => analyzeMutation.mutate({ text: pastedText })} disabled={!pastedText || analyzeMutation.isPending} className="w-full" data-testid="button-analyze-text">
                {analyzeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Search className="h-4 w-4 mr-1" />}
                Analyze Content
              </Button>
            </div>
          )}
          {analyzeMutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Extracting content... Analyzing style... Identifying patterns...
            </div>
          )}
        </CardContent>
      </Card>

      {activeRef && analysis && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm">{activeRef.title || "Analysis Results"}</CardTitle>
              {activeRef.sourceUrl && (
                <a href={activeRef.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1 mt-1">
                  <ExternalLink className="h-3 w-3" /> {activeRef.sourceUrl.substring(0, 60)}...
                </a>
              )}
            </div>
            <Badge variant="secondary">{activeRef.sourceType}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {analysis.summary && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Summary</p>
                <p className="text-sm">{analysis.summary}</p>
              </div>
            )}

            {analysis.writing_style && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Style Fingerprint</p>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline">{analysis.writing_style.tone}</Badge>
                  <Badge variant="outline">{analysis.writing_style.sentence_structure}</Badge>
                  <Badge variant="outline">{analysis.writing_style.vocabulary_level}</Badge>
                  <Badge variant="outline">Hook: {analysis.writing_style.hook_technique}</Badge>
                </div>
              </div>
            )}

            {analysis.engagement_signals && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Engagement Patterns</p>
                <p className="text-sm text-muted-foreground">{analysis.engagement_signals.why_it_works}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(analysis.engagement_signals.emotional_triggers || []).map((t: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-[10px]">{t}</Badge>
                  ))}
                </div>
              </div>
            )}

            {analysis.gaps_and_angles && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Gaps & Angles (Your Unique Value)</p>
                <ul className="text-sm space-y-1">
                  {(analysis.gaps_and_angles || []).map((g: string, i: number) => (
                    <li key={i} className="flex items-start gap-2">
                      <Wand2 className="h-3 w-3 mt-1 text-primary shrink-0" />
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2 border-t flex-wrap">
              <Select value={genContentType} onValueChange={setGenContentType}>
                <SelectTrigger className="w-[160px]" data-testid="select-gen-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tweet">Tweet</SelectItem>
                  <SelectItem value="thread">Thread</SelectItem>
                  <SelectItem value="hot_take">Hot Take</SelectItem>
                  <SelectItem value="article">Article</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={() => generateMutation.mutate({ id: activeRef.id, contentType: genContentType })} disabled={generateMutation.isPending} data-testid="button-generate-from-ref">
                {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Wand2 className="h-4 w-4 mr-1" />}
                Generate Content
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {generatedContent?.variations && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Generated Variations</h3>
          {generatedContent.variations.map((variation: any, i: number) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-xs">Variation {i + 1}</CardTitle>
                <Button variant="outline" size="sm" onClick={() => saveDraftMutation.mutate(variation)} disabled={saveDraftMutation.isPending} data-testid={`button-save-variation-${i}`}>
                  Save as Draft
                </Button>
              </CardHeader>
              <CardContent>
                {variation.tweets.map((t: any, j: number) => (
                  <div key={j} className="p-3 rounded-md border mb-2 last:mb-0">
                    <p className="text-sm whitespace-pre-wrap">{t.content}</p>
                    <span className="text-[10px] text-muted-foreground">{t.charCount || t.content.length} chars</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-3" data-testid="text-references-library">References Library</h2>
        {isLoading ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : references.length === 0 ? (
          <Card className="py-8">
            <CardContent className="flex flex-col items-center gap-2">
              <Search className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No references yet. Analyze a URL or paste content above.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {references.map((ref) => {
              const refAnalysis = ref.analysisJson as any;
              return (
                <Card key={ref.id} className="hover-elevate cursor-pointer" onClick={() => setSelectedRef(ref.id)} data-testid={`card-reference-${ref.id}`}>
                  <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm line-clamp-1">{ref.title || "Untitled"}</CardTitle>
                      {refAnalysis?.summary && <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{refAnalysis.summary}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="secondary" className="text-[10px]">{ref.sourceType}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex items-center gap-2 flex-wrap">
                    {(ref.tags || []).slice(0, 3).map((tag, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{tag}</Badge>
                    ))}
                    <div className="ml-auto flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); bookmarkMutation.mutate(ref.id); }} data-testid={`button-bookmark-${ref.id}`}>
                        {ref.isBookmarked ? <BookmarkCheck className="h-3 w-3 text-primary" /> : <Bookmark className="h-3 w-3" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(ref.id); }} data-testid={`button-delete-ref-${ref.id}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
