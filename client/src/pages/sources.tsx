import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/ui-shared/page-header";
import { Button } from "@/components/ui/button";
import { DiscoverTab } from "@/components/sources/discover-tab";
import { SavedTab, type SavedItemFilter } from "@/components/sources/saved-tab";
import { ResearchTab } from "@/components/sources/research-tab";
import IngestPage from "@/pages/ingest";
import {
  Compass,
  Bookmark,
  History,
  Lightbulb,
  Database,
  Search,
  PlusCircle,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type SourcesPrimaryView = "discover" | "saved" | "research" | "ideas" | "vault" | "references" | "ingest";

export default function SourcesPage() {
  const [location] = useLocation();
  const [activeView, setActiveView] = useState<SourcesPrimaryView>("discover");
  const [savedFilter, setSavedFilter] = useState<SavedItemFilter>("all");

  // Sync with location or query parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view");
    if (viewParam) {
      if (viewParam === "ideas") {
        setActiveView("saved");
        setSavedFilter("ideas");
        return;
      }
      if (viewParam === "vault") {
        setActiveView("saved");
        setSavedFilter("vault");
        return;
      }
      if (viewParam === "references") {
        setActiveView("saved");
        setSavedFilter("references");
        return;
      }
      if (["discover", "saved", "research", "ingest"].includes(viewParam)) {
        setActiveView(viewParam as SourcesPrimaryView);
        return;
      }
    }

    if (location.includes("ideas")) {
      setActiveView("saved");
      setSavedFilter("ideas");
    } else if (location.includes("vault")) {
      setActiveView("saved");
      setSavedFilter("vault");
    } else if (location.includes("references")) {
      setActiveView("saved");
      setSavedFilter("references");
    } else if (location.includes("ingest")) {
      setActiveView("ingest");
    } else if (location.includes("research")) {
      setActiveView("research");
    } else if (location.includes("saved")) {
      setActiveView("saved");
    }
  }, [location]);

  function handleTriggerQuickCapture() {
    const qcBtn = document.querySelector('[data-testid="button-quick-capture"]') as HTMLButtonElement | null;
    if (qcBtn) {
      qcBtn.click();
    }
  }

  return (
    <div className="flex flex-col min-h-full bg-background" data-testid="page-sources">
      {/* Canonical PageHeader */}
      <PageHeader
        title="Sources"
        description="Discover, investigate, save, and turn research into stories and content"
        testId="page-header-sources"
        titleTestId="text-page-title"
        action={
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-8"
            onClick={handleTriggerQuickCapture}
            data-testid="button-sources-quick-capture"
            aria-label="Quick capture"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Quick Capture
          </Button>
        }
      />

      {/* Sources Views Navigation Bar. One primary band above one subordinate band.
          The compatibility row is preserved — its consolidation is a deferred nav change. */}
      <div className="border-b bg-muted/30" data-testid="nav-sources-views">
        {/* Primary views: Discover / Saved / Research */}
        <div className="px-4 pt-2 flex items-center gap-1.5 overflow-x-auto">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1 shrink-0">
            View:
          </span>

          <button
            type="button"
            onClick={() => setActiveView("discover")}
            data-testid="tab-sources-view-discover"
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0",
              activeView === "discover"
                ? "bg-background text-foreground shadow-xs border"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            <Compass className="h-3.5 w-3.5 text-primary" />
            <span>Discover</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveView("saved");
              setSavedFilter("all");
            }}
            data-testid="tab-sources-view-saved"
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0",
              activeView === "saved"
                ? "bg-background text-foreground shadow-xs border"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            <Bookmark className="h-3.5 w-3.5 text-primary" />
            <span>Saved</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView("research")}
            data-testid="tab-sources-view-research"
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0",
              activeView === "research"
                ? "bg-background text-foreground shadow-xs border"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            <History className="h-3.5 w-3.5 text-primary" />
            <span>Research</span>
          </button>
        </div>

        {/* Secondary / compatibility views, subordinate to the primary band. Kept as-is
            for legacy tests & direct navigation; consolidating them is deferred. */}
        <div className="px-4 pb-2 pt-1 flex items-center gap-1 overflow-x-auto">
          <span className="text-xs font-medium text-muted-foreground/70 mr-1 shrink-0">
            More:
          </span>
          <button
            type="button"
            onClick={() => {
              setActiveView("saved");
              setSavedFilter("ideas");
            }}
            data-testid="tab-sources-view-ideas"
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
              activeView === "saved" && savedFilter === "ideas"
                ? "bg-background text-foreground shadow-xs border"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Lightbulb className="h-3 w-3" />
            <span>Ideas</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveView("saved");
              setSavedFilter("vault");
            }}
            data-testid="tab-sources-view-vault"
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
              activeView === "saved" && savedFilter === "vault"
                ? "bg-background text-foreground shadow-xs border"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Database className="h-3 w-3" />
            <span>Vault</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveView("saved");
              setSavedFilter("references");
            }}
            data-testid="tab-sources-view-references"
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
              activeView === "saved" && savedFilter === "references"
                ? "bg-background text-foreground shadow-xs border"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Search className="h-3 w-3" />
            <span>References</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView("ingest")}
            data-testid="tab-sources-view-ingest"
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
              activeView === "ingest"
                ? "bg-background text-foreground shadow-xs border"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Globe className="h-3 w-3" />
            <span>Ingest</span>
          </button>
        </div>
      </div>

      {/* Main View Body */}
      <div className="flex-1 overflow-auto">
        {activeView === "discover" && <DiscoverTab />}
        {activeView === "saved" && <SavedTab initialFilter={savedFilter} key={savedFilter} />}
        {activeView === "research" && <ResearchTab onSelectJob={() => setActiveView("discover")} />}
        {activeView === "ingest" && <IngestPage />}
      </div>
    </div>
  );
}
