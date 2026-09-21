import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Bookmark,
  ExternalLink,
  Trash2,
  FileText,
  Sparkles,
  Lightbulb,
  Database,
  Search,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui-shared/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  formatRelativeTime,
  getCreateFromIdeaUrl,
  getCreateFromSourceUrl,
  sanitizeUntrustedText,
} from "@/lib/sources-research-state";
import { CreateStoryDialog } from "./create-story-dialog";

export type SavedItemFilter = "all" | "references" | "ideas" | "vault";

export interface SavedTabProps {
  initialFilter?: SavedItemFilter;
}

interface UnifiedSavedItem {
  id: string; // e.g. "vault-1", "idea-2", "ref-3"
  rawId: number;
  entityType: "reference" | "idea" | "vault";
  title: string;
  content: string;
  sourceUrl?: string | null;
  createdAt: string | Date;
  metadata?: Record<string, unknown>;
}

export function SavedTab({ initialFilter = "all" }: SavedTabProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<SavedItemFilter>(initialFilter);
  const [pendingDelete, setPendingDelete] = useState<UnifiedSavedItem | null>(null);
  const [storyDialogOpen, setStoryDialogOpen] = useState(false);
  const [storyData, setStoryData] = useState<{ title: string; body: string }>({ title: "", body: "" });

  // 1. Vault Items
  const vaultQuery = useQuery({
    queryKey: ["/api/vault"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/vault");
      return res.json() as Promise<any[]>;
    },
  });

  // 2. Ideas
  const ideasQuery = useQuery({
    queryKey: ["/api/ideas"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/ideas");
      return res.json() as Promise<any[]>;
    },
  });

  // 3. References
  const referencesQuery = useQuery({
    queryKey: ["/api/references"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/references");
      return res.json() as Promise<any[]>;
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (item: UnifiedSavedItem) => {
      if (item.entityType === "vault") {
        await apiRequest("DELETE", `/api/vault/${item.rawId}`);
      } else if (item.entityType === "idea") {
        await apiRequest("DELETE", `/api/ideas/${item.rawId}`);
      } else if (item.entityType === "reference") {
        await apiRequest("DELETE", `/api/references/${item.rawId}`);
      }
    },
    onSuccess: (_, item) => {
      if (item.entityType === "vault") void queryClient.invalidateQueries({ queryKey: ["/api/vault"] });
      if (item.entityType === "idea") void queryClient.invalidateQueries({ queryKey: ["/api/ideas"] });
      if (item.entityType === "reference") void queryClient.invalidateQueries({ queryKey: ["/api/references"] });
      setPendingDelete(null);
      toast({ title: "Item removed from Saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove", description: err.message, variant: "destructive" });
    },
  });

  // Consolidate into unified collection
  const unifiedItems: UnifiedSavedItem[] = [];

  for (const v of vaultQuery.data ?? []) {
    unifiedItems.push({
      id: `vault-${v.id}`,
      rawId: v.id,
      entityType: "vault",
      title: v.title || "Untitled Vault Note",
      content: v.content || "",
      sourceUrl: v.sourceUrl,
      createdAt: v.createdAt || new Date(),
      metadata: { category: v.category, tags: v.tags },
    });
  }

  for (const idea of ideasQuery.data ?? []) {
    unifiedItems.push({
      id: `idea-${idea.id}`,
      rawId: idea.id,
      entityType: "idea",
      title: idea.title || "Untitled Idea",
      content: idea.notes || "",
      sourceUrl: null,
      createdAt: idea.createdAt || new Date(),
    });
  }

  for (const ref of referencesQuery.data ?? []) {
    unifiedItems.push({
      id: `ref-${ref.id}`,
      rawId: ref.id,
      entityType: "reference",
      title: ref.title || "Saved Reference",
      content: ref.rawContent || "",
      sourceUrl: ref.sourceUrl,
      createdAt: ref.createdAt || new Date(),
      metadata: { sourceType: ref.sourceType },
    });
  }

  // Sort by date descending
  unifiedItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Filter items
  const filteredItems = unifiedItems.filter((item) => {
    if (filter === "all") return true;
    if (filter === "vault") return item.entityType === "vault";
    if (filter === "ideas") return item.entityType === "idea";
    if (filter === "references") return item.entityType === "reference";
    return true;
  });

  const isLoading = vaultQuery.isLoading || ideasQuery.isLoading || referencesQuery.isLoading;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6" data-testid="container-saved-tab">
      {/* Title & Filter bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold tracking-tight">Saved Knowledge Base</h2>
          <p className="text-xs text-muted-foreground">
            Consolidated repository of captured sources, notes, and content ideas.
          </p>
          {/* Test ID titles for backward compatibility with canonical-ia */}
          {filter === "ideas" && (
            <h3 className="text-sm font-semibold text-primary mt-1" data-testid="text-ideas-title">
              Ideas Bank
            </h3>
          )}
          {filter === "vault" && (
            <h3 className="text-sm font-semibold text-primary mt-1" data-testid="text-vault-title">
              Context Vault
            </h3>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0" data-testid="nav-saved-filters">
          <Button
            size="sm"
            variant={filter === "all" ? "default" : "outline"}
            className="h-8 text-xs px-3"
            onClick={() => setFilter("all")}
            data-testid="filter-saved-all"
          >
            All ({unifiedItems.length})
          </Button>
          <Button
            size="sm"
            variant={filter === "references" ? "default" : "outline"}
            className="h-8 text-xs px-3"
            onClick={() => setFilter("references")}
            data-testid="filter-saved-references"
          >
            References ({referencesQuery.data?.length ?? 0})
          </Button>
          <Button
            size="sm"
            variant={filter === "ideas" ? "default" : "outline"}
            className="h-8 text-xs px-3"
            onClick={() => setFilter("ideas")}
            data-testid="filter-saved-ideas"
          >
            Ideas ({ideasQuery.data?.length ?? 0})
          </Button>
          <Button
            size="sm"
            variant={filter === "vault" ? "default" : "outline"}
            className="h-8 text-xs px-3"
            onClick={() => setFilter("vault")}
            data-testid="filter-saved-vault"
          >
            Vault ({vaultQuery.data?.length ?? 0})
          </Button>
        </div>
      </div>

      {/* Item List */}
      {filteredItems.length > 0 ? (
        <div className="space-y-3" data-testid="list-saved-items">
          {filteredItems.map((item) => {
            const cleanContent = sanitizeUntrustedText(item.content);

            return (
              <Card key={item.id} className="border-border shadow-xs" data-testid={`card-saved-item-${item.rawId}`}>
                <CardHeader className="pb-2 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Badge variant={item.entityType === "idea" ? "secondary" : "outline"} className="text-[11px] capitalize">
                        {item.entityType === "vault" ? "Vault Note" : item.entityType}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Captured {formatRelativeTime(item.createdAt)}
                      </span>
                    </div>

                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setPendingDelete(item)}
                      title="Remove from Saved"
                      data-testid={`button-delete-saved-${item.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <CardTitle className="text-sm sm:text-base font-semibold">
                    {item.title}
                  </CardTitle>
                </CardHeader>

                <CardContent className="space-y-3 text-sm">
                  {cleanContent && (
                    <p className="text-xs sm:text-sm text-muted-foreground line-clamp-3 leading-relaxed">
                      {cleanContent}
                    </p>
                  )}

                  {item.sourceUrl && (
                    <div className="text-xs text-muted-foreground">
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline truncate max-w-[320px]"
                      >
                        <span className="truncate">{item.sourceUrl}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1.5"
                      onClick={() => {
                        setStoryData({ title: item.title, body: cleanContent });
                        setStoryDialogOpen(true);
                      }}
                      data-testid={`button-saved-create-story-${item.rawId}`}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Create Story
                    </Button>

                    <Button
                      size="sm"
                      variant="default"
                      className="h-8 text-xs gap-1.5 ml-auto"
                      onClick={() => {
                        if (item.entityType === "idea") {
                          navigate(getCreateFromIdeaUrl(item.rawId));
                        } else {
                          navigate(getCreateFromSourceUrl({ title: item.title, url: item.sourceUrl ?? undefined }));
                        }
                      }}
                      data-testid={`button-saved-create-content-${item.rawId}`}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Create Content
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center space-y-2 text-muted-foreground" data-testid="state-saved-empty">
          <Bookmark className="h-8 w-8 mx-auto opacity-40 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Nothing Saved Yet</h3>
          <p className="text-xs max-w-sm mx-auto">
            Save a useful source, research finding, or content idea to build your reusable knowledge base.
          </p>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Remove from Saved?"
        description={`Are you sure you want to remove "${pendingDelete?.title}" from your knowledge base?`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete);
        }}
      />

      {/* Create Story Dialog */}
      <CreateStoryDialog
        open={storyDialogOpen}
        onOpenChange={setStoryDialogOpen}
        initialTitle={storyData.title}
        initialBody={storyData.body}
        provenance="human"
      />
    </div>
  );
}
