import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Globe, FileText, User, Image, Loader2, ExternalLink, Bookmark, BookmarkCheck,
  Trash2, Wand2, ArrowRight, MessageSquare, Repeat2, Zap, Scale, Swords,
  Save, Star, Copy, Upload, Link2, Calendar, Eye, Edit3, CheckCircle2, ShieldCheck
} from "lucide-react";
import { useLocation } from "wouter";
import type { Reference, StyleProfile, Post } from "@shared/schema";
import { X_OFFICIAL_DOCS } from "@shared/xDeveloperRisk";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const ACTION_LABELS: Record<string, { label: string; icon: any; description: string }> = {
  "my-take": { label: "My Take", icon: MessageSquare, description: "Share Kishore's perspective" },
  "remix": { label: "Remix Structure", icon: Repeat2, description: "Same format, different topic" },
  "one-up": { label: "One-Up This", icon: Zap, description: "Create a superior version" },
  "bridge": { label: "Bridge to Niche", icon: ArrowRight, description: "Connect to DevOps/AI" },
  "opposite": { label: "Opposite Take", icon: Scale, description: "Respectful contrarian view" },
  "debate": { label: "Debate This", icon: Swords, description: "Challenge the thesis" },
  "summarize": { label: "Summarize + React", icon: MessageSquare, description: "One-tweet reaction" },
  "quote-tweet": { label: "Quote Tweet", icon: Copy, description: "5 quote tweet reactions" },
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  reddit_thread: "Reddit Thread",
  reddit_subreddit: "Reddit Subreddit",
  github_repo: "GitHub Repo",
  github_discussion: "GitHub Discussion",
  arxiv_paper: "ArXiv Paper",
  youtube_video: "YouTube Video",
  linkedin_post: "LinkedIn Post",
  linkedin_article: "LinkedIn Article",
  blog_article: "Blog Article",
  x_tweet: "X Tweet",
  x_account: "X Account",
  generic_webpage: "Web Page",
  pasted_text: "Pasted Text",
  screenshot: "Screenshot",
};

export default function IngestPage() {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [xUsername, setXUsername] = useState("");
  const [selectedRef, setSelectedRef] = useState<Reference | null>(null);
  const [actionContentType, setActionContentType] = useState("thread");
  const [generatedContent, setGeneratedContent] = useState<any>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [showStyleSaveDialog, setShowStyleSaveDialog] = useState(false);
  const [styleName, setStyleName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();

  const { data: references = [], isLoading: refsLoading } = useQuery<Reference[]>({ queryKey: ["/api/references"] });
  const { data: styles = [] } = useQuery<StyleProfile[]>({ queryKey: ["/api/styles"] });
  const { data: allPosts = [] } = useQuery<Post[]>({ queryKey: ["/api/posts"] });
  const drafts = allPosts.filter((p) => p.status === "draft").sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).slice(0, 6);

  const ingestMutation = useMutation({
    mutationFn: async (data: { url?: string; text?: string; xUsername?: string }) => {
      const res = await apiRequest("POST", "/api/ingest", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/references"] });
      const ref = data?.id ? data : data?.reference;
      if (ref) setSelectedRef(ref);
      setUrl("");
      setPastedText("");
      setXUsername("");
      setGeneratedContent(null);
      toast({ title: "Content analyzed successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Analysis failed", description: String(err?.message || err), variant: "destructive" });
    },
  });

  const screenshotMutation = useMutation({
    mutationFn: async (files: FileList) => {
      const formData = new FormData();
      Array.from(files).forEach((f) => formData.append("screenshots", f));
      const res = await fetch("/api/ingest/screenshot", { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (ref) => {
      queryClient.invalidateQueries({ queryKey: ["/api/references"] });
      setSelectedRef(ref);
      toast({ title: "Screenshot analyzed" });
    },
    onError: (err: any) => {
      toast({ title: "Screenshot analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ action, referenceId, contentType }: { action: string; referenceId: number; contentType: string }) => {
      const res = await apiRequest("POST", `/api/content-actions/${action}`, { referenceId, contentType });
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedContent(data);
      setActiveAction(null);
      toast({ title: "Content generated" });
    },
    onError: (err: any) => {
      setActiveAction(null);
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const bookmarkMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/references/${id}/bookmark`, {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/references"] });
      if (selectedRef?.id === data.id) setSelectedRef(data);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/references/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/references"] });
      setSelectedRef(null);
      toast({ title: "Reference deleted" });
    },
  });

  const saveStyleMutation = useMutation({
    mutationFn: async ({ name, ref }: { name: string; ref: Reference }) => {
      const style = (ref.styleAnalysisJson || (ref.analysisJson as any)?.writing_style || {}) as any;
      const snippet = `STYLE REFERENCE: Mimic these writing characteristics while keeping Kishore's voice:
- Tone: ${style.tone || "conversational"}
- Sentence structure: ${style.sentence_length || style.sentence_structure || "mixed"}
- Hook technique: ${Array.isArray(style.hook_patterns) ? style.hook_patterns.join(", ") : style.hook_technique || "bold claim"}
- Formatting: ${style.formatting_style || "clean line breaks"}
- Emoji usage: ${style.emoji_usage || "minimal"}
- Vocabulary level: ${style.vocabulary_level || "intermediate"}
IMPORTANT: Only mirror structural and stylistic patterns. Kishore's DevOps/multi-cloud/K8s expertise must remain central.`;

      const res = await apiRequest("POST", "/api/styles", {
        name,
        sourceReferenceId: ref.id,
        styleJson: style,
        stylePromptSnippet: snippet,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/styles"] });
      setShowStyleSaveDialog(false);
      setStyleName("");
      toast({ title: "Style profile saved" });
    },
  });

  const saveDraftMutation = useMutation({
    mutationFn: async (variation: any) => {
      const res = await apiRequest("POST", "/api/posts", {
        postType: actionContentType === "thread" ? "thread" : "tweet",
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
      toast({ title: "Draft saved!", description: "Your draft appears in the Saved Drafts section below and on the Calendar page." });
    },
  });

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const dt = new DataTransfer();
          dt.items.add(file);
          screenshotMutation.mutate(dt.files);
        }
        break;
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const analysis = selectedRef?.analysisJson as any;
  const styleData = (selectedRef?.styleAnalysisJson || analysis?.writing_style) as any;
  const isXAccount = selectedRef?.sourceType === "x_account";
  const isReddit = selectedRef?.sourceType === "reddit_thread";

  return (
    <div className="flex flex-col h-full overflow-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-ingest-title">Ingest Content</h1>
        <p className="text-sm text-muted-foreground">Paste any URL, text, or screenshot — we'll analyze it and help you create content.</p>
        <Alert className="mt-3 max-w-3xl" data-testid="alert-ingest-compliance">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle className="text-sm">Ingest from anywhere — X is a special case</AlertTitle>
          <AlertDescription className="text-xs leading-relaxed">
            URLs and pasted text from across the internet feed analysis and AI synthesis for stronger hooks and drafts.{" "}
            <strong className="text-foreground">Only for x.com/twitter.com:</strong> post links use the official X API when configured; otherwise paste text; profile pages use the X Account tab or paste — no scraping. See{" "}
            <a href={X_OFFICIAL_DOCS.developerGuidelines} target="_blank" rel="noopener noreferrer" className="underline font-medium text-foreground">
              X developer guidelines
            </a>{" "}
            and <code className="rounded bg-muted px-1">docs/X_API_COMPLIANCE_AND_RISK.md</code>.
          </AlertDescription>
        </Alert>
      </div>

      <Card>
        <CardContent className="pt-4">
          <Tabs defaultValue="url">
            <TabsList className="w-full">
              <TabsTrigger value="url" className="flex-1" data-testid="tab-url"><Globe className="h-3 w-3 mr-1" /> URL</TabsTrigger>
              <TabsTrigger value="text" className="flex-1" data-testid="tab-text"><FileText className="h-3 w-3 mr-1" /> Paste Text</TabsTrigger>
              <TabsTrigger value="x-account" className="flex-1" data-testid="tab-x-account"><User className="h-3 w-3 mr-1" /> X Account</TabsTrigger>
              <TabsTrigger value="screenshot" className="flex-1" data-testid="tab-screenshot"><Image className="h-3 w-3 mr-1" /> Screenshot</TabsTrigger>
            </TabsList>

            <TabsContent value="url" className="space-y-3 mt-3">
              <div className="flex gap-2">
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Reddit, GitHub, ArXiv, blogs… X post URLs need server X API keys, or paste text"
                  className="flex-1"
                  data-testid="input-ingest-url"
                />
                <Button onClick={() => ingestMutation.mutate({ url })} disabled={!url || ingestMutation.isPending} data-testid="button-ingest-url">
                  {ingestMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  <span className="ml-1">Analyze</span>
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {["Reddit", "GitHub", "ArXiv", "Substack", "Medium", "Dev.to", "YouTube", "Blogs"].map((s) => (
                  <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="text" className="space-y-3 mt-3">
              <Textarea value={pastedText} onChange={(e) => setPastedText(e.target.value)} placeholder="Paste any content — articles, tweets, thread text, conference notes..." className="min-h-[120px]" data-testid="input-ingest-text" />
              <Button onClick={() => ingestMutation.mutate({ text: pastedText })} disabled={!pastedText || ingestMutation.isPending} className="w-full" data-testid="button-ingest-text">
                {ingestMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Wand2 className="h-4 w-4 mr-1" />}
                Analyze Content
              </Button>
            </TabsContent>

            <TabsContent value="x-account" className="space-y-3 mt-3">
              <div className="flex gap-2">
                <Input value={xUsername} onChange={(e) => setXUsername(e.target.value)} placeholder="@username or profile URL" className="flex-1" data-testid="input-x-username" />
                <Button onClick={() => ingestMutation.mutate({ xUsername })} disabled={!xUsername || ingestMutation.isPending} data-testid="button-analyze-x">
                  {ingestMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <User className="h-4 w-4" />}
                  <span className="ml-1">Analyze</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Analyze any X account's content strategy, writing style, and viral patterns.</p>
            </TabsContent>

            <TabsContent value="screenshot" className="space-y-3 mt-3">
              <div
                className="border-2 border-dashed rounded-md p-8 text-center cursor-pointer hover-elevate"
                onClick={() => fileInputRef.current?.click()}
                data-testid="dropzone-screenshot"
              >
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Drop screenshots here, click to upload, or paste from clipboard (Cmd+V)</p>
                <p className="text-xs text-muted-foreground mt-1">Supports PNG, JPG, WebP — up to 10 images</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) => { if (e.target.files?.length) screenshotMutation.mutate(e.target.files); }}
                data-testid="input-screenshot-file"
              />
              {screenshotMutation.isPending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Analyzing screenshot with AI vision...
                </div>
              )}
            </TabsContent>
          </Tabs>

          {ingestMutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              Detecting source type... Extracting content... Running AI analysis...
            </div>
          )}
        </CardContent>
      </Card>

      {selectedRef && analysis && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm">{selectedRef.title || "Analysis Results"}</CardTitle>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="secondary">{SOURCE_TYPE_LABELS[selectedRef.sourceType || ""] || selectedRef.sourceType}</Badge>
                {selectedRef.sourcePlatform && <Badge variant="outline" className="text-[10px]">{selectedRef.sourcePlatform}</Badge>}
                {selectedRef.sourceAuthorUsername && <span className="text-xs text-muted-foreground">by @{selectedRef.sourceAuthorUsername}</span>}
              </div>
              {selectedRef.sourceUrl && (
                <a href={selectedRef.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1 mt-1" data-testid="link-source-url">
                  <ExternalLink className="h-3 w-3" /> {selectedRef.sourceUrl.substring(0, 80)}
                </a>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => bookmarkMutation.mutate(selectedRef.id)} data-testid="button-bookmark-active">
                {selectedRef.isBookmarked ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(selectedRef.id)} data-testid="button-delete-active">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {analysis.summary && (
              <div><p className="text-xs font-medium text-muted-foreground mb-1">Summary</p><p className="text-sm">{analysis.summary}</p></div>
            )}
            {analysis.discussion_summary && (
              <div><p className="text-xs font-medium text-muted-foreground mb-1">Discussion Summary</p><p className="text-sm">{analysis.discussion_summary}</p></div>
            )}

            {analysis.key_points && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Key Points</p>
                <ul className="text-sm space-y-1">
                  {(analysis.key_points || []).slice(0, 6).map((p: string, i: number) => (
                    <li key={i} className="flex items-start gap-2"><Zap className="h-3 w-3 mt-1 text-primary shrink-0" /><span>{p}</span></li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.key_findings && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Key Findings</p>
                <ul className="text-sm space-y-1">
                  {(analysis.key_findings || []).map((f: string, i: number) => (
                    <li key={i} className="flex items-start gap-2"><Zap className="h-3 w-3 mt-1 text-primary shrink-0" /><span>{f}</span></li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.common_pain_points && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Pain Points (Content Goldmines)</p>
                <div className="space-y-1">
                  {(analysis.common_pain_points || []).map((p: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <Badge variant="destructive" className="text-[10px] shrink-0">Pain</Badge>
                      <span>{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysis.questions_asked && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Unanswered Questions</p>
                <div className="space-y-1">
                  {(analysis.questions_asked || []).map((q: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <Badge variant="secondary" className="text-[10px] shrink-0">Q</Badge>
                      <span>{q}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysis.controversial_takes && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Controversial Takes</p>
                <div className="space-y-1">
                  {(analysis.controversial_takes || []).map((t: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <Swords className="h-3 w-3 mt-1 text-orange-500 shrink-0" />
                      <span>{t}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {styleData && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Style Fingerprint</p>
                <div className="flex flex-wrap gap-1">
                  {styleData.tone && <Badge variant="outline">{styleData.tone}</Badge>}
                  {styleData.sentence_length && <Badge variant="outline">{styleData.sentence_length}</Badge>}
                  {styleData.vocabulary_level && <Badge variant="outline">{styleData.vocabulary_level}</Badge>}
                  {styleData.emoji_usage && <Badge variant="outline">Emoji: {styleData.emoji_usage}</Badge>}
                  {styleData.sentence_structure && <Badge variant="outline">{styleData.sentence_structure}</Badge>}
                  {styleData.hook_technique && <Badge variant="outline">Hook: {styleData.hook_technique}</Badge>}
                </div>
              </div>
            )}

            {isXAccount && analysis.lessons_for_kishore && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Lessons for You</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {analysis.lessons_for_kishore.techniques_to_adopt && (
                    <div>
                      <p className="text-xs text-green-600 dark:text-green-400 font-medium mb-1">Adopt</p>
                      <ul className="text-xs space-y-0.5">
                        {(analysis.lessons_for_kishore.techniques_to_adopt || []).map((t: string, i: number) => <li key={i}>+ {t}</li>)}
                      </ul>
                    </div>
                  )}
                  {analysis.lessons_for_kishore.techniques_to_skip && (
                    <div>
                      <p className="text-xs text-red-600 dark:text-red-400 font-medium mb-1">Skip</p>
                      <ul className="text-xs space-y-0.5">
                        {(analysis.lessons_for_kishore.techniques_to_skip || []).map((t: string, i: number) => <li key={i}>- {t}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {(analysis.gaps_and_angles || analysis.content_ideas) && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Content Opportunities</p>
                <div className="space-y-2">
                  {(analysis.content_ideas || analysis.gaps_and_angles || []).slice(0, 5).map((item: any, i: number) => (
                    <div key={i} className="p-2 rounded-md border text-sm">
                      {typeof item === "string" ? (
                        <span>{item}</span>
                      ) : (
                        <>
                          <p className="font-medium">{item.idea}</p>
                          {item.hook && <p className="text-xs text-muted-foreground mt-0.5">Hook: "{item.hook}"</p>}
                          <div className="flex items-center gap-1 mt-1">
                            {item.format && <Badge variant="outline" className="text-[10px]">{item.format}</Badge>}
                            {item.angle && <span className="text-[10px] text-muted-foreground">{item.angle}</span>}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysis.engagement_metrics && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Engagement</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(analysis.engagement_metrics).filter(([, v]) => v != null).map(([k, v]) => (
                    <Badge key={k} variant="secondary">{k}: {String(v)}</Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Content Actions</p>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <Select value={actionContentType} onValueChange={setActionContentType}>
                  <SelectTrigger className="w-[140px]" data-testid="select-action-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tweet">Tweet</SelectItem>
                    <SelectItem value="thread">Thread</SelectItem>
                    <SelectItem value="hot_take">Hot Take</SelectItem>
                    <SelectItem value="article">Article</SelectItem>
                  </SelectContent>
                </Select>
                {styleData && (
                  <Button variant="outline" size="sm" onClick={() => { setStyleName(`${selectedRef.sourceAuthorUsername || selectedRef.title || "Unknown"} style`); setShowStyleSaveDialog(true); }} data-testid="button-save-style">
                    <Star className="h-3 w-3 mr-1" /> Save Style
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(ACTION_LABELS).map(([key, { label, icon: Icon, description }]) => (
                  <Button
                    key={key}
                    variant="outline"
                    size="sm"
                    className="flex flex-col h-auto py-2 text-left"
                    onClick={() => { setActiveAction(key); actionMutation.mutate({ action: key, referenceId: selectedRef.id, contentType: actionContentType }); }}
                    disabled={actionMutation.isPending}
                    data-testid={`button-action-${key}`}
                  >
                    {actionMutation.isPending && activeAction === key ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Icon className="h-3 w-3" />
                    )}
                    <span className="text-xs font-medium mt-0.5">{label}</span>
                    <span className="text-[10px] text-muted-foreground">{description}</span>
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {generatedContent?.variations && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium" data-testid="text-generated-header">Generated Content ({generatedContent.action ? ACTION_LABELS[generatedContent.action]?.label : "Variations"})</h3>
          {generatedContent.variations.map((variation: any, i: number) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-xs">Variation {i + 1}</CardTitle>
                <Button variant="outline" size="sm" onClick={() => saveDraftMutation.mutate(variation)} disabled={saveDraftMutation.isPending} data-testid={`button-save-variation-${i}`}>
                  <Save className="h-3 w-3 mr-1" /> Save Draft
                </Button>
              </CardHeader>
              <CardContent>
                {variation.tweets.map((t: any, j: number) => (
                  <div key={j} className="p-3 rounded-md border mb-2 last:mb-0">
                    <p className="text-sm whitespace-pre-wrap">{t.content}</p>
                    <span className="text-[10px] text-muted-foreground">{t.charCount} chars</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {drafts.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h2 className="text-lg font-semibold" data-testid="text-saved-drafts">Saved Drafts</h2>
            <Button variant="outline" size="sm" onClick={() => navigate("/calendar")} data-testid="button-view-all-drafts">
              <Calendar className="h-3 w-3 mr-1" /> View All on Calendar
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {drafts.map((draft) => {
              const tweets = (draft as any).tweets as any[] | undefined;
              const firstTweet = Array.isArray(tweets) && tweets.length > 0 ? tweets[0] : null;
              const preview = firstTweet?.content || "(empty draft)";
              return (
                <Card key={draft.id} className="hover-elevate cursor-pointer" onClick={() => navigate("/calendar")} data-testid={`card-draft-${draft.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {draft.postType === "thread" ? "Thread" : "Tweet"}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        <CheckCircle2 className="h-2 w-2 mr-0.5" /> Draft
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm line-clamp-3">{preview}</p>
                    {Array.isArray(tweets) && tweets.length > 1 && (
                      <p className="text-[10px] text-muted-foreground mt-1">+{tweets.length - 1} more tweets in thread</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-3" data-testid="text-recent-ingestions">Recent Ingestions</h2>
        {refsLoading ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : references.length === 0 ? (
          <Card className="py-8">
            <CardContent className="flex flex-col items-center gap-2">
              <Link2 className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No ingested content yet. Paste a URL, text, or screenshot above.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {references.map((ref) => {
              const refAnalysis = ref.analysisJson as any;
              return (
                <Card key={ref.id} className="hover-elevate cursor-pointer" onClick={() => { setSelectedRef(ref); setGeneratedContent(null); }} data-testid={`card-reference-${ref.id}`}>
                  <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm line-clamp-1">{ref.title || "Untitled"}</CardTitle>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{refAnalysis?.summary || refAnalysis?.discussion_summary || ""}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="secondary" className="text-[10px]">{SOURCE_TYPE_LABELS[ref.sourceType || ""] || ref.sourceType}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex items-center gap-2 flex-wrap">
                    {ref.sourcePlatform && <Badge variant="outline" className="text-[10px]">{ref.sourcePlatform}</Badge>}
                    {(ref.tags || []).slice(0, 2).map((tag, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{tag}</Badge>
                    ))}
                    <div className="ml-auto flex items-center gap-1">
                      {ref.isBookmarked && <BookmarkCheck className="h-3 w-3 text-primary" />}
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

      <Dialog open={showStyleSaveDialog} onOpenChange={setShowStyleSaveDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save Style Profile</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={styleName} onChange={(e) => setStyleName(e.target.value)} placeholder='e.g., "@levelsio style"' data-testid="input-style-name" />
            {styleData && (
              <div className="flex flex-wrap gap-1">
                {styleData.tone && <Badge variant="outline">{styleData.tone}</Badge>}
                {styleData.vocabulary_level && <Badge variant="outline">{styleData.vocabulary_level}</Badge>}
                {styleData.emoji_usage && <Badge variant="outline">Emoji: {styleData.emoji_usage}</Badge>}
              </div>
            )}
            <Button
              onClick={() => { if (selectedRef && styleName) saveStyleMutation.mutate({ name: styleName, ref: selectedRef }); }}
              disabled={!styleName || saveStyleMutation.isPending}
              className="w-full"
              data-testid="button-confirm-save-style"
            >
              {saveStyleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Save Style Profile
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
