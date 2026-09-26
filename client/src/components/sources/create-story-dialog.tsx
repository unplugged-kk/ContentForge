import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, Sparkles, BookOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface CreateStoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle?: string;
  initialBody?: string;
  researchJobId?: number | null;
  evidenceRefs?: number[];
  provenance?: "researched" | "human" | "imported";
  onSuccessStory?: (story: { id: number; title: string }) => void;
}

export function CreateStoryDialog({
  open,
  onOpenChange,
  initialTitle = "",
  initialBody = "",
  researchJobId = null,
  evidenceRefs = [],
  provenance = researchJobId ? "researched" : "human",
  onSuccessStory,
}: CreateStoryDialogProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [title, setTitle] = useState(initialTitle);
  const [insightBody, setInsightBody] = useState(initialBody);
  const [newAngle, setNewAngle] = useState("");
  const [angles, setAngles] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setInsightBody(initialBody);
      setAngles([]);
      setNewAngle("");
    }
  }, [open, initialTitle, initialBody]);

  const addAngle = () => {
    const trimmed = newAngle.trim();
    if (trimmed && !angles.includes(trimmed)) {
      setAngles([...angles, trimmed]);
      setNewAngle("");
    }
  };

  const removeAngle = (idx: number) => {
    setAngles(angles.filter((_, i) => i !== idx));
  };

  const storyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stories", {
        researchJobId: researchJobId || null,
        title: title.trim(),
        insightBody: insightBody.trim(),
        angles: angles.length > 0 ? angles : undefined,
        evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : undefined,
        provenance,
        status: "ready",
      });
      return res.json() as Promise<{ id: number; title: string }>;
    },
    onSuccess: (story) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      onOpenChange(false);
      onSuccessStory?.(story);
      toast({
        title: "Story Created",
        description: `"${story.title}" is ready for content generation.`,
        action: (
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7"
            onClick={() => navigate(`/create?storyId=${story.id}`)}
          >
            Create Content
          </Button>
        ),
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to create story",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-create-story">
        <DialogHeader className="space-y-1.5 pb-2 border-b">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <DialogTitle className="text-base font-bold">Create Story from Research</DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Synthesize your findings into a core narrative before generating multi-channel content.
          </DialogDescription>
          {researchJobId && (
            <div className="pt-1">
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Provenance: Researched (Job #{researchJobId})
              </Badge>
            </div>
          )}
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && insightBody.trim()) {
              storyMutation.mutate();
            }
          }}
          className="space-y-4 py-2 text-sm"
        >
          <div className="space-y-1.5">
            <Label htmlFor="story-title" className="text-xs font-semibold">
              Story Title
            </Label>
            <Input
              id="story-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Kubernetes Platform Teams Shift Focus to Developer Portals"
              className="text-sm"
              data-testid="input-story-title"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="story-body" className="text-xs font-semibold">
              Key Insight / Core Claim
            </Label>
            <Textarea
              id="story-body"
              value={insightBody}
              onChange={(e) => setInsightBody(e.target.value)}
              placeholder="Summarize the primary thesis, evidence, and why this matters to your audience..."
              className="min-h-[100px] text-sm resize-y"
              data-testid="textarea-story-body"
              required
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold">Angles &amp; Perspectives (Optional)</Label>
            <div className="flex gap-2">
              <Input
                value={newAngle}
                onChange={(e) => setNewAngle(e.target.value)}
                placeholder="e.g. SRE implications, Cost efficiency..."
                className="text-xs h-8"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAngle();
                  }
                }}
              />
              <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={addAngle}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add
              </Button>
            </div>
            {angles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {angles.map((ang, idx) => (
                  <Badge
                    key={idx}
                    variant="secondary"
                    className="text-xs cursor-pointer hover:bg-destructive/10 hover:text-destructive transition-colors"
                    onClick={() => removeAngle(idx)}
                    title="Click to remove"
                  >
                    {ang} &times;
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="pt-3 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={storyMutation.isPending || !title.trim() || !insightBody.trim()}
              data-testid="button-confirm-create-story"
              className="gap-1.5"
            >
              {storyMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Create Story
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
