import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ToolCallView } from "@shared/agent-ui";

function textField(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
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
          <Badge variant={call.status === "denied" ? "destructive" : "secondary"} data-testid={`badge-tool-status-${call.id}`}>
            {call.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{call.summary}</p>
        {call.renderer === "research_topic" && (
          <div className="text-xs space-y-1">
            {sourceCount > 0 ? <p>{sourceCount} sources</p> : null}
            {researchJobId > 0 ? <p>ResearchJob {researchJobId}</p> : null}
            {storyId > 0 ? <p>1 Story</p> : null}
            <Badge variant="outline">Source Content UNTRUSTED</Badge>
            {researchJobId > 0 && (
              <Button size="sm" variant="outline" onClick={() => onOpen?.("research", researchJobId)} data-testid={`button-open-research-${call.id}`}>
                Open Research
              </Button>
            )}
          </div>
        )}
        {call.renderer === "generate_artifact" && (
          <div className="text-xs space-y-1">
            {Number(refs.opportunityId) > 0 ? <p>Opportunity: opp_{String(refs.opportunityId)}</p> : null}
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
          <p className="text-xs">{opportunityIds.length} opportunities</p>
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
        {story.researchJobId != null ? <p>ResearchJob {String(story.researchJobId)}</p> : null}
      </CardContent>
    </Card>
  );
}

export function OpportunityCard({ opportunity }: { opportunity: Record<string, unknown> }) {
  return (
    <Card data-testid={`card-opportunity-${opportunity.id}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Opportunity {String(opportunity.id)}</CardTitle>
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
        <CardTitle className="text-sm">VisualAsset {String(asset.id)}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <p>{textField(asset.kind)} · {textField(asset.mime) || "identity only"}</p>
        <p>Status: {textField(asset.status)}</p>
        {asset.contentHash ? <p className="font-mono break-all">hash {String(asset.contentHash)}</p> : null}
      </CardContent>
    </Card>
  );
}

export function VideoAssetCard({ asset }: { asset: Record<string, unknown> }) {
  return (
    <Card data-testid={`card-video-${asset.id}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">VideoAsset {String(asset.id)}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <p>Status: {textField(asset.status)}</p>
        {asset.visualGenerationId != null ? <p>Generation {String(asset.visualGenerationId)}</p> : null}
        {asset.durationMs != null ? <p>Duration {String(asset.durationMs)}ms</p> : null}
        {asset.width != null && asset.height != null ? <p>{String(asset.width)}×{String(asset.height)}</p> : null}
        <p>Identity only — no binary in agent messages.</p>
      </CardContent>
    </Card>
  );
}

export function VideoGenerationCard({ generation }: { generation: Record<string, unknown> }) {
  return (
    <Card data-testid={`card-video-generation-${generation.id}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">VideoGeneration {String(generation.id)}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <p>Status: {textField(generation.status)}</p>
        <p>Provider: {textField(generation.providerId)}</p>
      </CardContent>
    </Card>
  );
}

export function VideoRepurposingCard({ job }: { job: Record<string, unknown> }) {
  return (
    <Card data-testid={`card-video-repurposing-${job.id}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">VideoRepurposingJob {String(job.id)}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <p data-testid="text-video-repurpose-status">Status: {textField(job.status)}</p>
        <p data-testid="text-video-repurpose-source">Source VideoAsset {String(job.sourceVisualAssetId ?? "—")}</p>
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
        {clip.visualAssetId != null ? <p>VideoAsset {String(clip.visualAssetId)}</p> : null}
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
      className={`w-full text-left rounded-md border p-2 ${active ? "border-primary bg-primary/5" : "border-border"}`}
      onClick={() => onOpen(run.id)}
      data-testid={`card-agent-run-${run.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">Run {run.id}</span>
        <Badge variant="secondary">{run.status}</Badge>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{run.objective}</p>
      <p className="text-[10px] text-muted-foreground mt-1">
        {run.backendId} · step {run.currentStep} · {new Date(run.createdAt).toLocaleString()}
        {run.finishedAt ? ` · done ${new Date(run.finishedAt).toLocaleString()}` : ""}
      </p>
    </button>
  );
}

export function UntrustedSource({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed p-2 bg-muted/40" data-testid="panel-untrusted-source">
      <Badge variant="outline">Source Content UNTRUSTED</Badge>
      <p className="text-xs mt-1 whitespace-pre-wrap break-words">{text}</p>
    </div>
  );
}
