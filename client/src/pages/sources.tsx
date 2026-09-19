import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/ui-shared/page-header";
import { Button } from "@/components/ui/button";
import DiscoverPage from "@/pages/discover";
import IdeasPage from "@/pages/ideas";
import IngestPage from "@/pages/ingest";
import VaultPage from "@/pages/vault";
import ReferencesPage from "@/pages/references";
import { Compass, Lightbulb, Globe, Database, Search, PlusCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type SourcesView = "discover" | "ideas" | "ingest" | "vault" | "references";

const SOURCES_VIEWS: { id: SourcesView; name: string; icon: typeof Compass }[] = [
  { id: "discover", name: "Discover", icon: Compass },
  { id: "ideas", name: "Ideas Bank", icon: Lightbulb },
  { id: "ingest", name: "Ingest", icon: Globe },
  { id: "vault", name: "Context Vault", icon: Database },
  { id: "references", name: "References", icon: Search },
];

export default function SourcesPage() {
  const [location] = useLocation();
  const [activeView, setActiveView] = useState<SourcesView>("discover");

  // Sync with location or query params if visited like /sources/ideas or ?view=ideas
  useEffect(() => {
    for (const v of SOURCES_VIEWS) {
      if (location.includes(v.id)) {
        setActiveView(v.id);
        break;
      }
    }
  }, [location]);

  function handleTriggerQuickCapture() {
    // Dispatch click on the global quick capture button
    const qcBtn = document.querySelector('[data-testid="button-quick-capture"]') as HTMLButtonElement | null;
    if (qcBtn) {
      qcBtn.click();
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="page-sources">
      <PageHeader
        title="Sources"
        description="Discover, capture, organize, and research source material"
        testId="page-header-sources"
        titleTestId="text-page-title"
        action={
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-8"
            onClick={handleTriggerQuickCapture}
            data-testid="button-sources-quick-capture"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Quick Capture
          </Button>
        }
      />

      {/* Sub-views Bar */}
      <div className="border-b bg-muted/40 px-4 py-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar" data-testid="nav-sources-views">
        <span className="text-[11px] font-medium text-muted-foreground mr-1 shrink-0">View:</span>
        {SOURCES_VIEWS.map((view) => (
          <button
            key={view.id}
            onClick={() => setActiveView(view.id)}
            data-testid={`tab-sources-view-${view.id}`}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
              activeView === view.id
                ? "bg-background text-foreground shadow-xs border"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            <view.icon className="h-3.5 w-3.5" />
            <span>{view.name}</span>
          </button>
        ))}
      </div>

      {/* Sub-view Content */}
      <div className="flex-1 overflow-auto">
        {activeView === "discover" && <DiscoverPage />}
        {activeView === "ideas" && <IdeasPage />}
        {activeView === "ingest" && <IngestPage />}
        {activeView === "vault" && <VaultPage />}
        {activeView === "references" && <ReferencesPage />}
      </div>
    </div>
  );
}
