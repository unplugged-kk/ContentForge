import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui-shared/status-badge";
import type { ToolCallView } from "@shared/agent-ui";

function textField(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

/**
 * Tool-call statuses come from the agent protocol; `denied` is the one value the
 * shared status vocabulary does not carry. A denied tool call is a blocked
 * action, so it maps to `blocked` (destructive + alert glyph) rather than being
 * rendered verbatim or rounded to `unknown` (F1(b) — one status vocabulary).
 */
function toolStatus(status: string): string {
  return status === "denied" ? "blocked" : status;
}

/**
 * Technical identity (ids, hashes, provider ids) is progressively disclosed
 * behind this disclosure rather than competing with the operator workflow
 * (F1(d)). Never rendered as the primary label.
 */
function TechnicalDetails({ children }: { children: ReactNode }) {
  return (
    <details className="pt-1">
      <summary className="cursor-pointer text-xs text-muted-foreground">Technical details</summary>
      <div className="mt-1 space-y-0.5 font-mono text-xs break-all">{children}</div>
    </details>
  );
}

export function ToolCallCard({
  call,
  onOpen,
}: {
  call: ToolCallView;
  onOpen?: (kind: string, id: number) => void;
}) {
  const refs = call.refs;
  const storyId = Number(refs.storyId);
  const researchJobId = Number(refs.researchJobId);
  const opportunityIds = Array.isArray(refs.opportunityIds) ? refs.opportunityIds : [];
  const artifactId = Number(refs.artifactId);
  const data = (call.result?.data ?? {}) as Record<string, unknown>;
  const sourceCount = Number(data.sourceCount ?? 0);

  return (
    <Card data-testid={`card-tool-call-${call.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">{call.name.replace(/_/g, " ")}</CardTitle>
          <StatusBadge status={toolStatus(call.status)} testId={`badge-tool-status-${call.id}`} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{call.summary}</p>
        {call.renderer === "research_topic" && (
          <div className="text-xs space-y-1">
            {sourceCount > 0 ? <p>{sourceCount} sources</p> : null}
            {researchJobId > 0 ? <p>Research #{researchJobId}</p> : null}
            {storyId > 0 ? <p>1 Story</p> : null}
            <Badge variant="outline">External Source (Unverified)</Badge>
            {researchJobId > 0 && (
              <Button size="sm" variant="outline" onClick={() => onOpen?.("research", researchJobId)} data-testid={`button-open-research-${call.id}`}>
                Open Research
              </Button>
            )}
          </div>
        )}
        {call.renderer === "generate_artifact" && (
          <div className="text-xs space-y-1">
            {Number(refs.opportunityId) > 0 ? <p>Idea #{String(refs.opportunityId)}</p> : null}
            {textField(call.arguments.format) ? <p>Format: {textField(call.arguments.format)}</p> : null}
            {artifactId > 0 && (
              <Button size="sm" variant="outline" onClick={() => onOpen?.("artifact", artifactId)} data-testid={`button-view-artifact-${call.id}`}>
                View Details
              </Button>
            )}
          </div>
        )}
        {storyId > 0 && call.renderer !== "research_topic" && (
          <Button size="sm" variant="ghost" onClick={() => onOpen?.("story", storyId)}>Open Story</Button>
        )}
        {opportunityIds.length > 0 && (
          <p className="text-xs">{opportunityIds.length} ideas</p>
        )}
        {call.errorMessage ? <p className="text-destructive text-xs">{call.errorMessage}</p> : null}
      </CardContent>
    </Card>
  );
}

export function StoryCard({ story }: { story: Record<string, unknown> }) {
  return (
    <Card data-testid={`card-story-${story.id}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{textField(story.title) || `Story ${story.id}`}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <p>Status: {textField(story.status)}</p>
        {story.researchJobId != null ? <p>Research #{String(story.researchJobId)}</p> : null}
      </CardContent>
    </Card>
  );
}

export function OpportunityCard({ opportunity }: { opportunity: Record<string, unknown> }) {
  return (
    <Card data-testid={`card-opportunity-${opportunity.id}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Idea {String(opportunity.id)}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <p>{textField(opportunity.format)} × {textField(opportunity.channel)}</p>
        <p>Status: {textField(opportunity.status)}</p>
      </CardContent>
    </Card>
  );
}

export function PublicationCard({ publication }: { publication: Record<string, unknown> }) {
  const state = textField(publication.state) || textField(publication.resultState) || "unknown";
  const unknown = state.toLowerCase() === "unknown";
  const published = state.toLowerCase() === "published" || state.toLowerCase() === "succeeded";
  return (
    <Card data-testid={`card-publication-${publication.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Publication {String(publication.id)}</CardTitle>
          <Badge variant={unknown ? "outline" : published ? "default" : "secondary"} data-testid={`badge-publication-state-${publication.id}`}>
            {unknown ? "UNKNOWN" : state}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        <p>Channel: {textField(publication.channel)}</p>
        {publication.artifactId != null ? <p>Artifact {String(publication.artifactId)}</p> : null}
      </CardContent>
    </Card>
  );
}

export function VisualAssetCard({ asset }: { asset: Record<string, unknown> }) {
  return (
    <Card data-testid={`card-visual-${asset.id}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Image</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <p>{textField(asset.kind) || "Image"}</p>
        <TechnicalDetails>
          <p>id {String(asset.id)}</p>
          {textField(asset.mime) ? <p>{textField(asset.mime)}</p> : null}
          {asset.contentHash ? <p>hash {String(asset.contentHash)}</p> : null}
        </TechnicalDetails>
      </CardContent>
    </Card>
  );
}

export function VideoAssetCard({ asset }: { asset: Record<string, unknown> }) {
  return (
    <Card data-testid={`card-video-${asset.id}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Video</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <p>Status: {textField(asset.status) || "unknown"}</p>
        <TechnicalDetails>
          <p>id {String(asset.id)}</p>
          {asset.visualGenerationId != null ? <p>generation {String(asset.visualGenerationId)}</p> : null}
          {asset.durationMs != null ? <p>{String(asset.durationMs)}ms</p> : null}
          {asset.width != null && asset.height != null ? <p>{String(asset.width)}×{String(asset.height)}</p> : null}
        </TechnicalDetails>
      </CardContent>
    </Card>
  );
}

export function AudioAssetCard({ asset }: { asset: Record<string, unknown> }) {
  return (
    <Card data-testid={`card-audio-${asset.id}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Audio</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <p>Status: {textField(asset.status) || "unknown"}</p>
        <TechnicalDetails>
          <p>id {String(asset.id)}</p>
          {asset.visualGenerationId != null ? <p>generation {String(asset.visualGenerationId)}</p> : null}
          {asset.durationMs != null ? <p>{String(asset.durationMs)}ms</p> : null}
          {asset.sampleRate != null ? <p>{String(asset.sampleRate)}Hz · {String(asset.channels ?? "—")}ch</p> : null}
        </TechnicalDetails>
      </CardContent>
    </Card>
  );
}

export function VideoGenerationCard({ generation }: { generation: Record<string, unknown> }) {
  return (
    <Card data-testid={`card-video-generation-${generation.id}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Video generation</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <p>Status: {textField(generation.status)}</p>
        <TechnicalDetails>
          <p>id {String(generation.id)}</p>
          <p>provider {textField(generation.providerId)}</p>
        </TechnicalDetails>
      </CardContent>
    </Card>
  );
}

export function VideoRepurposingCard({ job }: { job: Record<string, unknown> }) {
  return (
    <Card data-testid={`card-video-repurposing-${job.id}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Video clips</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <p data-testid="text-video-repurpose-status">Status: {textField(job.status)}</p>
        <p data-testid="text-video-repurpose-source">Source video {String(job.sourceVisualAssetId ?? "—")}</p>
        <p data-testid="text-video-repurpose-clip-count">Clips {String(job.clipCount ?? "—")}</p>
      </CardContent>
    </Card>
  );
}

export function ClipCard({ clip }: { clip: Record<string, unknown> }) {
  return (
    <Card data-testid={`card-clip-${clip.visualAssetId ?? clip.position}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Clip {String(clip.position ?? clip.id)}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <p>Status: {textField(clip.status)}</p>
        <TechnicalDetails>
          {clip.visualAssetId != null ? <p>video {String(clip.visualAssetId)}</p> : null}
        </TechnicalDetails>
      </CardContent>
    </Card>
  );
}

export function AgentRunCard({
  run,
  active,
  onOpen,
}: {
  run: {
    id: number;
    objective: string;
    status: string;
    backendId: string;
    currentStep: number;
    createdAt: string;
    finishedAt: string | null;
  };
  active?: boolean;
  onOpen: (id: number) => void;
}) {
  return (
    <button
      type="button"
      className={`w-full text-left rounded-md border p-2 pressable ${active ? "border-primary bg-primary/5" : "border-border"}`}
      onClick={() => onOpen(run.id)}
      data-testid={`card-agent-run-${run.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">Run {run.id}</span>
        <StatusBadge status={run.status} />
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{run.objective}</p>
      <p className="text-xs text-muted-foreground mt-1">
        step {run.currentStep} · {new Date(run.createdAt).toLocaleString()}
        {run.finishedAt ? ` · done ${new Date(run.finishedAt).toLocaleString()}` : ""}
      </p>
    </button>
  );
}

export function UntrustedSource({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed p-2 bg-muted/40" data-testid="panel-untrusted-source">
      <Badge variant="outline">External Source (Unverified)</Badge>
      <p className="text-xs mt-1 whitespace-pre-wrap break-words">{text}</p>
    </div>
  );
}
