import { useState, useEffect } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { PageHeader } from "@/components/ui-shared/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import QueuePage from "@/pages/queue";
import CalendarPage from "@/pages/calendar";
import { PublicationsView } from "@/components/schedule/publications-view";
import { ListChecks, Calendar as CalendarIcon, Send, Sparkles } from "lucide-react";

export default function SchedulePage() {
  const [location] = useLocation();
  const search = useSearch();
  const [activeTab, setActiveTab] = useState<"queue" | "calendar" | "publications">("queue");

  // Sync with ?tab= (e.g. Today's "View" links) or a legacy subroute if present.
  useEffect(() => {
    const tab = new URLSearchParams(search).get("tab");
    if (tab === "publications" || tab === "calendar" || tab === "queue") {
      setActiveTab(tab);
    } else if (location.includes("calendar")) {
      setActiveTab("calendar");
    } else if (location.includes("queue")) {
      setActiveTab("queue");
    }
  }, [location, search]);

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="page-schedule">
      <PageHeader
        title="Schedule"
        description="Plan, queue, and monitor scheduled publications"
        testId="page-header-schedule"
        titleTestId="text-page-title"
        action={
          <Button asChild size="sm" className="gap-1.5" data-testid="button-schedule-create">
            <Link href="/create">
              <Sparkles className="h-3.5 w-3.5" />
              Create content
            </Link>
          </Button>
        }
      />

      {/* View switching belongs to the page body; the header slot holds the
          surface's primary action (J1). The strip scrolls rather than overflowing
          at 390px, mirroring settings.tsx. Each view is a real `TabsContent`
          panel (mirroring insights.tsx) so every trigger's `aria-controls`
          resolves to an existing region instead of dangling (axe
          aria-valid-attr-value). Radix renders only the active panel, exactly as
          the previous conditional rendering did. */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "queue" | "calendar" | "publications")}
        className="flex flex-col flex-1 min-h-0 overflow-hidden"
      >
        <div className="px-4 pt-3" data-testid="schedule-view-switcher">
          <TabsList
            className="flex h-8 w-full max-w-full justify-start gap-1 overflow-x-auto no-scrollbar"
            data-testid="tabs-schedule-views"
          >
            <TabsTrigger value="queue" className="text-xs gap-1.5 px-3 h-7" data-testid="tab-trigger-queue">
              <ListChecks className="h-3.5 w-3.5" />
              Queue
            </TabsTrigger>
            <TabsTrigger value="calendar" className="text-xs gap-1.5 px-3 h-7" data-testid="tab-trigger-calendar">
              <CalendarIcon className="h-3.5 w-3.5" />
              Calendar
            </TabsTrigger>
            <TabsTrigger value="publications" className="text-xs gap-1.5 px-3 h-7" data-testid="tab-trigger-publications">
              <Send className="h-3.5 w-3.5" />
              Publications
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden">
          <TabsContent
            value="queue"
            className="h-full m-0 p-0 overflow-hidden data-[state=inactive]:hidden"
          >
            <QueuePage hideHeader={true} />
          </TabsContent>
          <TabsContent
            value="calendar"
            className="h-full m-0 p-0 overflow-hidden data-[state=inactive]:hidden"
          >
            <CalendarPage hideHeader={true} />
          </TabsContent>
          <TabsContent
            value="publications"
            className="h-full m-0 p-0 overflow-hidden data-[state=inactive]:hidden"
          >
            <div className="h-full overflow-y-auto" data-testid="container-publications">
              <PublicationsView />
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
