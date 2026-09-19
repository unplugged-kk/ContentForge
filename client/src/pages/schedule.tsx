import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/ui-shared/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import QueuePage from "@/pages/queue";
import CalendarPage from "@/pages/calendar";
import { ListChecks, Calendar as CalendarIcon } from "lucide-react";

export default function SchedulePage() {
  const [location] = useLocation();
  const [activeTab, setActiveTab] = useState<"queue" | "calendar">("queue");

  // Sync with search or subroute if present
  useEffect(() => {
    if (location.includes("calendar")) {
      setActiveTab("calendar");
    } else if (location.includes("queue")) {
      setActiveTab("queue");
    }
  }, [location]);

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="page-schedule">
      <PageHeader
        title="Schedule"
        description="Plan, queue, and monitor scheduled publications"
        testId="page-header-schedule"
        titleTestId="text-page-title"
        action={
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "queue" | "calendar")} className="w-auto">
            <TabsList className="h-8" data-testid="tabs-schedule-views">
              <TabsTrigger value="queue" className="text-xs gap-1.5 px-3 h-7" data-testid="tab-trigger-queue">
                <ListChecks className="h-3.5 w-3.5" />
                Queue
              </TabsTrigger>
              <TabsTrigger value="calendar" className="text-xs gap-1.5 px-3 h-7" data-testid="tab-trigger-calendar">
                <CalendarIcon className="h-3.5 w-3.5" />
                Calendar
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <div className="flex-1 overflow-hidden">
        {activeTab === "queue" ? (
          <QueuePage hideHeader={true} />
        ) : (
          <CalendarPage hideHeader={true} />
        )}
      </div>
    </div>
  );
}
