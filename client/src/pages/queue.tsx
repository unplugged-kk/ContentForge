import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CONTENT_PILLARS } from "@/lib/constants";
import { format } from "date-fns";
import {
  Loader2, ListChecks, Send, Clock, ShieldCheck, Pencil, CheckCircle,
  ChevronDown, ChevronUp, Save, X as XIcon, Calendar,
} from "lucide-react";
import { SiX, SiThreads } from "react-icons/si";
import type { Post, Tweet } from "@shared/schema";
import { X_OFFICIAL_DOCS } from "@shared/xDeveloperRisk";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface PostWithTweets extends Post {
  tweets: Tweet[];
}

function PlatformBadge({ platform }: { platform: string | null }) {
  if (platform === "x")
    return <Badge variant="secondary" className="text-[10px] gap-1"><SiX className="h-2.5 w-2.5" />X</Badge>;
  if (platform === "threads")
    return <Badge variant="secondary" className="text-[10px] gap-1"><SiThreads className="h-2.5 w-2.5" />Threads</Badge>;
  return <Badge variant="secondary" className="text-[10px] gap-1"><SiX className="h-2.5 w-2.5" /><SiThreads className="h-2.5 w-2.5" /></Badge>;
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "ready") return "default";
  if (status === "failed") return "destructive";
  if (status === "draft") return "secondary";
  return "outline";
}

export default function QueuePage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  // Per-post loading state
  const [publishingIds, setPublishingIds] = useState<Set<number>>(new Set());
  const [markingReadyIds, setMarkingReadyIds] = useState<Set<number>>(new Set());

  // Inline editing
  const [editingPostId, setEditingPostId] = useState<number | null>(null);
  const [editTweets, setEditTweets] = useState<{ id: number; content: string; position: number }[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const { data: queue = [], isLoading } = useQuery<PostWithTweets[]>({
    queryKey: ["/api/posts/queue/today"],
  });

  const getPillarName = (pillarId: number | null) =>
    CONTENT_PILLARS.find((p) => p.id === pillarId)?.name ?? null;

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function startEdit(post: PostWithTweets) {
    const sorted = [...post.tweets].sort((a, b) => a.position - b.position);
    setEditTweets(sorted.map((t) => ({ id: t.id, content: t.content, position: t.position })));
    setEditingPostId(post.id);
    setExpandedIds((prev) => new Set(prev).add(post.id));
  }

  async function saveEdit(postId: number) {
    try {
      await apiRequest("PUT", `/api/posts/${postId}`, { tweets: editTweets } as any);
      queryClient.invalidateQueries({ queryKey: ["/api/posts/queue/today"] });
      toast({ title: "Saved" });
      setEditingPostId(null);
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    }
  }

  async function markReady(postId: number) {
    setMarkingReadyIds((prev) => new Set(prev).add(postId));
    try {
      await apiRequest("PATCH", `/api/posts/${postId}/status`, { status: "ready" });
      queryClient.invalidateQueries({ queryKey: ["/api/posts/queue/today"] });
      toast({ title: "Marked ready" });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setMarkingReadyIds((prev) => { const n = new Set(prev); n.delete(postId); return n; });
    }
  }

  async function publishNow(postId: number) {
    setPublishingIds((prev) => new Set(prev).add(postId));
    try {
      const res = await apiRequest("POST", `/api/posts/${postId}/publish`, {});
      const data = await res.json();
      if (data.tweetUrl) {
        toast({ title: "Posted to X!", description: `Live: ${data.tweetUrl}` });
      } else {
        toast({ title: "Posted" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/posts/queue/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
    } catch (err: any) {
      toast({ title: "Publish failed", description: err.message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/posts/queue/today"] });
    } finally {
      setPublishingIds((prev) => { const n = new Set(prev); n.delete(postId); return n; });
    }
  }

  const drafts = queue.filter((p) => p.status === "draft");
  const ready = queue.filter((p) => p.status === "ready");
  const scheduled = queue.filter((p) => p.status === "scheduled");
  const failed = queue.filter((p) => p.status === "failed");

  function renderPost(post: PostWithTweets) {
    const sorted = [...post.tweets].sort((a, b) => a.position - b.position);
    const firstTweet = sorted[0];
    const preview = firstTweet?.content?.slice(0, 200) || "(no text)";
    const pillar = getPillarName(post.pillarId);
    const isExpanded = expandedIds.has(post.id);
    const isEditing = editingPostId === post.id;
    const isPublishing = publishingIds.has(post.id);
    const isMarkingReady = markingReadyIds.has(post.id);

    return (
      <Card key={post.id} data-testid={`card-queue-post-${post.id}`}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-snug line-clamp-2">
                {preview}{firstTweet && firstTweet.content.length > 200 ? "…" : ""}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Badge variant={statusBadgeVariant(post.status ?? "draft")} data-testid={`badge-status-${post.id}`}>
                {post.status}
              </Badge>
              <PlatformBadge platform={post.targetPlatform} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground mt-1">
            {pillar && <span>{pillar}</span>}
            {post.scheduledAt && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {format(new Date(post.scheduledAt), "MMM d, h:mm a")}
              </span>
            )}
            <span className="uppercase tracking-wide">{post.postType?.replace(/_/g, " ")}</span>
            {sorted.length > 1 && <span>{sorted.length} tweets</span>}
          </div>
        </CardHeader>

        <CardContent className="space-y-3 pt-0">
          {post.errorMessage && (
            <p className="text-xs text-destructive">{post.errorMessage}</p>
          )}

          {/* Expanded tweet view / inline editor */}
          {isExpanded && (
            <div className="space-y-2 border rounded-md p-3 bg-muted/30">
              {isEditing ? (
                <>
                  {editTweets.map((t, i) => (
                    <div key={t.id} className="space-y-1">
                      <p className="text-[10px] text-muted-foreground">Tweet {i + 1} / {editTweets.length}</p>
                      <Textarea
                        value={t.content}
                        onChange={(e) => {
                          const v = e.target.value.slice(0, 280);
                          setEditTweets((prev) => prev.map((tw) => tw.id === t.id ? { ...tw, content: v } : tw));
                        }}
                        className="text-xs min-h-[60px]"
                      />
                      <p className="text-[10px] text-right text-muted-foreground">{t.content.length}/280</p>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveEdit(post.id)}>
                      <Save className="h-3 w-3 mr-1" />Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingPostId(null)}>
                      <XIcon className="h-3 w-3 mr-1" />Cancel
                    </Button>
                  </div>
                </>
              ) : (
                sorted.map((t, i) => (
                  <div key={t.id} className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground">Tweet {i + 1}</p>
                    <p className="text-xs">{t.content}</p>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {/* Expand / collapse */}
            <Button
              size="sm" variant="ghost"
              onClick={() => toggleExpand(post.id)}
            >
              {isExpanded
                ? <><ChevronUp className="h-3 w-3 mr-1" />Hide</>
                : <><ChevronDown className="h-3 w-3 mr-1" />{sorted.length} tweet{sorted.length !== 1 ? "s" : ""}</>}
            </Button>

            {/* Edit */}
            {!isEditing && (
              <Button size="sm" variant="outline" onClick={() => startEdit(post)}>
                <Pencil className="h-3 w-3 mr-1" />Edit
              </Button>
            )}

            {/* Mark Ready (for drafts) */}
            {post.status === "draft" && (
              <Button
                size="sm" variant="outline"
                disabled={isMarkingReady}
                onClick={() => markReady(post.id)}
              >
                {isMarkingReady
                  ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  : <CheckCircle className="h-3 w-3 mr-1" />}
                Mark Ready
              </Button>
            )}

            {/* Schedule */}
            {(post.status === "draft" || post.status === "ready") && (
              <Button
                size="sm" variant="outline"
                onClick={() => navigate("/calendar")}
              >
                <Calendar className="h-3 w-3 mr-1" />Schedule
              </Button>
            )}

            {/* Publish Now */}
            {post.targetPlatform !== "threads" && post.status !== "posted" && (
              <Button
                size="sm"
                disabled={isPublishing}
                onClick={() => publishNow(post.id)}
                data-testid={`button-publish-x-${post.id}`}
              >
                {isPublishing
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Send className="h-4 w-4" />}
                Post to X
              </Button>
            )}

            {post.targetPlatform === "threads" && (
              <p className="text-xs text-muted-foreground self-center">Threads publishing coming soon</p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="p-4 border-b">
        <h1 className="text-lg font-semibold flex items-center gap-2" data-testid="text-queue-title">
          <ListChecks className="h-5 w-5" />
          Today's Queue
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Drafts from Discover → edit → mark ready → post to X when you approve.
        </p>
        <Alert className="mt-3 max-w-3xl" data-testid="alert-queue-x-compliance">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle className="text-sm">Publish on your terms</AlertTitle>
          <AlertDescription className="text-xs leading-relaxed">
            Only you (or your schedule) sends to X — no auto-replies, DMs, or auto-posting from draft.
            Uses the{" "}
            <a href={X_OFFICIAL_DOCS.developerGuidelines} target="_blank" rel="noopener noreferrer"
              className="underline font-medium text-foreground">
              official X API
            </a>.
          </AlertDescription>
        </Alert>
      </div>

      <div className="p-4 space-y-6 max-w-3xl">
        {isLoading && <><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></>}

        {!isLoading && queue.length === 0 && (
          <Card data-testid="card-queue-empty">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nothing here yet. Go to <strong>Discover</strong> and click{" "}
              <Badge variant="outline">Create Draft</Badge> on any idea.
            </CardContent>
          </Card>
        )}

        {drafts.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Drafts ({drafts.length})
            </h2>
            <div className="space-y-3">{drafts.map(renderPost)}</div>
          </section>
        )}

        {ready.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Ready to Post ({ready.length})
            </h2>
            <div className="space-y-3">{ready.map(renderPost)}</div>
          </section>
        )}

        {scheduled.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Scheduled Today ({scheduled.length})
            </h2>
            <div className="space-y-3">{scheduled.map(renderPost)}</div>
          </section>
        )}

        {failed.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-destructive mb-2">
              Failed — needs retry ({failed.length})
            </h2>
            <div className="space-y-3">{failed.map(renderPost)}</div>
          </section>
        )}
      </div>
    </div>
  );
}
