import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/ui-shared/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AnalyticsPage from "@/pages/analytics";
import AiUsagePage from "@/pages/ai-usage";
import { BarChart3, Bot } from "lucide-react";

export default function InsightsPage() {
  const [location] = useLocation();
  const [activeTab, setActiveTab] = useState<"analytics" | "ai-usage">("analytics");

  // Sync with search or subroute if present
  useEffect(() => {
    if (location.includes("ai-usage")) {
      setActiveTab("ai-usage");
    } else if (location.includes("analytics")) {
      setActiveTab("analytics");
    }
  }, [location]);

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="page-insights">
      <PageHeader
        title="Insights"
        description="Performance analytics, content signals, and AI usage"
        testId="page-header-insights"
        titleTestId="text-page-title"
        action={
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "analytics" | "ai-usage")} className="w-auto">
            <TabsList className="h-8" data-testid="tabs-insights-views">
              <TabsTrigger value="analytics" className="text-xs gap-1.5 px-3 h-7" data-testid="tab-trigger-analytics">
                <BarChart3 className="h-3.5 w-3.5" />
                Analytics
              </TabsTrigger>
              <TabsTrigger value="ai-usage" className="text-xs gap-1.5 px-3 h-7" data-testid="tab-trigger-ai-usage">
                <Bot className="h-3.5 w-3.5" />
                AI Usage & Cost
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <div className="flex-1 overflow-hidden">
        {activeTab === "analytics" ? (
          <AnalyticsPage hideHeader={true} />
        ) : (
          <AiUsagePage hideHeader={true} />
        )}
      </div>
    </div>
  );
}
