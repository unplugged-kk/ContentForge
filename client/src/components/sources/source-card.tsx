import { ExternalLink, Bookmark, BookmarkCheck, FileText, Sparkles, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  resolveCredibility,
  formatRelativeTime,
  sanitizeUntrustedText,
} from "@/lib/sources-research-state";

export interface SourceCardProps {
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
  };
  corroborationCount?: number;
  hasConflicts?: boolean;
  isSaved?: boolean;
  onOpen: () => void;
  onSave?: () => void;
  onCreateStory: () => void;
  onCreateContent?: () => void;
}

export function SourceCard({
  source,
  corroborationCount = 1,
  hasConflicts = false,
  isSaved = false,
  onOpen,
  onSave,
  onCreateStory,
  onCreateContent,
}: SourceCardProps) {
  const cred = resolveCredibility(source.sourceClass, corroborationCount, hasConflicts);
  const cleanExcerpt = sanitizeUntrustedText(source.excerpt);
  const title = source.title || "Untitled Source";
  const authorName = source.author?.name || source.author?.handle;

  return (
    <Card className="border-border shadow-xs hover:border-primary/40 transition-colors" data-testid={`card-source-${source.id}`}>
      <CardHeader className="pb-2 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-xs uppercase tracking-wider font-semibold">
              {source.provider}
            </Badge>
            <Badge variant={cred.variant} className="text-xs" data-testid="badge-source-credibility">
              {hasConflicts && <AlertTriangle className="h-3 w-3 mr-1 shrink-0" />}
              {cred.label}
            </Badge>
            {corroborationCount > 1 && (
              <span className="text-xs text-muted-foreground">
                {corroborationCount} sources
              </span>
            )}
          </div>

          <span className="text-xs text-muted-foreground shrink-0">
            {formatRelativeTime(source.publishedAt ?? source.retrievedAt)}
          </span>
        </div>

        <CardTitle className="text-sm sm:text-base font-semibold line-clamp-2 leading-snug">
          <button
            type="button"
            onClick={onOpen}
            className="text-left rounded-sm hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            data-testid={`button-source-title-${source.id}`}
          >
            {title}
          </button>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        {cleanExcerpt && (
          <p className="text-xs sm:text-sm text-muted-foreground line-clamp-3 leading-relaxed">
            {cleanExcerpt}
          </p>
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-0.5">
          {authorName && <span>By {authorName} · </span>}
          <a
            href={source.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline truncate max-w-[280px]"
            title={source.canonicalUrl}
          >
            <span className="truncate">{source.canonicalUrl}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        </div>

        {/* Primary Card Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={onOpen}
              data-testid={`button-source-view-${source.id}`}
            >
              View details
            </Button>
            {onSave && (
              <Button
                size="sm"
                variant={isSaved ? "secondary" : "ghost"}
                className="h-8 text-xs gap-1.5"
                onClick={onSave}
                data-testid={`button-source-save-${source.id}`}
                data-action="save-source"
              >
                {isSaved ? (
                  <>
                    <BookmarkCheck className="h-3.5 w-3.5 text-primary" />
                    Saved
                  </>
                ) : (
                  <>
                    <Bookmark className="h-3.5 w-3.5" />
                    Save
                  </>
                )}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <Button
              size="sm"
              variant="secondary"
              className="h-8 text-xs gap-1.5"
              onClick={onCreateStory}
              data-testid={`button-source-create-story-${source.id}`}
              data-action="create-story"
            >
              <FileText className="h-3.5 w-3.5" />
              Create Story
            </Button>
            {onCreateContent && (
              <Button
                size="sm"
                variant="default"
                className="h-8 text-xs gap-1.5"
                onClick={onCreateContent}
                data-testid={`button-source-create-content-${source.id}`}
                data-action="create-content"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Create Content
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
