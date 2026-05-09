import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MessageSquareText, Plus, Trash2, Copy, Sparkles, Star } from "lucide-react";
import type { CannedResponse } from "@shared/schema";

export default function CannedResponsesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [aiContext, setAiContext] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["/api/canned-responses"],
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/canned-responses", { title, content, category: "general" });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/canned-responses"] });
      setTitle("");
      setContent("");
      toast({ title: "Saved" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const aiMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/canned-responses/ai-suggest", { context: aiContext });
      return res.json() as Promise<{ suggestions?: { title: string; content: string }[] }>;
    },
    onSuccess: (data) => {
      const first = data.suggestions?.[0];
      if (first) {
        setTitle(first.title);
        setContent(first.content);
      }
      toast({ title: "Suggestions loaded — tweak and save" });
    },
    onError: (e: Error) => toast({ title: "AI failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/canned-responses/${id}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/canned-responses"] });
      toast({ title: "Deleted" });
    },
  });

  const favMut = useMutation({
    mutationFn: async (row: CannedResponse) => {
      const res = await apiRequest("PUT", `/api/canned-responses/${row.id}`, {
        title: row.title,
        content: row.content,
        category: row.category,
        isFavorite: !row.isFavorite,
      });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/canned-responses"] }),
  });

  return (
    <div className="flex flex-col h-full overflow-auto p-4 gap-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <MessageSquareText className="h-6 w-6 text-primary" />
        <h1 className="text-lg font-semibold" data-testid="text-canned-responses-title">
          Canned Responses
        </h1>
      </div>

      <Card className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">AI suggestions from context</p>
        <Textarea
          data-testid="input-ai-context"
          placeholder="Paste a DM, reply thread, or scenario…"
          value={aiContext}
          onChange={(e) => setAiContext(e.target.value)}
          rows={3}
        />
        <Button
          data-testid="button-ai-suggest"
          variant="secondary"
          disabled={aiMut.isPending || !aiContext.trim()}
          onClick={() => aiMut.mutate()}
        >
          {aiMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
          Suggest
        </Button>
      </Card>

      <Card className="p-4 space-y-3">
        <Button data-testid="button-new-response" variant="outline" size="sm" onClick={() => { setTitle(""); setContent(""); }}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          New
        </Button>
        <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea placeholder="Content" value={content} onChange={(e) => setContent(e.target.value)} rows={4} />
        <Button disabled={!title.trim() || !content.trim() || createMut.isPending} onClick={() => createMut.mutate()}>
          Save response
        </Button>
      </Card>

      {isLoading ? (
        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
      ) : (
        <div className="space-y-3">
          {(items as CannedResponse[]).map((row) => (
            <Card key={row.id} className="p-4 space-y-2" data-testid={`card-response-${row.id}`}>
              <div className="flex justify-between gap-2">
                <span className="font-medium text-sm">{row.title}</span>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid={`button-favorite-${row.id}`}
                    onClick={() => favMut.mutate(row)}
                  >
                    <Star className={`h-4 w-4 ${row.isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid={`button-copy-${row.id}`}
                    onClick={() => void navigator.clipboard.writeText(row.content).then(() => toast({ title: "Copied" }))}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid={`button-delete-${row.id}`}
                    onClick={() => deleteMut.mutate(row.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{row.content}</p>
              <p className="text-[10px] text-muted-foreground">Used {row.usageCount ?? 0}x</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
