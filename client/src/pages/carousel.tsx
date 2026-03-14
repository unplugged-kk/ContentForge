import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { LayoutGrid, Plus, Sparkles, Loader2, Trash2, Edit2, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { CONTENT_PILLARS, CAROUSEL_BACKGROUNDS } from "@/lib/constants";
import type { Carousel } from "@shared/schema";

interface Slide {
  slideNumber: number;
  type: "cover" | "content" | "cta";
  heading: string;
  subheading?: string;
  bullets?: string[];
  body?: string;
  cta?: string;
  emoji?: string;
}

function SlidePreview({ slide, bg, isActive }: { slide: Slide; bg: typeof CAROUSEL_BACKGROUNDS[number]; isActive: boolean }) {
  return (
    <div
      className={`aspect-square rounded-lg flex flex-col justify-between p-4 text-white cursor-pointer transition-all ${isActive ? "ring-2 ring-primary ring-offset-2" : "opacity-70 hover:opacity-90"}`}
      style={{ background: `linear-gradient(135deg, ${bg.from}, ${bg.to})` }}
    >
      {slide.emoji && <div className="text-2xl">{slide.emoji}</div>}
      <div className="space-y-1.5">
        <div className="text-[10px] font-medium opacity-60">{slide.type === "cover" ? "COVER" : slide.type === "cta" ? "CTA" : `SLIDE ${slide.slideNumber}`}</div>
        <h3 className="text-sm font-bold leading-tight">{slide.heading}</h3>
        {slide.subheading && <p className="text-[10px] opacity-80">{slide.subheading}</p>}
        {slide.bullets && (
          <ul className="text-[10px] opacity-80 space-y-0.5">
            {slide.bullets.slice(0, 3).map((b, i) => <li key={i}>• {b}</li>)}
          </ul>
        )}
        {slide.cta && <p className="text-[10px] font-semibold opacity-90">{slide.cta}</p>}
      </div>
    </div>
  );
}

export default function CarouselPage() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [topic, setTopic] = useState("");
  const [pillarId, setPillarId] = useState("");
  const [slideCount, setSlideCount] = useState("8");
  const [bgStyle, setBgStyle] = useState("gradient-blue");
  const [selectedCarousel, setSelectedCarousel] = useState<Carousel | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);

  const { data: carousels = [], isLoading } = useQuery<Carousel[]>({ queryKey: ["/api/carousels"] });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/carousels/generate", {
        topic,
        pillarId: pillarId ? parseInt(pillarId) : undefined,
        slideCount: parseInt(slideCount),
        tone: "educational",
      });
      return res.json();
    },
    onSuccess: async (data) => {
      const saveRes = await apiRequest("POST", "/api/carousels", {
        title: data.title || topic,
        pillarId: pillarId ? parseInt(pillarId) : null,
        slides: data.slides || [],
        backgroundStyle: bgStyle,
        platform: "linkedin",
      });
      const saved = await saveRes.json();
      queryClient.invalidateQueries({ queryKey: ["/api/carousels"] });
      setSelectedCarousel(saved);
      setActiveSlide(0);
      setShowCreate(false);
      toast({ title: "Carousel created!", description: `${(data.slides || []).length} slides generated` });
    },
    onError: (err: any) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/carousels/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/carousels"] });
      if (selectedCarousel) setSelectedCarousel(null);
      toast({ title: "Carousel deleted" });
    },
  });

  const currentBg = CAROUSEL_BACKGROUNDS.find(b => b.value === (selectedCarousel?.backgroundStyle || bgStyle)) || CAROUSEL_BACKGROUNDS[0];
  const slides = (selectedCarousel?.slides || []) as Slide[];

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2" data-testid="text-carousel-title">
            <LayoutGrid className="h-5 w-5 text-primary" />Carousel Builder
          </h1>
          <p className="text-xs text-muted-foreground">Create multi-slide LinkedIn carousels with AI</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-carousel">
          <Plus className="h-4 w-4 mr-1.5" />New Carousel
        </Button>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="w-64 border-r flex flex-col">
          <div className="p-3 border-b flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">My Carousels</span>
            <Badge variant="secondary" className="text-[10px]">{carousels.length}</Badge>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1.5">
            {isLoading ? <div className="animate-pulse space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-muted rounded" />)}</div>
            : carousels.length === 0 ? (
              <div className="text-center py-8">
                <LayoutGrid className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No carousels yet</p>
              </div>
            ) : carousels.map(c => (
              <button
                key={c.id}
                onClick={() => { setSelectedCarousel(c); setActiveSlide(0); }}
                className={`w-full text-left p-2.5 rounded-md transition-colors ${selectedCarousel?.id === c.id ? "bg-primary/10 border border-primary/20" : "hover:bg-muted"}`}
                data-testid={`button-carousel-${c.id}`}
              >
                <p className="text-xs font-medium line-clamp-2">{c.title}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{(c.slides as Slide[]).length} slides · {c.platform}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {!selectedCarousel ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <LayoutGrid className="h-12 w-12 text-muted-foreground/30" />
              <div>
                <p className="font-medium">No carousel selected</p>
                <p className="text-sm text-muted-foreground mt-1">Create a new carousel or select one from the list</p>
              </div>
              <Button onClick={() => setShowCreate(true)}>
                <Sparkles className="h-4 w-4 mr-2" />Generate with AI
              </Button>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">{selectedCarousel.title}</h2>
                  <p className="text-xs text-muted-foreground">{slides.length} slides · {selectedCarousel.platform}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => deleteMutation.mutate(selectedCarousel.id)} data-testid="button-delete-carousel">
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {slides.map((slide, i) => (
                  <SlidePreview key={i} slide={slide} bg={currentBg} isActive={activeSlide === i} />
                ))}
              </div>

              {slides.length > 0 && (
                <Card className="p-6" style={{ background: `linear-gradient(135deg, ${currentBg.from}, ${currentBg.to})` }}>
                  <div className="flex items-center justify-between mb-4">
                    <Button variant="ghost" size="sm" onClick={() => setActiveSlide(Math.max(0, activeSlide - 1))} disabled={activeSlide === 0} className="text-white/70 hover:text-white hover:bg-white/10">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-white/60 text-xs">{activeSlide + 1} / {slides.length}</span>
                    <Button variant="ghost" size="sm" onClick={() => setActiveSlide(Math.min(slides.length - 1, activeSlide + 1))} disabled={activeSlide === slides.length - 1} className="text-white/70 hover:text-white hover:bg-white/10">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  {slides[activeSlide] && (
                    <div className="text-white text-center space-y-3 py-6">
                      {slides[activeSlide].emoji && <div className="text-5xl">{slides[activeSlide].emoji}</div>}
                      <h2 className="text-2xl font-bold">{slides[activeSlide].heading}</h2>
                      {slides[activeSlide].subheading && <p className="text-white/80">{slides[activeSlide].subheading}</p>}
                      {slides[activeSlide].bullets && (
                        <ul className="text-left inline-block space-y-2 text-white/90">
                          {slides[activeSlide].bullets!.map((b, i) => <li key={i} className="flex gap-2"><span>→</span><span>{b}</span></li>)}
                        </ul>
                      )}
                      {slides[activeSlide].body && <p className="text-white/80">{slides[activeSlide].body}</p>}
                      {slides[activeSlide].cta && <p className="font-bold text-lg">{slides[activeSlide].cta}</p>}
                    </div>
                  )}
                </Card>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create AI Carousel</DialogTitle>
            <DialogDescription>Generate a multi-slide LinkedIn carousel with AI. Choose your topic, pillar, and style.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Topic / Title</label>
              <Input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. 5 MLOps mistakes that kill model performance" data-testid="input-carousel-topic" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Content Pillar</label>
                <Select value={pillarId} onValueChange={setPillarId}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Any pillar</SelectItem>
                    {CONTENT_PILLARS.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Slide Count</label>
                <Select value={slideCount} onValueChange={setSlideCount}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">6 slides</SelectItem>
                    <SelectItem value="8">8 slides</SelectItem>
                    <SelectItem value="10">10 slides</SelectItem>
                    <SelectItem value="12">12 slides</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Background Style</label>
              <div className="grid grid-cols-3 gap-2">
                {CAROUSEL_BACKGROUNDS.map(bg => (
                  <button
                    key={bg.value}
                    onClick={() => setBgStyle(bg.value)}
                    className={`h-10 rounded-md transition-all ${bgStyle === bg.value ? "ring-2 ring-primary ring-offset-2" : "opacity-70 hover:opacity-90"}`}
                    style={{ background: `linear-gradient(135deg, ${bg.from}, ${bg.to})` }}
                    title={bg.label}
                    data-testid={`button-bg-${bg.value}`}
                  />
                ))}
              </div>
            </div>
            <Button className="w-full" onClick={() => generateMutation.mutate()} disabled={!topic || generateMutation.isPending} data-testid="button-generate-carousel">
              {generateMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Generating {slideCount} slides...</>
                : <><Sparkles className="h-4 w-4 mr-2" />Generate Carousel</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
