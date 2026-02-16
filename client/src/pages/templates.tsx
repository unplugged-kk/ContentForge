import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CONTENT_PILLARS } from "@/lib/constants";
import { LayoutTemplate, Sparkles, Copy, Save, ArrowRight } from "lucide-react";
import type { Template } from "@shared/schema";

export default function TemplatesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [filledContent, setFilledContent] = useState<string | null>(null);

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["/api/templates"],
  });

  const fillMutation = useMutation({
    mutationFn: async (templateId: number) => {
      const res = await apiRequest("POST", "/api/templates/fill", { templateId });
      return res.json() as Promise<{ content: string; model: string }>;
    },
    onSuccess: (data) => {
      setFilledContent(data.content);
    },
    onError: (err) => {
      toast({ title: "Fill failed", description: err.message, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!filledContent || !selectedTemplate) return;
      const res = await apiRequest("POST", "/api/posts", {
        pillarId: selectedTemplate.pillarId,
        postType: selectedTemplate.postType || "tweet",
        tone: "conversational",
        targetPlatform: "both",
        status: "draft",
        tweets: [{ content: filledContent, position: 0, charCount: filledContent.length }],
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved as draft" });
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
      setSelectedTemplate(null);
      setFilledContent(null);
    },
  });

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const getPillarInfo = (id: number | null) =>
    id ? CONTENT_PILLARS.find((p) => p.id === id) : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h1 className="text-lg font-semibold" data-testid="text-templates-title">Template Library</h1>
          <p className="text-xs text-muted-foreground">Pre-built content templates powered by AI</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-12 w-full mb-2" />
                <Skeleton className="h-3 w-1/4" />
              </Card>
            ))}
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <LayoutTemplate className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm font-medium">Templates loading...</p>
            <p className="text-xs text-muted-foreground mt-1">
              Pre-built templates will appear here
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {templates.map((template) => {
              const pillar = getPillarInfo(template.pillarId);
              return (
                <Card
                  key={template.id}
                  className="p-4 space-y-3 hover-elevate cursor-pointer"
                  onClick={() => {
                    setSelectedTemplate(template);
                    setFilledContent(null);
                  }}
                  data-testid={`card-template-${template.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-medium leading-tight">{template.name}</h3>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                  <p className="text-xs text-muted-foreground font-mono bg-muted/50 rounded px-2 py-1.5">
                    {template.pattern}
                  </p>
                  <div className="flex items-center gap-1.5">
                    {pillar && (
                      <Badge variant="outline" className="text-[10px]">
                        <span className="h-1.5 w-1.5 rounded-full mr-1" style={{ backgroundColor: pillar.color }} />
                        {pillar.name.split(" ")[0]}
                      </Badge>
                    )}
                    {template.postType && (
                      <Badge variant="secondary" className="text-[10px]">{template.postType}</Badge>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!selectedTemplate} onOpenChange={() => { setSelectedTemplate(null); setFilledContent(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">{selectedTemplate?.name}</DialogTitle>
          </DialogHeader>
          {selectedTemplate && (
            <div className="space-y-3">
              <div className="bg-muted/50 rounded-md p-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">Template Pattern</p>
                <p className="text-sm font-mono">{selectedTemplate.pattern}</p>
              </div>

              {!filledContent && (
                <Button
                  className="w-full"
                  onClick={() => fillMutation.mutate(selectedTemplate.id)}
                  disabled={fillMutation.isPending}
                  data-testid="button-fill-template"
                >
                  {fillMutation.isPending ? (
                    "Generating..."
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Fill with AI
                    </>
                  )}
                </Button>
              )}

              {filledContent && (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Generated Content</p>
                    <Textarea
                      value={filledContent}
                      onChange={(e) => setFilledContent(e.target.value)}
                      className="text-sm resize-none"
                      rows={6}
                      data-testid="input-filled-content"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      onClick={() => saveMutation.mutate()}
                      disabled={saveMutation.isPending}
                      data-testid="button-save-template-draft"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save as Draft
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => handleCopy(filledContent)}
                      data-testid="button-copy-filled"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
