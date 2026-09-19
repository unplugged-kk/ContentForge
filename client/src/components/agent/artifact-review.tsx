import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { SchedulePicker } from "@/components/ui-shared/schedule-picker";
import { PublishPreview } from "@/components/ui-shared/publish-preview";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { classifyAgentError } from "@shared/agent-ui";
import { PublicationCard, VisualAssetCard } from "./workspace-cards";

type Artifact = {
  id: number;
  format: string;
  channel: string;
  payload: Record<string, unknown> | null;
  readiness: string;
  approvedAt: string | null;
  supersedesId: number | null;
  provenance: string | null;
  opportunityId: number | null;
  generationJobId: number | null;
};

function payloadText(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  if (typeof payload.text === "string") return payload.text;
  if (Array.isArray(payload.units)) {
    return payload.units
      .map((unit) => (typeof unit === "string" ? unit : typeof (unit as { text?: string }).text === "string" ? (unit as { text: string }).text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function ArtifactReviewCard({ artifactId }: { artifactId: number }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleIso, setScheduleIso] = useState<string | null>(null);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);

  const accountsQuery = useQuery<Array<{ platform: string; username: string | null }>>({
    queryKey: ["/api/accounts"],
  });

  const artifactQuery = useQuery<Artifact>({
    queryKey: ["/api/artifacts", artifactId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/artifacts/${artifactId}`);
      return res.json();
    },
  });
  const historyQuery = useQuery<Artifact[]>({
    queryKey: ["/api/artifacts", artifactId, "history"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/artifacts/${artifactId}/history`);
      return res.json();
    },
  });
  const pubsQuery = useQuery<{ id: number; state: string; channel: string; artifactId: number }[]>({
    queryKey: ["/api/artifacts", artifactId, "publications"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/artifacts/${artifactId}/publications`);
      return res.json();
    },
  });
  const visualsQuery = useQuery<Array<{ visualAssetId?: number; id?: number }>>({
    queryKey: ["/api/artifacts", artifactId, "visuals"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/artifacts/${artifactId}/visuals`);
      return res.json();
    },
  });

  const artifact = artifactQuery.data;
  const text = payloadText(artifact?.payload ?? null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/artifacts", artifactId] });
    void queryClient.invalidateQueries({ queryKey: ["/api/artifacts", artifactId, "history"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/artifacts", artifactId, "publications"] });
  };

  const onError = (err: unknown) => {
    const classified = classifyAgentError({
      message: err instanceof Error ? err.message : String(err),
    });
    toast({ title: classified.class, description: classified.message, variant: "destructive" });
  };

  const revise = useMutation({
    mutationFn: async () => {
      if (!artifact) throw new Error("missing artifact");
      const res = await apiRequest("POST", `/api/artifacts/${artifact.id}/revise`, {
        baseArtifactId: artifact.id,
        payload: { ...(artifact.payload ?? {}), text: draft },
        attributionReason: "human workspace edit",
      });
      return res.json();
    },
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
    onError,
  });

  const submitReview = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/artifacts/${artifactId}/submit-review`, {});
      return res.json();
    },
    onSuccess: invalidate,
    onError,
  });

  const approve = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/artifacts/${artifactId}/approve`, {});
      return res.json();
    },
    onSuccess: invalidate,
    onError,
  });

  const regenerate = useMutation({
    mutationFn: async () => {
      if (!artifact?.opportunityId) throw new Error("missing opportunity");
      const res = await apiRequest("POST", "/api/generation-jobs", {
        opportunityId: artifact.opportunityId,
        regenerate: true,
      });
      return res.json();
    },
    onSuccess: invalidate,
    onError,
  });

  const schedule = useMutation({
    mutationFn: async (startAt: string) => {
      const res = await apiRequest("POST", "/api/schedules", {
        artifactId,
        startAt,
      });
      return res.json();
    },
    onSuccess: () => {
      setScheduleOpen(false);
      setScheduleIso(null);
      invalidate();
    },
    onError,
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (!artifact) throw new Error("missing artifact");
      const res = await apiRequest("POST", `/api/artifacts/${artifactId}/publications`, {
        targets: [{ channel: artifact.channel, startAt: new Date().toISOString() }],
      });
      return res.json();
    },
    onSuccess: () => {
      setPublishConfirmOpen(false);
      toast({ title: "Published", description: `Sent to ${artifact?.channel ?? "the target channel"}.` });
      invalidate();
    },
    onError,
  });

  const accountLabel = (() => {
    const match = accountsQuery.data?.find((a) => a.platform === artifact?.channel);
    if (match) return match.username ? `@${match.username}` : match.platform;
    return artifact?.channel ?? "";
  })();

  if (artifactQuery.isLoading) {
    return <p className="text-sm text-muted-foreground" data-testid="text-artifact-loading">Loading artifact…</p>;
  }
  if (!artifact) {
    return <p className="text-sm text-destructive" data-testid="text-artifact-missing">Artifact not found</p>;
  }

  const approved = artifact.readiness === "approved";
  const suggestion = !approved;

  return (
    <Card data-testid={`card-artifact-${artifact.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">Artifact {artifact.id}</CardTitle>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={approved ? "default" : "secondary"} data-testid="badge-artifact-readiness">
              {artifact.readiness}
            </Badge>
            <Badge variant="outline" data-testid="badge-approval-source">
              {suggestion ? "Agent suggestion" : "User approval"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          {artifact.format} · {artifact.channel} · {artifact.provenance ?? "generated"}
          {artifact.supersedesId ? ` · supersedes ${artifact.supersedesId}` : ""}
        </p>
        {historyQuery.data && historyQuery.data.length > 0 && (
          <div className="flex flex-wrap gap-1" data-testid="list-artifact-revisions">
            {historyQuery.data.map((rev, index) => (
              <Badge key={rev.id} variant={rev.id === artifact.id ? "default" : "outline"}>
                Revision {index + 1} #{rev.id}
              </Badge>
            ))}
          </div>
        )}
        {editing ? (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            data-testid="textarea-artifact-edit"
          />
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm" data-testid="text-artifact-content">{text || "(empty)"}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button size="sm" onClick={() => revise.mutate()} disabled={revise.isPending} data-testid="button-artifact-save-edit">
                Save new revision
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
              data-testid="button-artifact-edit"
            >
              Edit
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => regenerate.mutate()} disabled={regenerate.isPending} data-testid="button-artifact-regenerate">
            Regenerate
          </Button>
          {artifact.readiness === "draft" && (
            <Button size="sm" variant="outline" onClick={() => submitReview.mutate()} disabled={submitReview.isPending} data-testid="button-artifact-submit-review">
              Submit for review
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => approve.mutate()}
            disabled={approve.isPending || approved}
            data-testid="button-artifact-approve"
          >
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => setScheduleOpen(true)} disabled={!approved} data-testid="button-artifact-schedule">
            Schedule
          </Button>
          <Button size="sm" onClick={() => setPublishConfirmOpen(true)} disabled={!approved} data-testid="button-artifact-publish">
            Publish Now
          </Button>
        </div>
        {visualsQuery.data?.map((ref) => (
          <VisualAssetCard key={String(ref.visualAssetId ?? ref.id)} asset={{ id: ref.visualAssetId ?? ref.id }} />
        ))}
        {pubsQuery.data?.map((pub) => (
          <PublicationCard key={pub.id} publication={pub} />
        ))}
      </CardContent>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent data-testid="dialog-artifact-schedule">
          <DialogHeader>
            <DialogTitle>Schedule this artifact</DialogTitle>
          </DialogHeader>
          <SchedulePicker onChange={setScheduleIso} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button
              disabled={!scheduleIso || schedule.isPending}
              onClick={() => scheduleIso && schedule.mutate(scheduleIso)}
              data-testid="button-confirm-schedule"
            >
              Confirm schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={publishConfirmOpen} onOpenChange={setPublishConfirmOpen}>
        <DialogContent data-testid="dialog-artifact-publish">
          <DialogHeader>
            <DialogTitle>Publish now?</DialogTitle>
          </DialogHeader>
          <PublishPreview channel={artifact.channel} accountLabel={accountLabel} text={text} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishConfirmOpen(false)} data-testid="button-publish-cancel">Cancel</Button>
            <Button disabled={publish.isPending} onClick={() => publish.mutate()} data-testid="button-publish-confirm">
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
