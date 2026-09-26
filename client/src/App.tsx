import { useEffect } from "react";
import { Switch, Route, useLocation, useSearch, Redirect } from "wouter";
import { queryClient, getQueryFn } from "./lib/queryClient";
import { getLegacyRouteTarget } from "./lib/legacy-route-mapping";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import NotFound from "@/pages/not-found";
import TodayPage from "@/pages/today";
import CreatePage from "@/pages/create";
import SourcesPage from "@/pages/sources";
import SchedulePage from "@/pages/schedule";
import InsightsPage from "@/pages/insights";
import SettingsPage from "@/pages/settings";
import AuthPage from "@/pages/auth";
import YoutubePage from "@/pages/youtube";
import AgentWorkspacePage from "@/pages/agent";
import { QuickCapture } from "@/components/quick-capture";
import { AnnouncerProvider } from "@/components/ui-shared/announcer";

const CANONICAL_TITLES: Record<string, string> = {
  "/today": "Today",
  "/create": "Create",
  "/sources": "Sources",
  "/agent": "Agent",
  "/schedule": "Schedule",
  "/insights": "Insights",
  "/settings": "Settings",
};

const LEGACY_TITLES: Record<string, string> = {
  "/generate": "Generate",
  "/calendar": "Calendar",
  "/ideas": "Ideas",
  "/templates": "Templates",
  "/analytics": "Analytics",
  "/articles": "Articles",
  "/references": "References",
  "/discover": "Discover",
  "/ingest": "Ingest",
  "/images": "Images",
  "/vault": "Vault",
  "/hooks": "Hooks",
  "/carousel": "Carousel",
  "/chat": "Chat",
  "/youtube": "YouTube",
  "/formatter": "Formatter",
  "/canned-responses": "Canned Responses",
  "/queue": "Queue",
  "/ai-usage": "AI Usage",
};

function getRouteTitle(path: string): string {
  if (path === "/") return "Today";
  if (CANONICAL_TITLES[path]) return CANONICAL_TITLES[path];
  if (LEGACY_TITLES[path]) return LEGACY_TITLES[path];
  if (path.startsWith("/create")) return "Create";
  if (path.startsWith("/sources")) return "Sources";
  if (path.startsWith("/schedule")) return "Schedule";
  if (path.startsWith("/insights")) return "Insights";
  if (path.startsWith("/settings")) return "Settings";
  if (path.startsWith("/agent")) return "Agent";
  if (path.startsWith("/today")) return "Today";
  return "Not Found";
}

function LegacyRouteRedirect({ legacyPath }: { legacyPath: string }) {
  const search = useSearch();
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  const target = getLegacyRouteTarget(legacyPath, search, hash);
  return target ? <Redirect to={target} /> : <NotFound />;
}

function Router() {
  const [location] = useLocation();
  useEffect(() => {
    document.title = `ContentForge — ${getRouteTitle(location)}`;
  }, [location]);

  return (
    <Switch>
      {/* Canonical Routes */}
      <Route path="/" component={() => <Redirect to="/today" />} />
      <Route path="/today" component={TodayPage} />
      <Route path="/create" component={CreatePage} />
      <Route path="/sources" component={SourcesPage} />
      <Route path="/agent" component={AgentWorkspacePage} />
      <Route path="/schedule" component={SchedulePage} />
      <Route path="/insights" component={InsightsPage} />
      <Route path="/settings" component={SettingsPage} />

      {/* Legacy routes: preserve bookmarks and query state at the canonical destination. */}
      <Route path="/generate" component={() => <LegacyRouteRedirect legacyPath="/generate" />} />
      <Route path="/calendar" component={() => <LegacyRouteRedirect legacyPath="/calendar" />} />
      <Route path="/ideas" component={() => <LegacyRouteRedirect legacyPath="/ideas" />} />
      <Route path="/templates" component={() => <LegacyRouteRedirect legacyPath="/templates" />} />
      <Route path="/analytics" component={() => <LegacyRouteRedirect legacyPath="/analytics" />} />
      <Route path="/articles" component={() => <LegacyRouteRedirect legacyPath="/articles" />} />
      <Route path="/references" component={() => <LegacyRouteRedirect legacyPath="/references" />} />
      <Route path="/discover" component={() => <LegacyRouteRedirect legacyPath="/discover" />} />
      <Route path="/ingest" component={() => <LegacyRouteRedirect legacyPath="/ingest" />} />
      <Route path="/images" component={() => <LegacyRouteRedirect legacyPath="/images" />} />
      <Route path="/vault" component={() => <LegacyRouteRedirect legacyPath="/vault" />} />
      <Route path="/hooks" component={() => <LegacyRouteRedirect legacyPath="/hooks" />} />
      <Route path="/carousel" component={() => <LegacyRouteRedirect legacyPath="/carousel" />} />
      <Route path="/chat" component={() => <LegacyRouteRedirect legacyPath="/chat" />} />
      <Route path="/youtube" component={YoutubePage} />
      <Route path="/formatter" component={() => <LegacyRouteRedirect legacyPath="/formatter" />} />
      <Route path="/canned-responses" component={() => <LegacyRouteRedirect legacyPath="/canned-responses" />} />
      <Route path="/queue" component={() => <LegacyRouteRedirect legacyPath="/queue" />} />
      <Route path="/ai-usage" component={() => <LegacyRouteRedirect legacyPath="/ai-usage" />} />
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
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <div className="flex h-screen w-full">
        <nav aria-label="Primary">
          <AppSidebar user={user as any} />
        </nav>
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 px-2 py-1.5 border-b bg-background sticky top-0 z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main id="main-content" className="flex-1 overflow-hidden">
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
          <AnnouncerProvider>
            <AppShell />
            <Toaster />
          </AnnouncerProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
