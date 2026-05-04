import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CONTENT_PILLARS } from "@/lib/constants";
import { format } from "date-fns";
import { Loader2, ListChecks, Send, Clock, ShieldCheck } from "lucide-react";
import { SiX, SiThreads } from "react-icons/si";
import type { Post, Tweet } from "@shared/schema";
import { X_OFFICIAL_DOCS } from "@shared/xDeveloperRisk";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface PostWithTweets extends Post {
  tweets: Tweet[];
}

function PlatformBadge({ platform }: { platform: string | null }) {
  if (platform === "x")
    return (
      <Badge variant="secondary" className="text-[10px] gap-1">
        <SiX className="h-2.5 w-2.5" />
        X
      </Badge>
    );
  if (platform === "threads")
    return (
      <Badge variant="secondary" className="text-[10px] gap-1">
        <SiThreads className="h-2.5 w-2.5" />
        Threads
      </Badge>
    );
  return (
    <Badge variant="secondary" className="text-[10px] gap-1">
      <SiX className="h-2.5 w-2.5" />
      <SiThreads className="h-2.5 w-2.5" />
    </Badge>
  );
}

export default function QueuePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: queue = [], isLoading } = useQuery<PostWithTweets[]>({
    queryKey: ["/api/posts/queue/today"],
  });

  const publishMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/posts/${id}/publish`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Posted to X" });
      queryClient.invalidateQueries({ queryKey: ["/api/posts/queue/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
    },
    onError: (e: Error) => {
      toast({ title: "Publish failed", description: e.message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/posts/queue/today"] });
    },
  });

  const getPillarName = (pillarId: number | null) => {
    if (!pillarId) return null;
    return CONTENT_PILLARS.find((p) => p.id === pillarId)?.name ?? null;
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="p-4 border-b">
        <h1 className="text-lg font-semibold flex items-center gap-2" data-testid="text-queue-title">
          <ListChecks className="h-5 w-5" />
          Today&apos;s queue
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Research and drafts from anywhere → you mark <strong>ready</strong> or <strong>schedule</strong> → post to X when you approve.
        </p>
        <Alert className="mt-3 max-w-3xl" data-testid="alert-queue-x-compliance">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle className="text-sm">Publish on your terms</AlertTitle>
          <AlertDescription className="text-xs leading-relaxed">
            Your queue is the last step: only you (or your chosen schedule) sends to X — no auto-replies, DMs, likes, or
            posting straight from draft. That matches X&apos;s{" "}
            <a
              href={X_OFFICIAL_DOCS.developerGuidelines}
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium text-foreground"
            >
              developer guidelines
            </a>{" "}
            for user-initiated content. Internal checklist:{" "}
            <code className="rounded bg-muted px-1">docs/X_API_COMPLIANCE_AND_RISK.md</code>.
          </AlertDescription>
        </Alert>
      </div>

      <div className="p-4 space-y-4 max-w-3xl">
        {isLoading && (
          <>
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </>
        )}

        {!isLoading && queue.length === 0 && (
          <Card data-testid="card-queue-empty">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nothing in the queue. Mark drafts as <Badge variant="outline">ready</Badge> from Generate or Calendar, or schedule a post for today.
            </CardContent>
          </Card>
        )}

        {queue.map((post) => {
          const firstTweet = [...post.tweets].sort((a, b) => a.position - b.position)[0];
          const preview = firstTweet?.content?.slice(0, 220) || "(no text)";
          const pillar = getPillarName(post.pillarId);
          const canPublishX =
            post.targetPlatform !== "threads" &&
            (post.status === "ready" || post.status === "scheduled" || post.status === "failed");

          return (
            <Card key={post.id} data-testid={`card-queue-post-${post.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm font-medium leading-snug">
                    {preview}
                    {firstTweet && firstTweet.content.length > 220 ? "…" : ""}
                  </CardTitle>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge
                      variant={post.status === "ready" ? "default" : "secondary"}
                      data-testid={`badge-status-${post.id}`}
                    >
                      {post.status}
                    </Badge>
                    <PlatformBadge platform={post.targetPlatform} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  {pillar && <span>{pillar}</span>}
                  {post.scheduledAt && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(post.scheduledAt), "MMM d, h:mm a")}
                    </span>
                  )}
                  <span className="uppercase tracking-wide">{post.postType}</span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 pt-0">
                {post.errorMessage && (
                  <p className="text-xs text-destructive w-full" data-testid={`text-error-${post.id}`}>
                    {post.errorMessage}
                  </p>
                )}
                {canPublishX && (
                  <Button
                    size="sm"
                    disabled={publishMutation.isPending}
                    onClick={() => publishMutation.mutate(post.id)}
                    data-testid={`button-publish-x-${post.id}`}
                  >
                    {publishMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Post to X now
                  </Button>
                )}
                {post.targetPlatform === "threads" && (
                  <p className="text-xs text-muted-foreground">Threads publishing is not wired yet.</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
