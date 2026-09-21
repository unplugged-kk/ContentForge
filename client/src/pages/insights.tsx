import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { PageHeader } from "@/components/ui-shared/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import AnalyticsPage from "@/pages/analytics";
import AiUsagePage from "@/pages/ai-usage";
import { LearningView } from "@/components/insights/learning-view";
import { resolveInsightsTab } from "@/lib/insights-state";
import { BarChart3, Sparkles, Bot } from "lucide-react";

export type InsightsView = "performance" | "learning" | "ai-usage";

export default function InsightsPage() {
  const [location] = useLocation();
  const searchString = useSearch();
  const [activeTab, setActiveTab] = useState<InsightsView>("performance");

  // Sync with search param or legacy location
  useEffect(() => {
    const params = new URLSearchParams(searchString || window.location.search);
    const viewParam = params.get("view");
    if (viewParam) {
      setActiveTab(resolveInsightsTab(viewParam));
    } else if (location.includes("ai-usage")) {
      setActiveTab("ai-usage");
    } else if (location.includes("learning")) {
      setActiveTab("learning");
    } else if (location.includes("analytics")) {
      setActiveTab("performance");
    }
  }, [location, searchString]);

  const handleTabChange = (val: string) => {
    const nextTab = resolveInsightsTab(val);
    setActiveTab(nextTab);
    const params = new URLSearchParams(window.location.search);
    params.set("view", nextTab);
    const newRelativePathQuery = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", newRelativePathQuery);
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="flex flex-col h-full overflow-hidden"
      data-testid="page-insights"
    >
      <PageHeader
        title="Insights"
        description="Performance analytics, observed learning patterns, and AI usage"
        testId="page-header-insights"
        titleTestId="text-page-title"
        action={
          <TabsList className="h-8" data-testid="tabs-insights-views">
            <TabsTrigger
              value="performance"
              className="text-xs gap-1.5 px-3 h-7"
              data-testid="tab-trigger-performance"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span data-testid="tab-trigger-analytics">Performance</span>
            </TabsTrigger>
            <TabsTrigger
              value="learning"
              className="text-xs gap-1.5 px-3 h-7"
              data-testid="tab-trigger-learning"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Learning
            </TabsTrigger>
            <TabsTrigger
              value="ai-usage"
              className="text-xs gap-1.5 px-3 h-7"
              data-testid="tab-trigger-ai-usage"
            >
              <Bot className="h-3.5 w-3.5" />
              AI Usage & Cost
            </TabsTrigger>
          </TabsList>
        }
      />

      <div className="flex-1 overflow-hidden">
        <TabsContent
          value="performance"
          className="h-full m-0 p-0 overflow-hidden data-[state=inactive]:hidden"
        >
          <AnalyticsPage hideHeader={true} />
        </TabsContent>
        <TabsContent
          value="learning"
          className="h-full m-0 p-6 overflow-y-auto data-[state=inactive]:hidden"
        >
          <LearningView />
        </TabsContent>
        <TabsContent
          value="ai-usage"
          className="h-full m-0 p-0 overflow-hidden data-[state=inactive]:hidden"
        >
          <AiUsagePage hideHeader={true} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
