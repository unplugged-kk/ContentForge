import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { PageHeader } from "@/components/ui-shared/page-header";
import { CreateStudio } from "@/components/create/create-studio";
import { ArtifactReviewView } from "@/components/create/artifact-review-view";
import { EmptyState } from "@/components/ui-shared/empty-state";
import { Button } from "@/components/ui/button";
import type { ContentType } from "@/lib/create-workflow";
import {
  Sparkles,
  Zap,
  LayoutGrid,
  Image,
  FileText,
  LayoutTemplate,
  CaseSensitive,
  Quote,
  MessageSquare,
  PlusCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CREATE_MODES = [
  { key: "post-thread", name: "Post & Thread", path: "/create", icon: Sparkles, active: true },
  { key: "hooks", name: "Hooks", path: "/hooks", icon: Zap, active: false },
  { key: "carousel", name: "Carousel", path: "/carousel", icon: LayoutGrid, active: false },
  { key: "images", name: "Images", path: "/images", icon: Image, active: false },
  { key: "articles", name: "Articles", path: "/articles", icon: FileText, active: false },
  { key: "templates", name: "Templates", path: "/templates", icon: LayoutTemplate, active: false },
  { key: "formatter", name: "Formatter", path: "/formatter", icon: CaseSensitive, active: false },
  { key: "canned-responses", name: "Canned Responses", path: "/canned-responses", icon: Quote, active: false },
  { key: "chat-post", name: "Chat → Post", path: "/chat", icon: MessageSquare, active: false },
];

export default function CreatePage() {
  const [location, setLocation] = useLocation();
  const [activeArtifactId, setActiveArtifactId] = useState<number | null>(null);
  const [contentType, setContentType] = useState<ContentType>("post");
  const [initialStoryId, setInitialStoryId] = useState<number | undefined>(undefined);
  const [initialIdeaId, setInitialIdeaId] = useState<number | undefined>(undefined);
  const [showEmptyState, setShowEmptyState] = useState(false);

  // Parse query parameters
  useEffect(() => {
    const search = window.location.search;
    if (search) {
      const params = new URLSearchParams(search);
      const artParam = params.get("artifact") || params.get("artifactId");
      if (artParam && !Number.isNaN(Number(artParam))) {
        setActiveArtifactId(Number(artParam));
      }

      const typeParam = params.get("type");
      if (
        typeParam &&
        ["post", "thread", "article", "carousel", "image", "video", "audio"].includes(typeParam)
      ) {
        setContentType(typeParam as ContentType);
      }

      const storyParam = params.get("storyId");
      if (storyParam && !Number.isNaN(Number(storyParam))) {
        setInitialStoryId(Number(storyParam));
      }

      const ideaParam = params.get("ideaId");
      if (ideaParam && !Number.isNaN(Number(ideaParam))) {
        setInitialIdeaId(Number(ideaParam));
      }

      if (params.get("empty") === "true") {
        setShowEmptyState(true);
      }
    }
  }, [location]);

  const handleGenerationComplete = (artifactId: number) => {
    setActiveArtifactId(artifactId);
    // Push into URL without full page reload
    const url = new URL(window.location.href);
    url.searchParams.set("artifact", String(artifactId));
    window.history.pushState({}, "", url.toString());
  };

  const handleBackToCreate = () => {
    setActiveArtifactId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("artifact");
    url.searchParams.delete("artifactId");
    window.history.pushState({}, "", url.toString());
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="page-create">
      <PageHeader
        title="Create"
        description="From idea to approved content"
        testId="page-header-create"
        titleTestId="text-page-title"
        action={
          activeArtifactId ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-8"
              onClick={handleBackToCreate}
              data-testid="button-create-new-header"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span>Create New</span>
            </Button>
          ) : undefined
        }
      />

      {/* Creation Modes Bar */}
      <div
        className="border-b bg-muted/40 px-4 py-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0"
        data-testid="nav-create-modes"
      >
        <span className="text-[11px] font-medium text-muted-foreground mr-1 shrink-0">Mode:</span>
        {CREATE_MODES.map((mode) => (
          <Link
            key={mode.name}
            href={mode.path}
            data-testid={`link-create-mode-${mode.key}`}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
              mode.active
                ? "bg-background text-foreground shadow-xs border"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50",
            )}
          >
            <mode.icon className="h-3.5 w-3.5" />
            <span>{mode.name}</span>
          </Link>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        {showEmptyState ? (
          <div className="p-8 max-w-xl mx-auto flex items-center justify-center h-full">
            <EmptyState
              icon={Sparkles}
              title="Create something new"
              description="Start from a story, idea, source, or blank canvas."
              action={
                <Button
                  size="sm"
                  onClick={() => setShowEmptyState(false)}
                  data-testid="button-empty-create-content"
                >
                  Create content
                </Button>
              }
              testId="empty-state-create"
            />
          </div>
        ) : activeArtifactId ? (
          <ArtifactReviewView
            artifactId={activeArtifactId}
            onBackToCreate={handleBackToCreate}
            onSelectArtifact={(newId) => {
              setActiveArtifactId(newId);
              const url = new URL(window.location.href);
              url.searchParams.set("artifact", String(newId));
              window.history.pushState({}, "", url.toString());
            }}
          />
        ) : (
          <CreateStudio
            onGenerationComplete={handleGenerationComplete}
            initialType={contentType}
            initialStoryId={initialStoryId}
            initialIdeaId={initialIdeaId}
          />
        )}
      </div>
    </div>
  );
}
