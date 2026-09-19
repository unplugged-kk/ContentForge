import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui-shared/status-badge";
import { SchedulePicker } from "@/components/ui-shared/schedule-picker";
import { PublishPreview } from "@/components/ui-shared/publish-preview";
import { ErrorState } from "@/components/ui-shared/error-state";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  deriveVersionNumber,
  extractArtifactPreviewText,
  checkPublishCompatibility,
  formatProvenanceLabel,
  type CapabilityFormat,
} from "@/lib/create-workflow";
import {
  Sparkles,
  Edit3,
  RefreshCw,
  CheckCircle2,
  Calendar,
  Send,
  ArrowLeft,
  AlertTriangle,
  History,
  Layers,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
} from "lucide-react";
import { SiX, SiLinkedin, SiInstagram, SiYoutube, SiThreads } from "react-icons/si";

export interface ArtifactReviewViewProps {
  artifactId: number;
  onBackToCreate?: () => void;
  onSelectArtifact?: (id: number) => void;
}

interface ArtifactRecord {
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
  createdAt: string;
}

interface OpportunityRecord {
  id: number;
  storyId: number;
  concept: string;
  objective: string;
  audience: string | null;
  angle: string | null;
  format: string;
  channel: string;
  status: string;
}

interface StoryRecord {
  id: number;
  title: string;
  insightBody: string;
  provenance: string;
}

function ChannelIcon({ channel }: { channel: string }) {
  switch (channel.toLowerCase()) {
    case "x":
      return <SiX className="h-3.5 w-3.5" />;
    case "linkedin":
      return <SiLinkedin className="h-3.5 w-3.5 text-[#0A66C2]" />;
    case "instagram":
      return <SiInstagram className="h-3.5 w-3.5 text-[#E4405F]" />;
    case "youtube":
      return <SiYoutube className="h-3.5 w-3.5 text-[#FF0000]" />;
    case "threads":
      return <SiThreads className="h-3.5 w-3.5" />;
    default:
      return <Layers className="h-3.5 w-3.5" />;
  }
}

export function ArtifactReviewView({
  artifactId,
  onBackToCreate,
  onSelectArtifact,
}: ArtifactReviewViewProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleIso, setScheduleIso] = useState<string | null>(null);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);

  // Queries
  const artifactQuery = useQuery<ArtifactRecord>({
    queryKey: ["/api/artifacts", artifactId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/artifacts/${artifactId}`);
      return res.json();
    },
  });

  const historyQuery = useQuery<ArtifactRecord[]>({
    queryKey: ["/api/artifacts", artifactId, "history"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/artifacts/${artifactId}/history`);
      return res.json();
    },
  });

  const accountsQuery = useQuery<Array<{ platform: string; username: string | null }>>({
    queryKey: ["/api/accounts"],
  });

  const capabilitiesQuery = useQuery<{ formats: CapabilityFormat[] }>({
    queryKey: ["/api/repurposing/capabilities"],
  });

  const artifact = artifactQuery.data;

  // Opportunity & Story for truthful provenance
  const opportunityQuery = useQuery<OpportunityRecord>({
    queryKey: ["/api/opportunities", artifact?.opportunityId],
    queryFn: async () => {
      if (!artifact?.opportunityId) return null;
      const res = await apiRequest("GET", `/api/opportunities/${artifact.opportunityId}`);
      return res.json();
    },
    enabled: !!artifact?.opportunityId,
  });

  const storyQuery = useQuery<StoryRecord>({
    queryKey: ["/api/stories", opportunityQuery.data?.storyId],
    queryFn: async () => {
      if (!opportunityQuery.data?.storyId) return null;
      const res = await apiRequest("GET", `/api/stories/${opportunityQuery.data.storyId}`);
      return res.json();
    },
    enabled: !!opportunityQuery.data?.storyId,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/artifacts", artifactId] });
    void queryClient.invalidateQueries({ queryKey: ["/api/artifacts", artifactId, "history"] });
  };

  // Mutations
  const reviseMutation = useMutation({
    mutationFn: async () => {
      if (!artifact) throw new Error("Missing artifact");
      const res = await apiRequest("POST", `/api/artifacts/${artifact.id}/revise`, {
        baseArtifactId: artifact.id,
        payload: { ...(artifact.payload ?? {}), text: draftText },
        attributionReason: "Human review edit",
      });
      return res.json();
    },
    onSuccess: (newArtifact: ArtifactRecord) => {
      setEditing(false);
      toast({ title: "New revision saved", description: "Created a new version in draft." });
      invalidate();
      if (onSelectArtifact && newArtifact?.id) {
        onSelectArtifact(newArtifact.id);
      }
    },
    onError: (err: any) => {
      toast({ title: "Failed to save revision", description: err.message, variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (artifact?.readiness === "draft") {
        await apiRequest("POST", `/api/artifacts/${artifactId}/submit-review`, {});
      }
      const res = await apiRequest("POST", `/api/artifacts/${artifactId}/approve`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Artifact approved", description: "Ready to schedule or publish." });
      invalidate();
    },
    onError: (err: any) => {
      toast({ title: "Failed to approve", description: err.message, variant: "destructive" });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      if (!artifact?.opportunityId) throw new Error("Missing opportunity");
      const createRes = await apiRequest("POST", "/api/generation-jobs", {
        opportunityId: artifact.opportunityId,
        regenerate: true,
      });
      const job = await createRes.json();

      // Trigger immediate execution via run endpoint
      const runRes = await apiRequest("POST", `/api/generation-jobs/${job.id}/run`, {});
      return runRes.json();
    },
    onSuccess: (runResult: any) => {
      toast({ title: "Regenerated content", description: "New generation completed." });
      invalidate();
      if (onSelectArtifact && runResult?.artifactId) {
        onSelectArtifact(runResult.artifactId);
      }
    },
    onError: (err: any) => {
      toast({ title: "Regeneration failed", description: err.message, variant: "destructive" });
    },
  });

  const scheduleMutation = useMutation({
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
      toast({ title: "Scheduled", description: "Content scheduled for publication." });
      invalidate();
    },
    onError: (err: any) => {
      toast({ title: "Scheduling failed", description: err.message, variant: "destructive" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!artifact) throw new Error("Missing artifact");
      const res = await apiRequest("POST", `/api/artifacts/${artifactId}/publications`, {
        targets: [{ channel: artifact.channel, startAt: new Date().toISOString() }],
      });
      return res.json();
    },
    onSuccess: () => {
      setPublishConfirmOpen(false);
      toast({
        title: "Published successfully",
        description: `Delivered to ${artifact?.channel || "channel"}.`,
      });
      invalidate();
    },
    onError: (err: any) => {
      toast({ title: "Publishing failed", description: err.message, variant: "destructive" });
    },
  });

  if (artifactQuery.isLoading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[300px] text-muted-foreground gap-3">
        <Sparkles className="h-6 w-6 animate-pulse text-primary" />
        <p className="text-sm" data-testid="text-artifact-loading">Loading content review…</p>
      </div>
    );
  }

  if (artifactQuery.isError || !artifact) {
    return (
      <div className="p-6">
        <ErrorState
          title="Content Not Found"
          description="Could not load the requested artifact for review."
          onRetry={() => artifactQuery.refetch()}
        />
        <div className="mt-4 text-center">
          <Button variant="outline" size="sm" onClick={onBackToCreate}>
            Back to Create
          </Button>
        </div>
      </div>
    );
  }

  const text = extractArtifactPreviewText(artifact.payload);
  const isApproved = artifact.readiness === "approved";
  const history = historyQuery.data || [];
  const currentVersion = deriveVersionNumber(artifact.id, history);

  // Target Account resolution
  const matchedAccount = accountsQuery.data?.find((a) => a.platform === artifact.channel);
  const accountLabel = matchedAccount?.username
    ? `@${matchedAccount.username}`
    : matchedAccount?.platform || artifact.channel;

  // Compatibility validation
  const compatibility = checkPublishCompatibility(
    artifact.format,
    artifact.channel,
    capabilitiesQuery.data?.formats,
  );

  const provenanceText = formatProvenanceLabel({
    provenance: artifact.provenance,
    storyTitle: storyQuery.data?.title,
    ideaTitle: opportunityQuery.data?.concept,
  });

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 md:p-6 max-w-6xl mx-auto gap-6" data-testid="view-artifact-review">
      {/* Review Header Bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap pb-4 border-b">
        <div className="flex items-center gap-3">
          {onBackToCreate && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={onBackToCreate}
              data-testid="button-review-back"
              aria-label="Back to Create"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div>
            <h2 className="text-lg font-semibold tracking-tight" data-testid="text-review-title">
              Review Content
            </h2>
            <p className="text-xs text-muted-foreground">
              Verify rendered content, provenance, and target channel before approval.
            </p>
          </div>
        </div>

        {/* Version switcher & Status */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs font-mono" data-testid="badge-artifact-version">
            v{currentVersion}
          </Badge>
          <StatusBadge status={artifact.readiness} data-testid="badge-artifact-status" />
        </div>
      </div>

      {/* Main Review Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left / Center: Content Preview */}
        <div className="lg:col-span-8 space-y-4">
          <Card className="border shadow-xs" data-testid="card-review-preview">
            <CardHeader className="pb-3 border-b bg-muted/20 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium">
                <ChannelIcon channel={artifact.channel} />
                <span className="capitalize">{artifact.channel}</span>
                <span className="text-muted-foreground">·</span>
                <span className="capitalize">{artifact.format.replace(/_/g, " ")}</span>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {text.length} characters
              </span>
            </CardHeader>

            <CardContent className="p-4 md:p-6 space-y-4">
              {editing ? (
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Edit3 className="h-3.5 w-3.5" />
                    Editing will create Version {history.length + 1} in draft status.
                  </div>
                  <Textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    rows={8}
                    className="font-sans text-sm leading-relaxed"
                    data-testid="textarea-review-edit"
                  />
                  <div className="flex gap-2 justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(false)}
                      data-testid="button-review-cancel-edit"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => reviseMutation.mutate()}
                      disabled={reviseMutation.isPending || !draftText.trim()}
                      data-testid="button-review-save-edit"
                    >
                      Save Version {history.length + 1}
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className="whitespace-pre-wrap break-words text-sm leading-relaxed font-sans"
                  data-testid="text-review-rendered-content"
                >
                  {text || "(Empty content)"}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Compatibility Warning if unsupported */}
          {!compatibility.canPublish && (
            <div
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2"
              data-testid="banner-publish-incompatible"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Channel Compatibility Notice</p>
                <p className="mt-0.5">{compatibility.reason}</p>
              </div>
            </div>
          )}

          {/* Revision History browser pills */}
          {history.length > 1 && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                <History className="h-3.5 w-3.5" />
                <span>Version History:</span>
              </div>
              <div className="flex flex-wrap gap-1.5" data-testid="list-artifact-revisions">
                {history.map((rev, index) => {
                  const isCurrent = rev.id === artifact.id;
                  return (
                    <Button
                      key={rev.id}
                      size="sm"
                      variant={isCurrent ? "secondary" : "outline"}
                      className="h-7 text-xs px-2.5"
                      onClick={() => onSelectArtifact?.(rev.id)}
                      data-testid={`button-version-pill-${index + 1}`}
                    >
                      v{index + 1} {isCurrent && "(Current)"}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: Metadata & Workflow Actions */}
        <div className="lg:col-span-4 space-y-4">
          <Card className="border shadow-xs">
            <CardHeader className="pb-3 border-b bg-muted/20">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Content Metadata
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3 text-xs">
              <div>
                <span className="text-muted-foreground block mb-0.5">Target Channel</span>
                <div className="flex items-center gap-1.5 font-medium">
                  <ChannelIcon channel={artifact.channel} />
                  <span className="capitalize">{artifact.channel}</span>
                </div>
              </div>

              <div>
                <span className="text-muted-foreground block mb-0.5">Connected Account</span>
                <span className="font-medium" data-testid="text-review-target-account">
                  {accountLabel}
                </span>
              </div>

              <div>
                <span className="text-muted-foreground block mb-0.5">Version</span>
                <span className="font-medium" data-testid="text-review-version">
                  Version {currentVersion}
                </span>
              </div>

              <div>
                <span className="text-muted-foreground block mb-0.5">Created From</span>
                <span className="font-medium break-words" data-testid="text-review-provenance">
                  {provenanceText}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Actions Card */}
          <Card className="border shadow-xs" data-testid="card-review-actions">
            <CardHeader className="pb-3 border-b bg-muted/20">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Workflow Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-2.5">
              {!isApproved ? (
                <>
                  <Button
                    className="w-full justify-center gap-2"
                    onClick={() => approveMutation.mutate()}
                    disabled={approveMutation.isPending}
                    data-testid="button-review-approve"
                  >
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    Approve Content
                  </Button>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => {
                        setDraftText(text);
                        setEditing(true);
                      }}
                      data-testid="button-review-edit"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Edit
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => regenerateMutation.mutate()}
                      disabled={regenerateMutation.isPending}
                      data-testid="button-review-regenerate"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${regenerateMutation.isPending ? "animate-spin" : ""}`} />
                      Regenerate
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  {/* Approved State Actions */}
                  <div className="space-y-2">
                    <Button
                      className="w-full justify-center gap-2"
                      onClick={() => setPublishConfirmOpen(true)}
                      disabled={!compatibility.canPublish || publishMutation.isPending}
                      data-testid="button-review-publish"
                    >
                      <Send className="h-4 w-4" />
                      Publish Now
                    </Button>

                    <Button
                      variant="outline"
                      className="w-full justify-center gap-2"
                      onClick={() => setScheduleOpen(true)}
                      disabled={!compatibility.canPublish}
                      data-testid="button-review-schedule"
                    >
                      <Calendar className="h-4 w-4" />
                      Schedule
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs text-muted-foreground mt-2"
                      onClick={() => {
                        setDraftText(text);
                        setEditing(true);
                      }}
                      data-testid="button-review-new-version"
                    >
                      Create another version
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Schedule Dialog (using shared SchedulePicker) */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent data-testid="dialog-artifact-schedule">
          <DialogHeader>
            <DialogTitle>Schedule Publication</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <SchedulePicker onChange={setScheduleIso} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!scheduleIso || scheduleMutation.isPending}
              onClick={() => scheduleIso && scheduleMutation.mutate(scheduleIso)}
              data-testid="button-confirm-schedule"
            >
              Confirm Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish Dialog (using shared PublishPreview) */}
      <Dialog open={publishConfirmOpen} onOpenChange={setPublishConfirmOpen}>
        <DialogContent data-testid="dialog-artifact-publish">
          <DialogHeader>
            <DialogTitle>Publish Confirmation</DialogTitle>
          </DialogHeader>
          <PublishPreview channel={artifact.channel} accountLabel={accountLabel} text={text} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishConfirmOpen(false)} data-testid="button-publish-cancel">
              Cancel
            </Button>
            <Button
              disabled={publishMutation.isPending}
              onClick={() => publishMutation.mutate()}
              data-testid="button-confirm-publish"
            >
              Publish Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
