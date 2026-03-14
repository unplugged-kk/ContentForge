import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Database, Plus, Trash2, Heart, Globe, Image, FileText, Loader2, Sparkles, X, Search, Upload } from "lucide-react";
import type { ContextVaultItem } from "@shared/schema";

const CATEGORIES = ["Insights", "Statistics", "Case Study", "Framework", "Quote", "Tool", "Research", "Personal Experience"];

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
  });
}

export default function VaultPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<"manual" | "url" | "image">("manual");
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [extractedUrl, setExtractedUrl] = useState<any>(null);
  const [extractedImage, setExtractedImage] = useState<any>(null);
  const [imageName, setImageName] = useState("");

  const { data: items = [], isLoading } = useQuery<ContextVaultItem[]>({ queryKey: ["/api/vault"] });

  const extractUrlMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/vault/extract-url", { url });
      return res.json();
    },
    onSuccess: (data) => {
      setExtractedUrl(data);
      setTitle(data.title || "");
      setContent(data.summary || "");
      setSourceUrl(data.url || "");
      setCategory("Insights");
      toast({ title: "Content extracted!", description: "Review and save to your vault." });
    },
    onError: (err: any) => toast({ title: "Extraction failed", description: err.message, variant: "destructive" }),
  });

  const extractImageMutation = useMutation({
    mutationFn: async ({ imageBase64, mimeType }: { imageBase64: string; mimeType: string }) => {
      const res = await apiRequest("POST", "/api/vault/extract-image", { imageBase64, mimeType });
      return res.json();
    },
    onSuccess: (data) => {
      setExtractedImage(data);
      setTitle(imageName || "Image Analysis");
      setContent(data.content || "");
      setCategory("Insights");
      toast({ title: "Image analyzed!", description: "Review and save to your vault." });
    },
    onError: (err: any) => toast({ title: "Analysis failed", description: err.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vault", { title, content, category, sourceUrl, sourceType: addMode });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vault"] });
      setShowAdd(false);
      resetForm();
      toast({ title: "Saved to vault!" });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const favoriteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/vault/${id}/favorite`, {});
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/vault"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/vault/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vault"] });
      toast({ title: "Item deleted" });
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageName(file.name);
    const base64 = await toBase64(file);
    extractImageMutation.mutate({ imageBase64: base64, mimeType: file.type });
  };

  const resetForm = () => {
    setTitle(""); setContent(""); setCategory(""); setSourceUrl(""); setUrlInput("");
    setExtractedUrl(null); setExtractedImage(null); setImageName(""); setAddMode("manual");
  };

  const filtered = items.filter(item => {
    const matchSearch = !search || item.title.toLowerCase().includes(search.toLowerCase()) || item.content.toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCategory === "all" || item.category === filterCategory;
    return matchSearch && matchCat;
  });

  const sourceIcon = (type: string | null) => {
    if (type === "url") return <Globe className="h-3 w-3" />;
    if (type === "image") return <Image className="h-3 w-3" />;
    return <FileText className="h-3 w-3" />;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2" data-testid="text-vault-title">
            <Database className="h-5 w-5 text-primary" /> Context Vault
          </h1>
          <p className="text-xs text-muted-foreground">Store key facts, insights, and references that AI uses to personalize your content</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{items.length} items</Badge>
          <Button size="sm" onClick={() => setShowAdd(true)} data-testid="button-add-vault">
            <Plus className="h-4 w-4 mr-1.5" />Add Item
          </Button>
        </div>
      </div>

      <div className="p-4 border-b flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search vault..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" data-testid="input-vault-search" />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="h-8 text-sm w-36" data-testid="select-vault-category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1,2,3,4,5,6].map(i => <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <Database className="h-12 w-12 text-muted-foreground/30" />
            <div>
              <p className="font-medium">Your vault is empty</p>
              <p className="text-sm text-muted-foreground mt-1">Add key facts, insights, and references that AI will use to personalize your content generation</p>
            </div>
            <Button onClick={() => setShowAdd(true)} data-testid="button-add-first-vault">
              <Plus className="h-4 w-4 mr-2" />Add Your First Item
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(item => (
              <Card key={item.id} className="p-3 flex flex-col gap-2 group" data-testid={`card-vault-${item.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-medium line-clamp-2 flex-1">{item.title}</h3>
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => favoriteMutation.mutate(item.id)} className={`p-1 rounded hover:bg-muted ${item.isFavorite ? "text-red-400" : "text-muted-foreground"}`}>
                      <Heart className="h-3.5 w-3.5" fill={item.isFavorite ? "currentColor" : "none"} />
                    </button>
                    <button onClick={() => deleteMutation.mutate(item.id)} className="p-1 rounded hover:bg-red-100 text-muted-foreground hover:text-red-500" data-testid={`button-delete-vault-${item.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-4">{item.content}</p>
                <div className="flex items-center gap-1.5 mt-auto">
                  {item.category && <Badge variant="secondary" className="text-[10px] px-1.5">{item.category}</Badge>}
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 ml-auto">
                    {sourceIcon(item.sourceType)}{item.sourceType || "manual"}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showAdd} onOpenChange={(open) => { if (!open) { setShowAdd(false); resetForm(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add to Context Vault</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              {[
                { mode: "manual", icon: FileText, label: "Manual" },
                { mode: "url", icon: Globe, label: "From URL" },
                { mode: "image", icon: Image, label: "From Image" },
              ].map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  onClick={() => { setAddMode(mode as any); setExtractedUrl(null); setExtractedImage(null); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md border text-sm transition-all ${addMode === mode ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-muted-foreground"}`}
                  data-testid={`button-vault-mode-${mode}`}
                >
                  <Icon className="h-4 w-4" />{label}
                </button>
              ))}
            </div>

            {addMode === "url" && !extractedUrl && (
              <div className="flex gap-2">
                <Input placeholder="https://..." value={urlInput} onChange={e => setUrlInput(e.target.value)} data-testid="input-vault-url" />
                <Button onClick={() => extractUrlMutation.mutate(urlInput)} disabled={!urlInput || extractUrlMutation.isPending} data-testid="button-extract-url">
                  {extractUrlMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                </Button>
              </div>
            )}

            {addMode === "image" && !extractedImage && (
              <div className="space-y-2">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} data-testid="input-vault-image" />
                <Button variant="outline" className="w-full" onClick={() => fileInputRef.current?.click()} disabled={extractImageMutation.isPending}>
                  {extractImageMutation.isPending
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Analyzing image...</>
                    : <><Upload className="h-4 w-4 mr-2" />Upload Image to Analyze</>}
                </Button>
                <p className="text-xs text-muted-foreground">AI will extract text, charts, and key insights from your image</p>
              </div>
            )}

            {(addMode === "manual" || extractedUrl || extractedImage) && (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Title</label>
                  <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Descriptive title..." data-testid="input-vault-title" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Content</label>
                  <Textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Key facts, insights, or notes..." className="min-h-[120px] resize-none text-sm" data-testid="textarea-vault-content" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="text-sm"><SelectValue placeholder="Category" /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                  {addMode !== "url" && <Input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="Source URL (optional)" className="text-sm" />}
                </div>
                <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={!title || !content || saveMutation.isPending} data-testid="button-save-vault">
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Database className="h-4 w-4 mr-2" />}
                  Save to Vault
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
