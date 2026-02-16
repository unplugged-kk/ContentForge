import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CONTENT_PILLARS } from "@/lib/constants";
import { Plus, Sparkles, Trash2, Lightbulb, ArrowRight } from "lucide-react";
import type { Idea } from "@shared/schema";

export default function IdeasPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newPillar, setNewPillar] = useState("");

  const { data: ideas = [], isLoading } = useQuery<Idea[]>({
    queryKey: ["/api/ideas"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ideas", {
        title: newTitle,
        notes: newNotes || null,
        pillarId: newPillar ? parseInt(newPillar) : null,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Idea saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/ideas"] });
      setNewTitle("");
      setNewNotes("");
      setNewPillar("");
      setShowNew(false);
    },
    onError: (err) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ideas/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Idea deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/ideas"] });
    },
  });

  const expandMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/ideas/${id}/expand`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Idea expanded into a draft" });
      queryClient.invalidateQueries({ queryKey: ["/api/ideas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
    },
    onError: (err) => {
      toast({ title: "Expand failed", description: err.message, variant: "destructive" });
    },
  });

  const getPillarInfo = (id: number | null) =>
    id ? CONTENT_PILLARS.find((p) => p.id === id) : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h1 className="text-lg font-semibold" data-testid="text-ideas-title">Ideas Bank</h1>
          <p className="text-xs text-muted-foreground">Capture and develop content ideas</p>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)} data-testid="button-new-idea">
          <Plus className="h-4 w-4 mr-1" />
          New Idea
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-3 w-full mb-1" />
                <Skeleton className="h-3 w-1/2" />
              </Card>
            ))}
          </div>
        ) : ideas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center mb-3">
              <Lightbulb className="h-6 w-6 text-amber-500" />
            </div>
            <p className="text-sm font-medium">No ideas yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Capture your content ideas and let AI expand them into full drafts
            </p>
            <Button size="sm" className="mt-3" onClick={() => setShowNew(true)} data-testid="button-first-idea">
              <Plus className="h-4 w-4 mr-1" />
              Add your first idea
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {ideas.map((idea) => {
              const pillar = getPillarInfo(idea.pillarId);
              return (
                <Card key={idea.id} className="p-4 space-y-3 hover-elevate" data-testid={`card-idea-${idea.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-medium leading-tight flex-1">{idea.title}</h3>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={() => deleteMutation.mutate(idea.id)}
                      data-testid={`button-delete-idea-${idea.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  {idea.notes && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{idea.notes}</p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {pillar && (
                        <Badge variant="outline" className="text-[10px]">
                          <span className="h-1.5 w-1.5 rounded-full mr-1" style={{ backgroundColor: pillar.color }} />
                          {pillar.name.split(" ")[0]}
                        </Badge>
                      )}
                      {idea.isExpanded && (
                        <Badge variant="secondary" className="text-[10px]">Expanded</Badge>
                      )}
                    </div>
                    {!idea.isExpanded && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => expandMutation.mutate(idea.id)}
                        disabled={expandMutation.isPending}
                        data-testid={`button-expand-idea-${idea.id}`}
                      >
                        <Sparkles className="h-3 w-3 mr-1" />
                        Expand
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-sm">New Content Idea</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="What's the idea?"
              data-testid="input-idea-title"
            />
            <Textarea
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Any notes or context..."
              className="resize-none text-sm"
              rows={3}
              data-testid="input-idea-notes"
            />
            <Select value={newPillar} onValueChange={setNewPillar}>
              <SelectTrigger data-testid="select-idea-pillar">
                <SelectValue placeholder="Content pillar (optional)" />
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
          <DialogFooter>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newTitle.trim() || createMutation.isPending}
              data-testid="button-save-idea"
            >
              Save Idea
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
