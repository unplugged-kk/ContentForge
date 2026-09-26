import { useState, useEffect, type ComponentType } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { PageHeader } from "@/components/ui-shared/page-header";
import { CreateStudio } from "@/components/create/create-studio";
import { ArtifactReviewView } from "@/components/create/artifact-review-view";
import HooksPage from "@/pages/hooks";
import CarouselPage from "@/pages/carousel";
import ImageGenPage from "@/pages/imagegen";
import ArticlesPage from "@/pages/articles";
import TemplatesPage from "@/pages/templates";
import FormatterPage from "@/pages/formatter";
import CannedResponsesPage from "@/pages/canned-responses";
import ChatPage from "@/pages/chat";
import { EmptyState } from "@/components/ui-shared/empty-state";
import { Button } from "@/components/ui/button";
import type { ContentType } from "@/lib/create-workflow";
import { getCreateModeHref } from "@/lib/legacy-route-mapping";
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
  Youtube,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CREATE_MODES = [
  { key: "post-thread", name: "Post & Thread", icon: Sparkles },
  { key: "hooks", name: "Hooks", icon: Zap },
  { key: "carousel", name: "Carousel", icon: LayoutGrid },
  { key: "images", name: "Images", icon: Image },
  { key: "articles", name: "Articles", icon: FileText },
  { key: "templates", name: "Templates", icon: LayoutTemplate },
  { key: "formatter", name: "Formatter", icon: CaseSensitive },
  { key: "canned-responses", name: "Canned Responses", icon: Quote },
  { key: "chat-post", name: "Chat → Post", icon: MessageSquare },
] as const;

const CREATE_MODE_COMPONENTS: Record<string, ComponentType> = {
  hooks: HooksPage,
  carousel: CarouselPage,
  images: ImageGenPage,
  articles: ArticlesPage,
  templates: TemplatesPage,
  formatter: FormatterPage,
  "canned-responses": CannedResponsesPage,
  "chat-post": ChatPage,
};

function isCreateMode(value: string | null): value is string {
  return Boolean(value && Object.prototype.hasOwnProperty.call(CREATE_MODE_COMPONENTS, value));
}

export default function CreatePage() {
  const [location] = useLocation();
  const search = useSearch();
  const [activeArtifactId, setActiveArtifactId] = useState<number | null>(null);
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const [contentType, setContentType] = useState<ContentType>("post");
  const [initialStoryId, setInitialStoryId] = useState<number | undefined>(undefined);
  const [initialIdeaId, setInitialIdeaId] = useState<number | undefined>(undefined);
  const [showEmptyState, setShowEmptyState] = useState(false);

  // Parse query parameters
  useEffect(() => {
    const searchString = search || window.location.search;
    if (searchString) {
      const params = new URLSearchParams(searchString);
      const modeParam = params.get("mode");
      setActiveMode(isCreateMode(modeParam) ? modeParam : null);

      const artParam = params.get("artifact") || params.get("artifactId");
      if (artParam && !Number.isNaN(Number(artParam))) {
        setActiveArtifactId(Number(artParam));
      } else {
        setActiveArtifactId(null);
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

      setShowEmptyState(params.get("empty") === "true");
    } else {
      setActiveMode(null);
      setActiveArtifactId(null);
      setShowEmptyState(false);
    }
  }, [location, search]);

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

  const currentSearch = search || window.location.search;
  const ActiveModeComponent = activeMode ? CREATE_MODE_COMPONENTS[activeMode] : null;

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
        {CREATE_MODES.map((mode) => {
          const isActive = mode.key === "post-thread" ? activeMode === null : activeMode === mode.key;
          return (
            <Link
              key={mode.name}
              href={getCreateModeHref(mode.key, currentSearch)}
              data-testid={`link-create-mode-${mode.key}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
                isActive
                  ? "bg-background text-foreground shadow-xs border"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50",
              )}
            >
              <mode.icon className="h-3.5 w-3.5" />
              <span>{mode.name}</span>
            </Link>
          );
        })}
        <Link
          href="/youtube"
          data-testid="link-youtube-deferred"
          aria-label="YouTube, legacy capability with canonical placement deferred"
          title="YouTube remains available on its legacy route until its canonical home is decided"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-background/50 shrink-0"
        >
          <Youtube className="h-3.5 w-3.5" />
          <span>YouTube (deferred)</span>
        </Link>
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
        ) : ActiveModeComponent ? (
          <div className="h-full overflow-y-auto" data-testid={`create-mode-${activeMode}`}>
            <ActiveModeComponent />
          </div>
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
