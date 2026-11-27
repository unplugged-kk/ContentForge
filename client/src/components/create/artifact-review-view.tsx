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
import { ConfirmDialog } from "@/components/ui-shared/confirm-dialog";
import { ChannelIcon } from "@/components/ui-shared/channel-icon";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getPublicationFeedback } from "@/lib/publication-feedback";
import { useToast } from "@/hooks/use-toast";
import {
  deriveVersionNumber,
  extractArtifactPreviewText,
  checkPublishCompatibility,
  formatProvenanceLabel,
  type CapabilityFormat,
} from "@/lib/create-workflow";
import {
  X_POST_CHAR_BUDGET,
  extractThreadUnits,
  buildEditedArtifactPayload,
  formatArtifactPlainText,
  formatArtifactNumberedThread,
  formatArtifactMarkdownExport,
  buildArtifactExportFilename,
  enrichEvidenceWithSources,
  type ArtifactExportEvidence,
  type ArtifactExportSource,
} from "@/lib/artifact-export";
import {
  Sparkles,
  Edit3,
  RefreshCw,
  CheckCircle2,
  Calendar,
  Send,
  ArrowLeft,
  AlertTriangle,
  XCircle,
  History,
  Copy,
  Download,
  ListOrdered,
  Plus,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  FileSearch,
} from "lucide-react";

export interface ArtifactReviewViewProps {
  artifactId: number;
  onBackToCreate?: () => void;
  onSelectArtifact?: (id: number) => void;
}

interface AuditedClaimRecord {
  unitIndex: number;
  claimText: string;
  evidenceIds: number[];
  status: "supported" | "unsupported" | "opinion";
  reason?: string;
}

interface ArtifactAttributionEntry {
  kind?: string;
  researchJobId?: number | null;
  evidenceIds?: number[];
  claims?: AuditedClaimRecord[];
  unsupportedCount?: number;
  paraphraseOverlap?: number;
  qualityFlags?: string[];
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
  attribution?: ArtifactAttributionEntry[];
  attributionReason?: string | null;
  createdAt: string;
}

const QUALITY_FLAG_LABELS: Record<string, string> = {
  boilerplate_heavy: "Boilerplate-heavy phrasing",
  paraphrase_heavy: "High source paraphrase overlap",
  ungrounded_first_person: "Ungrounded first-person claim",
  over_limit: "Exceeds channel length limit",
  no_hook: "Weak or missing opening hook",
  missing_cta: "Missing closing call-to-action",
  repetitive: "Repetitive phrasing",
  hedging_heavy: "Excessive hedging",
  no_specifics: "Low technical specificity",
  too_few_units: "Too few thread units",
  too_many_units: "Too many thread units",
};

function parseClaimAuditSummary(entries: ArtifactAttributionEntry[] | undefined) {
  const list = Array.isArray(entries) ? entries : [];
  const claimEntry = list.find((e) => e && e.kind === "claim_evidence_v1");
  const hasClaimAudit = Boolean(claimEntry);
  const evidenceIds = Array.from(
    new Set(
      list.flatMap((e) => (Array.isArray(e?.evidenceIds) ? e.evidenceIds : [])),
    ),
  );
  const claims = Array.isArray(claimEntry?.claims) ? claimEntry.claims : [];
  const qualityFlags = Array.isArray(claimEntry?.qualityFlags) ? claimEntry.qualityFlags : [];
  const paraphraseOverlap =
    typeof claimEntry?.paraphraseOverlap === "number" ? claimEntry.paraphraseOverlap : 0;
  const supportedCount = claims.filter((c) => c.status === "supported").length;
  const unsupportedCount =
    typeof claimEntry?.unsupportedCount === "number"
      ? claimEntry.unsupportedCount
      : claims.filter((c) => c.status === "unsupported").length;
  const opinionCount = claims.filter((c) => c.status === "opinion").length;
  const hasAuditData = hasClaimAudit || evidenceIds.length > 0;

  return {
    hasClaimAudit,
    hasAuditData,
    evidenceIds,
    claims,
    qualityFlags,
    paraphraseOverlap,
    supportedCount,
    unsupportedCount,
    opinionCount,
  };
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
  researchJobId?: number | null;
  evidenceRefs?: number[];
}

export function ArtifactReviewView({
  artifactId,
  onBackToCreate,
  onSelectArtifact,
}: ArtifactReviewViewProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draftUnits, setDraftUnits] = useState<string[]>([]);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleIso, setScheduleIso] = useState<string | null>(null);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);

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

  const storyEvidenceQuery = useQuery<ArtifactExportEvidence[]>({
    queryKey: ["/api/research/jobs", storyQuery.data?.researchJobId, "evidence"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/research/jobs/${storyQuery.data!.researchJobId}/evidence`);
      return res.json();
    },
    enabled: Boolean(storyQuery.data?.researchJobId),
  });

  const storySourcesQuery = useQuery<ArtifactExportSource[]>({
    queryKey: ["/api/research/jobs", storyQuery.data?.researchJobId, "sources"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/research/jobs/${storyQuery.data!.researchJobId}/sources`);
      return res.json();
    },
    enabled: Boolean(storyQuery.data?.researchJobId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/artifacts", artifactId] });
    void queryClient.invalidateQueries({ queryKey: ["/api/artifacts", artifactId, "history"] });
  };

  // Mutations
  const reviseMutation = useMutation({
    mutationFn: async () => {
      if (!artifact) throw new Error("Missing artifact");
      const nextPayload = buildEditedArtifactPayload(
        artifact.format,
        artifact.payload,
        draftText,
        artifact.format === "x_thread" ? draftUnits : undefined,
      );
      const res = await apiRequest("POST", `/api/artifacts/${artifact.id}/revise`, {
        baseArtifactId: artifact.id,
        payload: nextPayload,
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

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/artifacts/${artifactId}/reject`, {});
      return res.json();
    },
    onSuccess: () => {
      setRejectConfirmOpen(false);
      toast({
        title: "Artifact rejected",
        description: "This revision is permanently rejected. Create a new version to continue.",
      });
      invalidate();
    },
    onError: (err: any) => {
      toast({ title: "Failed to reject", description: err.message, variant: "destructive" });
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
    onSuccess: (response: { outcomes?: Array<{ status?: string | null; channel?: string | null; error?: string | null }> }) => {
      setPublishConfirmOpen(false);
      const feedback = getPublicationFeedback(response, artifact?.channel || "channel");
      toast(feedback);
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
  const isThread = artifact.format === "x_thread";
  const threadUnits = isThread ? extractThreadUnits(artifact.payload) : [];
  const isApproved = artifact.readiness === "approved";
  const isInReview = artifact.readiness === "in_review";
  const isRejected = artifact.readiness === "rejected";
  const history = historyQuery.data || [];
  const currentVersion = deriveVersionNumber(artifact.id, history);

  const rawEvidence = enrichEvidenceWithSources(
    storyEvidenceQuery.data ?? [],
    storySourcesQuery.data ?? [],
  );
  const storyEvidenceRefSet = new Set(storyQuery.data?.evidenceRefs ?? []);
  const exportEvidence =
    storyEvidenceRefSet.size > 0
      ? rawEvidence.filter((item) => typeof item.id === "number" && storyEvidenceRefSet.has(item.id))
      : rawEvidence;

  const openEditor = () => {
    if (isThread) {
      setDraftUnits(threadUnits.length > 0 ? [...threadUnits] : [""]);
    } else {
      setDraftText(text);
    }
    setEditing(true);
  };

  const canSaveEdit = isThread
    ? draftUnits.some((u) => u.trim().length > 0)
    : draftText.trim().length > 0;

  const handleCopyPlainText = async () => {
    const plain = formatArtifactPlainText(artifact);
    if (!plain) {
      toast({ title: "Nothing to copy", description: "This artifact has no text content yet." });
      return;
    }
    try {
      await navigator.clipboard.writeText(plain);
      toast({ title: "Copied text", description: "Content copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard access was blocked by the browser.", variant: "destructive" });
    }
  };

  const handleCopyThread = async () => {
    const numbered = formatArtifactNumberedThread(artifact);
    if (!numbered) {
      toast({ title: "Nothing to copy", description: "This thread has no posts yet." });
      return;
    }
    try {
      await navigator.clipboard.writeText(numbered);
      toast({ title: "Copied numbered thread", description: "Numbered thread copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard access was blocked by the browser.", variant: "destructive" });
    }
  };

  const handleExportMarkdown = () => {
    const exportContext = {
      version: currentVersion,
      storyTitle: storyQuery.data?.title,
      opportunityConcept: opportunityQuery.data?.concept,
      evidence: exportEvidence,
    };
    const markdown = formatArtifactMarkdownExport(artifact, exportContext);
    const filename = buildArtifactExportFilename(artifact, exportContext);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    toast({ title: "Exported Markdown", description: `Downloaded ${filename}` });
  };

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

  const claimAudit = parseClaimAuditSummary(artifact.attribution);
  const evidenceById = new Map<number, ArtifactExportEvidence>();
  for (const item of rawEvidence) {
    if (typeof item.id === "number") evidenceById.set(item.id, item);
  }

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
          {historyQuery.isError && (
            <span className="text-xs text-warning" data-testid="text-history-error">
              Version history unavailable —{" "}
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => void historyQuery.refetch()}
              >
                retry
              </button>
            </span>
          )}
        </div>
      </div>

      {/* Main Review Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left / Center: Content Preview */}
        <div className="lg:col-span-8 space-y-4">
          <Card className="border shadow-xs" data-testid="card-review-preview">
            <CardHeader className="pb-3 border-b bg-muted/20 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium">
                <ChannelIcon channel={artifact.channel} decorative />
                <span className="capitalize">{artifact.channel}</span>
                <span className="text-muted-foreground">·</span>
                <span className="capitalize">{artifact.format.replace(/_/g, " ")}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {isThread
                  ? `${(editing ? draftUnits : threadUnits).length} posts · ${text.length} characters`
                  : `${text.length} characters`}
              </span>
            </CardHeader>

            <CardContent className="p-4 md:p-6 space-y-4">
              {editing ? (
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Edit3 className="h-3.5 w-3.5" />
                    Editing will create Version {history.length + 1} in draft status.
                  </div>
                  {isThread ? (
                    <div className="space-y-3" data-testid="editor-thread-units">
                      {draftUnits.map((unit, idx) => {
                        const overBudget = unit.length > X_POST_CHAR_BUDGET;
                        const fieldId = `textarea-thread-unit-${idx}`;
                        return (
                          <div key={idx} className="space-y-1.5 rounded-md border p-3 bg-muted/10">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <label htmlFor={fieldId} className="font-medium text-foreground">
                                Post {idx + 1} of {draftUnits.length}
                              </label>
                              <div className="flex items-center gap-2">
                                <span
                                  className={overBudget ? "text-destructive font-medium" : "text-muted-foreground"}
                                  data-testid={`text-thread-unit-count-${idx}`}
                                >
                                  {unit.length} / {X_POST_CHAR_BUDGET}
                                </span>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                  disabled={draftUnits.length <= 1}
                                  onClick={() =>
                                    setDraftUnits((prev) => prev.filter((_, unitIdx) => unitIdx !== idx))
                                  }
                                  aria-label={`Remove post ${idx + 1}`}
                                  data-testid={`button-thread-remove-unit-${idx}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                            <Textarea
                              id={fieldId}
                              value={unit}
                              onChange={(e) => {
                                const next = [...draftUnits];
                                next[idx] = e.target.value;
                                setDraftUnits(next);
                              }}
                              rows={3}
                              className="font-sans text-sm leading-relaxed"
                              data-testid={`textarea-thread-unit-${idx}`}
                            />
                          </div>
                        );
                      })}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs"
                        onClick={() => setDraftUnits((prev) => [...prev, ""])}
                        data-testid="button-thread-add-unit"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Post to Thread
                      </Button>
                    </div>
                  ) : (
                    <Textarea
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      rows={8}
                      aria-label="Edit content"
                      className="font-sans text-sm leading-relaxed"
                      data-testid="textarea-review-edit"
                    />
                  )}
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
                      disabled={reviseMutation.isPending || !canSaveEdit}
                      data-testid="button-review-save-edit"
                    >
                      Save Version {history.length + 1}
                    </Button>
                  </div>
                </div>
              ) : isThread && threadUnits.length > 0 ? (
                <div className="space-y-3" data-testid="text-review-rendered-content">
                  {threadUnits.map((unit, idx) => (
                    <div key={idx} className="rounded-md border bg-muted/10 p-3 space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-mono font-medium">
                          {idx + 1}/{threadUnits.length}
                        </span>
                        <span className={unit.length > X_POST_CHAR_BUDGET ? "text-destructive font-medium" : ""}>
                          {unit.length} / {X_POST_CHAR_BUDGET}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed font-sans">{unit}</p>
                    </div>
                  ))}
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
              className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning flex items-start gap-2"
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

        {/* Right: Metadata, Claim Audit & Workflow Actions */}
        <div className="lg:col-span-4 space-y-4">
          {claimAudit.hasAuditData && (
            <Card className="border shadow-xs" data-testid="card-claim-audit">
              <CardHeader className="pb-3 border-b bg-muted/20">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    {!claimAudit.hasClaimAudit ? (
                      <FileSearch className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : claimAudit.unsupportedCount > 0 || claimAudit.qualityFlags.length > 0 ? (
                      <ShieldAlert className="h-3.5 w-3.5 text-warning" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    )}
                    Evidence &amp; Claim Audit
                  </CardTitle>
                  {claimAudit.paraphraseOverlap > 0 && (
                    <span
                      className={`text-[11px] font-mono ${
                        claimAudit.paraphraseOverlap >= 0.35
                          ? "text-destructive font-semibold"
                          : "text-muted-foreground"
                      }`}
                      data-testid="text-paraphrase-overlap"
                    >
                      {Math.round(claimAudit.paraphraseOverlap * 100)}% overlap
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs">
                <div className="flex flex-wrap gap-1.5">
                  {claimAudit.hasClaimAudit ? (
                    <>
                      <Badge
                        variant="secondary"
                        className="text-[11px]"
                        data-testid="badge-claims-supported"
                      >
                        {claimAudit.supportedCount} supported
                      </Badge>
                      <Badge
                        variant={claimAudit.unsupportedCount > 0 ? "destructive" : "outline"}
                        className="text-[11px]"
                        data-testid="badge-claims-unsupported"
                      >
                        {claimAudit.unsupportedCount} unsupported
                      </Badge>
                      {claimAudit.opinionCount > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[11px]"
                          data-testid="badge-claims-opinion"
                        >
                          {claimAudit.opinionCount} opinion
                        </Badge>
                      )}
                    </>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[11px] text-muted-foreground"
                      data-testid="badge-legacy-provenance"
                    >
                      Legacy provenance (no claim audit)
                    </Badge>
                  )}
                  {claimAudit.evidenceIds.length > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[11px] font-mono"
                      data-testid="badge-audit-evidence-count"
                    >
                      <FileSearch className="h-3 w-3 mr-1" />
                      {claimAudit.evidenceIds.length} source{claimAudit.evidenceIds.length === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>

                {claimAudit.qualityFlags.length > 0 && (
                  <div
                    className="rounded-md border border-warning/30 bg-warning/10 p-2.5 space-y-1.5"
                    data-testid="list-quality-flags"
                  >
                    <p className="font-medium text-warning flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Quality &amp; Grounding Warnings
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {claimAudit.qualityFlags.map((flag) => (
                        <Badge
                          key={flag}
                          variant="outline"
                          className="text-[11px] border-warning/40 text-foreground bg-background/70"
                          data-testid={`badge-quality-flag-${flag}`}
                        >
                          {QUALITY_FLAG_LABELS[flag] ?? flag.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {claimAudit.claims.length > 0 && (
                  <div className="space-y-2" data-testid="list-audited-claims">
                    {claimAudit.claims.map((claim, idx) => (
                      <div
                        key={`${claim.unitIndex}-${idx}`}
                        className="rounded-md border p-2 space-y-1 bg-muted/10"
                        data-testid={`item-audited-claim-${idx}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge
                            variant={
                              claim.status === "unsupported"
                                ? "destructive"
                                : claim.status === "supported"
                                  ? "secondary"
                                  : "outline"
                            }
                            className="text-[10px] uppercase"
                          >
                            {claim.status}
                          </Badge>
                          {claim.evidenceIds.length > 0 && (
                            <span className="text-[11px] font-mono text-muted-foreground">
                              {claim.evidenceIds.map((id) => `#${id}`).join(", ")}
                            </span>
                          )}
                        </div>
                        <p className="text-foreground break-words leading-snug">{claim.claimText}</p>
                        {claim.reason && (
                          <p className="text-[11px] text-muted-foreground">{claim.reason}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {claimAudit.evidenceIds.length > 0 && (
                  <div className="pt-1 border-t space-y-1" data-testid="list-audit-evidence">
                    <span className="text-[11px] font-medium text-muted-foreground block">
                      Linked Evidence
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {claimAudit.evidenceIds.map((id) => {
                        const match = evidenceById.get(id);
                        return (
                          <Badge
                            key={id}
                            variant="outline"
                            className="text-[11px] font-mono max-w-full truncate"
                            title={match?.excerpt || `Evidence #${id}`}
                          >
                            #{id}
                            {match?.excerpt ? ` · ${match.excerpt.slice(0, 32)}` : ""}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

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
                  <ChannelIcon channel={artifact.channel} decorative />
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
                isRejected ? (
                  <>
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-muted-foreground" data-testid="text-rejected-immutable">
                      This revision is rejected and cannot be approved or scheduled. Create a new version to continue.
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={openEditor}
                        data-testid="button-review-edit"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        New version
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Button
                        className="w-full justify-center gap-2"
                        onClick={() => approveMutation.mutate()}
                        disabled={approveMutation.isPending}
                        data-testid="button-review-approve"
                      >
                        {/* Sits on the primary Approve fill, so it uses --primary-foreground, not --success
                            (a --success glyph would fall below 3:1 on the primary surface). */}
                        <CheckCircle2 className="h-4 w-4 text-primary-foreground" />
                        Approve Content
                      </Button>
                      {isInReview && (
                        <Button
                          variant="outline"
                          className="w-full justify-center gap-2 text-destructive hover:text-destructive"
                          onClick={() => setRejectConfirmOpen(true)}
                          disabled={rejectMutation.isPending}
                          data-testid="button-review-reject"
                        >
                          <XCircle className="h-4 w-4" />
                          Reject
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={openEditor}
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
                )
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
                      onClick={openEditor}
                      data-testid="button-review-new-version"
                    >
                      Create another version
                    </Button>
                  </div>
                </>
              )}

              {/* Export-First Copy & Markdown Actions (available on all states) */}
              <div className="pt-3 mt-2 border-t space-y-2" data-testid="section-artifact-export">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                  Copy &amp; Export
                </span>
                <div className="grid grid-cols-1 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-center gap-1.5 text-xs"
                    onClick={() => void handleCopyPlainText()}
                    data-testid="button-copy-artifact"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy Text
                  </Button>
                  {isThread && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-center gap-1.5 text-xs"
                      onClick={() => void handleCopyThread()}
                      data-testid="button-copy-thread"
                    >
                      <ListOrdered className="h-3.5 w-3.5" />
                      Copy Thread
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-center gap-1.5 text-xs"
                    onClick={handleExportMarkdown}
                    data-testid="button-export-markdown"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export Markdown
                  </Button>
                </div>
              </div>
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

      <ConfirmDialog
        open={rejectConfirmOpen}
        onOpenChange={setRejectConfirmOpen}
        title="Reject this revision?"
        description="Rejecting marks this exact revision as rejected. It cannot be approved or scheduled; create a new version if you want to continue."
        confirmLabel="Reject revision"
        destructive
        loading={rejectMutation.isPending}
        onConfirm={() => rejectMutation.mutate()}
      />
    </div>
  );
}
