import { Switch, Route } from "wouter";
import { queryClient, getQueryFn } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import NotFound from "@/pages/not-found";
import GeneratePage from "@/pages/generate";
import CalendarPage from "@/pages/calendar";
import IdeasPage from "@/pages/ideas";
import TemplatesPage from "@/pages/templates";
import AnalyticsPage from "@/pages/analytics";
import SettingsPage from "@/pages/settings";
import ArticlesPage from "@/pages/articles";
import ReferencesPage from "@/pages/references";
import DiscoverPage from "@/pages/discover";
import IngestPage from "@/pages/ingest";
import ImageGenPage from "@/pages/imagegen";
import AuthPage from "@/pages/auth";
import VaultPage from "@/pages/vault";
import HooksPage from "@/pages/hooks";
import CarouselPage from "@/pages/carousel";
import ChatPage from "@/pages/chat";
import YoutubePage from "@/pages/youtube";
import FormatterPage from "@/pages/formatter";
import CannedResponsesPage from "@/pages/canned-responses";
import QueuePage from "@/pages/queue";
import AiUsagePage from "@/pages/ai-usage";
import { QuickCapture } from "@/components/quick-capture";

function Router() {
  return (
    <Switch>
      <Route path="/" component={GeneratePage} />
      <Route path="/calendar" component={CalendarPage} />
      <Route path="/ideas" component={IdeasPage} />
      <Route path="/templates" component={TemplatesPage} />
      <Route path="/analytics" component={AnalyticsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/articles" component={ArticlesPage} />
      <Route path="/references" component={ReferencesPage} />
      <Route path="/discover" component={DiscoverPage} />
      <Route path="/ingest" component={IngestPage} />
      <Route path="/images" component={ImageGenPage} />
      <Route path="/vault" component={VaultPage} />
      <Route path="/hooks" component={HooksPage} />
      <Route path="/carousel" component={CarouselPage} />
      <Route path="/chat" component={ChatPage} />
      <Route path="/youtube" component={YoutubePage} />
      <Route path="/formatter" component={FormatterPage} />
      <Route path="/canned-responses" component={CannedResponsesPage} />
      <Route path="/queue" component={QueuePage} />
      <Route path="/ai-usage" component={AiUsagePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

const sidebarStyle = {
  "--sidebar-width": "15rem",
  "--sidebar-width-icon": "3rem",
};

function AppShell() {
  // Use returnNull so a 401 gives data=null (not an error state) → shows AuthPage cleanly
  const { data: user, isLoading } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar user={user as any} />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 px-2 py-1.5 border-b bg-background sticky top-0 z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-hidden">
            <Router />
          </main>
          <QuickCapture />
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AppShell />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
