import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Image, Sparkles, Loader2, Heart, Trash2, Download, Wand2, Copy } from "lucide-react";
import type { GeneratedImage } from "@shared/schema";

const STYLES = [
  { value: "professional", label: "Professional", desc: "Clean, corporate photography" },
  { value: "minimal", label: "Minimal", desc: "Clean lines, white space" },
  { value: "technical", label: "Technical", desc: "Diagrams, infographics" },
  { value: "bold", label: "Bold", desc: "Strong contrast, impactful" },
  { value: "warm", label: "Warm", desc: "Human-centered, relatable" },
];

const ASPECT_RATIOS = [
  { value: "1:1", label: "Square (1:1)", desc: "Best for feed posts" },
  { value: "16:9", label: "Landscape (16:9)", desc: "Best for articles/headers" },
  { value: "9:16", label: "Portrait (9:16)", desc: "Best for stories" },
];

const QUICK_PROMPTS = [
  "Data pipeline architecture diagram with flowing connections",
  "Kubernetes cluster with pods and services visualization",
  "Abstract representation of AI and machine learning",
  "Cloud infrastructure with AWS/Azure/GCP icons",
  "Engineer working on a laptop with code and dashboards",
  "Team collaboration in a modern tech office",
  "Digital transformation concept with technology layers",
  "MLOps workflow from data to model to production",
];

export default function ImageGenPage() {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("professional");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [filter, setFilter] = useState<"all" | "favorites">("all");

  const { data: images = [], isLoading } = useQuery<GeneratedImage[]>({
    queryKey: ["/api/images"],
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/images/generate", { prompt, style, aspectRatio });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/images"] });
      toast({ title: "Image generated!" });
    },
    onError: (err: any) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/images/${id}/favorite`, {});
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/images"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/images/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/images"] });
      toast({ title: "Image deleted" });
    },
  });

  const filtered = filter === "favorites" ? images.filter(i => i.isFavorite) : images;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2" data-testid="text-imagegen-title">
            <Image className="h-5 w-5 text-primary" />
            AI Image Generation
          </h1>
          <p className="text-xs text-muted-foreground">Create on-brand visuals for your posts using AI</p>
        </div>
        <Badge variant="secondary">{images.length} generated</Badge>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 max-w-7xl mx-auto">
          <div className="xl:col-span-1 space-y-4">
            <Card className="p-4 space-y-4">
              <h2 className="text-sm font-semibold">Generate Image</h2>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Image Description</label>
                <Textarea
                  placeholder="Describe the image you want to create..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[100px] resize-none text-sm"
                  data-testid="textarea-image-prompt"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Style</label>
                <Select value={style} onValueChange={setStyle}>
                  <SelectTrigger data-testid="select-image-style">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STYLES.map(s => (
                      <SelectItem key={s.value} value={s.value}>
                        <div>
                          <div className="font-medium text-sm">{s.label}</div>
                          <div className="text-xs text-muted-foreground">{s.desc}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Aspect Ratio</label>
                <div className="grid grid-cols-3 gap-2">
                  {ASPECT_RATIOS.map(r => (
                    <button
                      key={r.value}
                      onClick={() => setAspectRatio(r.value)}
                      className={`p-2 rounded-md border text-center transition-all text-xs ${aspectRatio === r.value ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-muted-foreground"}`}
                      data-testid={`button-ratio-${r.value.replace(":", "-")}`}
                    >
                      <div className="font-medium">{r.value}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{r.desc.split("Best for ")[1]}</div>
                    </button>
                  ))}
                </div>
              </div>

              <Button
                className="w-full"
                onClick={() => generateMutation.mutate()}
                disabled={!prompt.trim() || generateMutation.isPending}
                data-testid="button-generate-image"
              >
                {generateMutation.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Generating...</>
                  : <><Wand2 className="h-4 w-4 mr-2" />Generate Image</>}
              </Button>
            </Card>

            <Card className="p-4 space-y-3">
              <h2 className="text-sm font-semibold">Quick Prompts</h2>
              <div className="space-y-1.5">
                {QUICK_PROMPTS.map((qp, i) => (
                  <button
                    key={i}
                    onClick={() => setPrompt(qp)}
                    className="w-full text-left text-xs p-2 rounded hover:bg-muted/50 transition-colors border border-transparent hover:border-border line-clamp-2"
                    data-testid={`button-quick-prompt-${i}`}
                  >
                    {qp}
                  </button>
                ))}
              </div>
            </Card>
          </div>

          <div className="xl:col-span-2 space-y-4">
            <div className="flex items-center gap-2">
              <Button
                variant={filter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("all")}
                data-testid="button-filter-all"
              >All Images ({images.length})</Button>
              <Button
                variant={filter === "favorites" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("favorites")}
                data-testid="button-filter-favorites"
              >
                <Heart className="h-3.5 w-3.5 mr-1" />
                Favorites ({images.filter(i => i.isFavorite).length})
              </Button>
            </div>

            {generateMutation.isPending && (
              <Card className="p-8 flex flex-col items-center justify-center gap-3 border-dashed border-primary/40 bg-primary/5">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <div className="text-sm text-center">
                  <p className="font-medium">Creating your image...</p>
                  <p className="text-xs text-muted-foreground mt-1">DALL-E 3 is generating your visual. This takes ~15 seconds.</p>
                </div>
              </Card>
            )}

            {isLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="aspect-square bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <Card className="p-12 flex flex-col items-center justify-center gap-3 text-center border-dashed">
                <Image className="h-10 w-10 text-muted-foreground/40" />
                <div>
                  <p className="text-sm font-medium">No images yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Generate your first AI image using the form on the left</p>
                </div>
              </Card>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filtered.map((img) => (
                  <Card key={img.id} className="overflow-hidden group" data-testid={`card-image-${img.id}`}>
                    <div className="relative aspect-square bg-muted">
                      <img
                        src={img.imageUrl}
                        alt={img.prompt}
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          onClick={() => favoriteMutation.mutate(img.id)}
                          className={`p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors ${img.isFavorite ? "text-red-400" : "text-white"}`}
                          data-testid={`button-favorite-${img.id}`}
                        >
                          <Heart className="h-4 w-4" fill={img.isFavorite ? "currentColor" : "none"} />
                        </button>
                        <a
                          href={img.imageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-white"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                        <button
                          onClick={() => { navigator.clipboard.writeText(img.prompt); toast({ title: "Prompt copied!" }); }}
                          className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-white"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => deleteMutation.mutate(img.id)}
                          className="p-2 rounded-full bg-white/20 hover:bg-red-500/60 transition-colors text-white"
                          data-testid={`button-delete-image-${img.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      {img.isFavorite && (
                        <div className="absolute top-2 right-2">
                          <Heart className="h-4 w-4 text-red-400" fill="currentColor" />
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{img.style}</Badge>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{img.aspectRatio}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{img.prompt}</p>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
