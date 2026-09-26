import { ExternalLink, Bookmark, BookmarkCheck, FileText, Sparkles, AlertTriangle, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  resolveCredibility,
  humanizeQuality,
  humanizeNovelty,
  formatRelativeTime,
  sanitizeUntrustedText,
} from "@/lib/sources-research-state";

export interface SourceDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: {
    id: number;
    title?: string | null;
    canonicalUrl: string;
    provider: string;
    sourceClass?: string | null;
    excerpt?: string | null;
    publishedAt?: string | Date | null;
    retrievedAt?: string | Date | null;
    author?: { name?: string; handle?: string } | null;
    quality?: string | null;
    novelty?: string | number | null;
  } | null;
  evidenceList?: Array<{
    id: number;
    claim?: string | null;
    excerpt?: string;
    kind?: string;
    confidence?: string | number;
    corroborationCount?: number;
  }>;
  /** True when the parent's evidence read failed — an absence of claims is then unknown, not empty. */
  evidenceError?: boolean;
  conflicts?: Array<{
    claimA?: string;
    claimB?: string;
    topic?: string;
    sourceUrlA?: string;
    sourceUrlB?: string;
  }>;
  researchContext?: {
    query?: string | null;
    depth?: string | null;
    window?: string | null;
  };
  isSaved?: boolean;
  onSave?: () => void;
  onCreateStory: () => void;
  onCreateContent?: () => void;
}

export function SourceDetailModal({
  open,
  onOpenChange,
  source,
  evidenceList = [],
  evidenceError = false,
  conflicts = [],
  researchContext,
  isSaved = false,
  onSave,
  onCreateStory,
  onCreateContent,
}: SourceDetailModalProps) {
  if (!source) return null;

  const hasConflicts = conflicts.length > 0;
  const cred = resolveCredibility(source.sourceClass, evidenceList.length || 1, hasConflicts);
  const quality = humanizeQuality(source.quality);
  const novelty = humanizeNovelty(source.novelty);
  const cleanExcerpt = sanitizeUntrustedText(source.excerpt);
  const title = source.title || "Source Detail";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-source-detail">
        <DialogHeader className="space-y-2 pb-2 border-b">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-xs uppercase font-semibold">
              {source.provider}
            </Badge>
            <Badge variant={cred.variant} className="text-xs" data-testid="badge-source-credibility">
              {cred.label}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {quality.label}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {novelty.label}
            </Badge>
          </div>

          <DialogTitle className="text-base sm:text-lg font-bold leading-snug pt-1">
            {title}
          </DialogTitle>

          <DialogDescription className="text-xs flex flex-wrap items-center gap-2 text-muted-foreground">
            {source.author?.name && <span>By {source.author.name} · </span>}
            <span>Published {formatRelativeTime(source.publishedAt ?? source.retrievedAt)}</span>
            <span>·</span>
            <a
              href={source.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline truncate max-w-[260px]"
            >
              <span className="truncate">{source.canonicalUrl}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-3 text-sm">
          {/* Conflicting Evidence Notice */}
          {hasConflicts && (
            <div
              className="rounded-md border border-warning/30 bg-warning/10 p-3 space-y-2 text-xs"
              data-testid="panel-source-conflicts"
            >
              <div className="flex items-center gap-1.5 font-semibold text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                <span>Possible disagreement in evidence</span>
              </div>
              <p className="text-warning">
                Independent sources report competing findings on this topic. Review all evidence before using this claim in published content.
              </p>
              {conflicts.map((c, i) => (
                <div key={i} className="pl-3 border-l-2 border-warning/40 space-y-1 my-1">
                  {c.claimA && <p><span className="font-semibold">Source A:</span> {c.claimA}</p>}
                  {c.claimB && <p><span className="font-semibold">Source B:</span> {c.claimB}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Summary */}
          <section className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Summary
            </h4>
            <div className="rounded-md bg-muted/30 p-3 text-xs sm:text-sm text-foreground leading-relaxed">
              {cleanExcerpt || "(No excerpt available for this source.)"}
            </div>
          </section>

          {/* Evidence Section */}
          <section className="space-y-2" data-testid="section-source-evidence">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Extracted Evidence ({evidenceList.length})
              </h4>
              <span className="text-xs text-muted-foreground">
                {cred.description}
              </span>
            </div>

            {evidenceError ? (
              <p className="text-xs text-warning">
                Evidence for this source couldn't be loaded — the claim list may be incomplete.
              </p>
            ) : evidenceList.length > 0 ? (
              <div className="space-y-2">
                {evidenceList.map((item, idx) => (
                  <div key={item.id || idx} className="rounded-md border p-3 bg-card space-y-1 text-xs">
                    <p className="font-medium text-foreground">
                      "{item.claim || item.excerpt}"
                    </p>
                    {item.corroborationCount && item.corroborationCount > 1 && (
                      <span className="text-xs text-success">
                        Supported by {item.corroborationCount} sources
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                Direct evidence derived from primary text excerpt.
              </p>
            )}
          </section>

          {/* Research Context */}
          {researchContext && (
            <section className="space-y-1 text-xs border-t pt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Research Context
              </h4>
              <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
                {researchContext.query && (
                  <span>Topic: <strong className="text-foreground">{researchContext.query}</strong></span>
                )}
                {researchContext.window && (
                  <span>Window: <strong className="text-foreground">{researchContext.window}</strong></span>
                )}
                {researchContext.depth && (
                  <span>Depth: <strong className="text-foreground">{researchContext.depth}</strong></span>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Modal Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t">
          {onSave && (
            <Button
              size="sm"
              variant={isSaved ? "secondary" : "outline"}
              className="h-8 text-xs gap-1.5"
              onClick={onSave}
              data-testid="button-detail-save"
            >
              {isSaved ? <BookmarkCheck className="h-3.5 w-3.5 text-primary" /> : <Bookmark className="h-3.5 w-3.5" />}
              {isSaved ? "Saved" : "Save to Knowledge Base"}
            </Button>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <Button
              size="sm"
              variant="secondary"
              className="h-8 text-xs gap-1.5"
              onClick={() => {
                onOpenChange(false);
                onCreateStory();
              }}
              data-testid="button-detail-create-story"
            >
              <FileText className="h-3.5 w-3.5" />
              Create Story
            </Button>
            {onCreateContent && (
              <Button
                size="sm"
                variant="default"
                className="h-8 text-xs gap-1.5"
                onClick={() => {
                  onOpenChange(false);
                  onCreateContent();
                }}
                data-testid="button-detail-create-content"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Create Content
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
