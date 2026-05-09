import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TipTapEditor } from "@/components/tiptap-editor";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, FileText, Loader2, Wand2, ArrowRight, BookOpen, Clock, Trash2, ChevronUp, MessageSquare, ListOrdered } from "lucide-react";
import type { Article, Pillar } from "@shared/schema";

const ARTICLE_TEMPLATES = [
  { id: "deep_dive", name: "Technical Deep Dive", desc: "How [Technology] Works Under the Hood" },
  { id: "case_study", name: "Case Study", desc: "How We [Achievement] at [Company]" },
  { id: "comparison", name: "Comparison", desc: "[Tool A] vs [Tool B]: An Honest Breakdown" },
  { id: "tutorial", name: "Tutorial", desc: "Step-by-Step: [Building/Setting Up X]" },
  { id: "opinion", name: "Opinion/Hot Take", desc: "Why [Controversial Claim] Is Actually Right" },
  { id: "lessons", name: "Lessons Learned", desc: "[N] Things I Wish I Knew About [Topic]" },
  { id: "analysis", name: "Industry Analysis", desc: "The State of [Technology] in [Year]" },
  { id: "career", name: "Career Story", desc: "From [Role A] to [Role B]: What Actually Changed" },
];

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  writing: "bg-blue-500/20 text-blue-400",
  ready: "bg-green-500/20 text-green-400",
  published: "bg-purple-500/20 text-purple-400",
};

function ArticleEditor({ article, pillars, onBack }: { article: Article; pillars: Pillar[]; onBack: () => void }) {
  const { toast } = useToast();
  const [editTitle, setEditTitle] = useState(article.title);
  const [editSubtitle, setEditSubtitle] = useState(article.subtitle || "");
  const [editorContent, setEditorContent] = useState(article.contentHtml || "");
  const [outline, setOutline] = useState<any>(null);
  const [showOutline, setShowOutline] = useState(false);

  useEffect(() => {
    setEditTitle(article.title);
    setEditSubtitle(article.subtitle || "");
    setEditorContent(article.contentHtml || "");
  }, [article.id]);

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PUT", `/api/articles/${article.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      toast({ title: "Article saved" });
    },
  });

  const outlineMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/articles/${article.id}/generate-outline`, { topic: editTitle });
      return res.json();
    },
    onSuccess: (data) => {
      setOutline(data);
      setShowOutline(true);
      toast({ title: "Outline generated" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const expandSectionMutation = useMutation({
    mutationFn: async ({ heading, description, keyPoints }: any) => {
      const res = await apiRequest("POST", `/api/articles/${article.id}/expand-section`, { heading, description, keyPoints });
      return res.json();
    },
    onSuccess: (data) => {
      setEditorContent((prev) => prev + "\n\n" + data.content);
      toast({ title: "Section expanded" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const generateFullMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/articles/${article.id}/generate-full`, { outline });
      return res.json();
    },
    onSuccess: (data) => {
      setEditorContent(data.content);
      toast({ title: "Full article generated" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const toThreadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/articles/${article.id}/to-thread`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
      toast({ title: "Thread created from article" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const plainText = editorContent.replace(/<[^>]*>/g, "");
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;
  const charCount = plainText.length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  const handleSave = () => {
    updateMutation.mutate({
      title: editTitle,
      subtitle: editSubtitle || null,
      contentHtml: editorContent,
      wordCount,
      estimatedReadMinutes: readTime,
    });
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex items-center justify-between gap-2 p-4 border-b flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-articles">Back</Button>
          <Badge className={statusColors[article.status || "draft"]}>{article.status || "draft"}</Badge>
          <span className="text-xs text-muted-foreground">{wordCount} words</span>
          <span className="text-xs text-muted-foreground">{charCount} / 25,000 chars</span>
          <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> {readTime} min read</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => outlineMutation.mutate()} disabled={outlineMutation.isPending} data-testid="button-generate-outline">
            {outlineMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListOrdered className="h-3 w-3" />}
            <span className="ml-1">Outline</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => generateFullMutation.mutate()} disabled={generateFullMutation.isPending || !editTitle} data-testid="button-generate-full">
            {generateFullMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
            <span className="ml-1">Generate Full</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => toThreadMutation.mutate()} disabled={toThreadMutation.isPending || !editorContent} data-testid="button-to-thread">
            <MessageSquare className="h-3 w-3" />
            <span className="ml-1">To Thread</span>
          </Button>
          <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save-article">
            {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
          </Button>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-4 overflow-auto">
        {showOutline && outline?.sections && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm">Article Outline</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setShowOutline(false)} data-testid="button-close-outline">
                <ChevronUp className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {outline.sections.map((section: any, i: number) => (
                <div key={i} className="flex items-start justify-between gap-2 p-2 rounded-md border">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{section.heading}</p>
                    <p className="text-xs text-muted-foreground">{section.description}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => expandSectionMutation.mutate({ heading: section.heading, description: section.description, keyPoints: section.key_points })} disabled={expandSectionMutation.isPending} data-testid={`button-expand-section-${i}`}>
                    {expandSectionMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-full" onClick={() => generateFullMutation.mutate()} disabled={generateFullMutation.isPending} data-testid="button-generate-full-from-outline">
                {generateFullMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Wand2 className="h-4 w-4 mr-1" />}
                Generate Full Article from Outline
              </Button>
            </CardContent>
          </Card>
        )}

        {!editorContent && !generateFullMutation.isPending && (
          <div className="rounded-md border border-dashed p-4 flex items-center justify-between gap-3" data-testid="banner-generate-article">
            <div>
              <p className="text-sm font-medium">Article body is empty</p>
              <p className="text-xs text-muted-foreground">Click "Generate Full" in the toolbar to write the full article from the title, or start typing below.</p>
            </div>
            <Button size="sm" onClick={() => generateFullMutation.mutate()} disabled={!editTitle} data-testid="button-generate-full-inline">
              <Wand2 className="h-3 w-3 mr-1" /> Generate Full
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Article title..." className="text-xl font-bold border-0 px-0 focus-visible:ring-0" data-testid="input-article-title" />
          <Input value={editSubtitle} onChange={(e) => setEditSubtitle(e.target.value)} placeholder="Subtitle (optional)..." className="text-sm text-muted-foreground border-0 px-0 focus-visible:ring-0" data-testid="input-article-subtitle" />
        </div>

        <TipTapEditor
          content={editorContent}
          onChange={setEditorContent}
          placeholder="Start writing your article here..."
        />
      </div>
    </div>
  );
}

export default function ArticlesPage() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedPillar, setSelectedPillar] = useState("");

  const { data: articles = [], isLoading } = useQuery<Article[]>({ queryKey: ["/api/articles"] });
  const { data: pillars = [] } = useQuery<Pillar[]>({ queryKey: ["/api/pillars"] });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/articles", data);
      return res.json();
    },
    onSuccess: (article) => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      setShowCreate(false);
      setEditingId(article.id);
      setTitle("");
      setSubtitle("");
      setSelectedTemplate("");
      setSelectedPillar("");
      toast({ title: "Article created" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/articles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      setEditingId(null);
      toast({ title: "Article deleted" });
    },
  });

  const editingArticle = articles.find((a) => a.id === editingId);

  if (editingId && editingArticle) {
    return <ArticleEditor article={editingArticle} pillars={pillars} onBack={() => setEditingId(null)} />;
  }

  return (
    <div className="flex flex-col h-full overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-articles-title">X Articles</h1>
          <p className="text-sm text-muted-foreground">Long-form content for X Articles (up to 25,000 characters)</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-article">
              <Plus className="h-4 w-4 mr-1" />
              New Article
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Article</DialogTitle>
              <DialogDescription>Set up your article with a title, template, and content pillar.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Title</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Article title..." maxLength={200} data-testid="input-new-title" />
              </div>
              <div>
                <label className="text-sm font-medium">Subtitle</label>
                <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Optional subtitle..." maxLength={300} data-testid="input-new-subtitle" />
              </div>
              <div>
                <label className="text-sm font-medium">Content Pillar</label>
                <Select value={selectedPillar} onValueChange={setSelectedPillar}>
                  <SelectTrigger data-testid="select-pillar"><SelectValue placeholder="Select pillar" /></SelectTrigger>
                  <SelectContent>
                    {pillars.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Article Template</label>
                <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                  <SelectTrigger data-testid="select-template"><SelectValue placeholder="Select template" /></SelectTrigger>
                  <SelectContent>
                    {ARTICLE_TEMPLATES.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} - {t.desc}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" onClick={() => createMutation.mutate({ title, subtitle: subtitle || null, pillarId: selectedPillar ? parseInt(selectedPillar) : null, articleTemplate: selectedTemplate || null, contentJson: {} })} disabled={!title || createMutation.isPending} data-testid="button-create-article">
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                Create Article
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : articles.length === 0 ? (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center gap-3">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">No articles yet. Create your first X Article.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {articles.map((article) => {
            const pillar = pillars.find((p) => p.id === article.pillarId);
            return (
              <Card key={article.id} className="hover-elevate cursor-pointer" onClick={() => setEditingId(article.id)} data-testid={`card-article-${article.id}`}>
                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-sm line-clamp-2">{article.title}</CardTitle>
                    {article.subtitle && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{article.subtitle}</p>}
                  </div>
                  <Badge className={statusColors[article.status || "draft"]}>{article.status || "draft"}</Badge>
                </CardHeader>
                <CardContent className="flex items-center gap-2 flex-wrap">
                  {pillar && <Badge variant="outline" className="text-[10px]" style={{ borderColor: pillar.color || undefined }}>{pillar.name.split(" ")[0]}</Badge>}
                  {article.articleTemplate && <Badge variant="secondary" className="text-[10px]">{ARTICLE_TEMPLATES.find((t) => t.id === article.articleTemplate)?.name || article.articleTemplate}</Badge>}
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1"><BookOpen className="h-3 w-3" /> {article.wordCount || 0} words</span>
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> {article.estimatedReadMinutes || 0} min</span>
                  <Button variant="ghost" size="icon" className="ml-auto" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(article.id); }} data-testid={`button-delete-article-${article.id}`}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
