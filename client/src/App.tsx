import { lazy, Suspense, useEffect, useRef } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth";
import { QuickCapture } from "@/components/quick-capture";
import { AnnouncerProvider } from "@/components/ui-shared/announcer";

/**
 * Route-level code splitting.
 *
 * The shell, the auth gate and the 404 stay eager: they are needed to paint
 * anything at all, and the pre-auth path must not wait on a second request. The
 * seven canonical destinations (plus the one legacy destination with a live
 * mount) load on navigation, so `/today` stops paying for the editor, the
 * charts and the ingest pipeline before it can render a row.
 *
 * `NotFound` and `AuthPage` stay synchronous on purpose: a redirect or a 404
 * that flashes a skeleton before resolving reads as a broken route.
 */
const TodayPage = lazy(() => import("@/pages/today"));
const CreatePage = lazy(() => import("@/pages/create"));
const SourcesPage = lazy(() => import("@/pages/sources"));
const AgentWorkspacePage = lazy(() => import("@/pages/agent"));
const SchedulePage = lazy(() => import("@/pages/schedule"));
const InsightsPage = lazy(() => import("@/pages/insights"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const YoutubePage = lazy(() => import("@/pages/youtube"));

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

/**
 * The single Suspense fallback for the whole route tree.
 *
 * The page frame — nav, header, theme, capture — is already painted and does not
 * suspend, so this only has to hold the shape of the region that is arriving.
 * It draws that shape with the shared `Skeleton` rather than a centred spinner:
 * spinners are for actions, not for page loads, and a skeleton is what survives
 * `prefers-reduced-motion` as a still, legible "content is coming" signal.
 */
function RouteFallback() {
  return (
    <div className="p-4 sm:p-6 space-y-4" data-testid="route-loading" aria-busy="true">
      <Skeleton className="h-7 w-48" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function Router() {
  const [location] = useLocation();
  const isInitialRender = useRef(true);

  useEffect(() => {
    document.title = `ContentForge — ${getRouteTitle(location)}`;

    // A full document load already starts focus at the top of the page: only
    // client-side navigation needs the move.
    if (isInitialRender.current) {
      isInitialRender.current = false;
      return;
    }

    // A modal owns focus while it is open: Radix traps focus inside it, hides
    // the rest of the document from assistive tech and restores focus to the
    // trigger on close. Moving focus out from under it is a focus escape, so
    // the route change hands off to the overlay instead.
    const openOverlay = document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
    );
    const active = document.activeElement as HTMLElement | null;
    if (openOverlay || active?.closest('[role="dialog"], [role="alertdialog"]')) return;

    // Focus lands on the `main` landmark rather than the route heading: the
    // heading belongs to a lazily-loaded route chunk and does not exist yet at
    // the moment the URL changes. Without this move a screen-reader user stays
    // on the nav link they clicked and is never told the screen changed.
    document.getElementById("main-content")?.focus();
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

/**
 * The shell's height (G1(e)).
 *
 * `100vh` on iOS Safari is the *large* viewport height: the last ~60–90px of the
 * shell sat behind the collapsing toolbar and could not be scrolled into view,
 * because the scroll range itself was short by that amount. `dvh` tracks the
 * visible viewport.
 *
 * `h-screen` is kept as the fallback, but it has to be upgraded through
 * `@supports`: Tailwind emits `.h-screen` *after* `.h-dvh` in the stylesheet, so
 * writing `h-screen h-dvh` on one element silently keeps `100vh` (measured —
 * `.h-dvh{height:100dvh}` is emitted before `.h-screen{height:100vh}` in the
 * built CSS). The `@supports` variant is emitted last and therefore wins only
 * where `dvh` is understood.
 */
const SHELL_HEIGHT = "h-screen [@supports(height:100dvh)]:h-dvh";

function AppShell() {
  // Use returnNull so a 401 gives data=null (not an error state) → shows AuthPage cleanly
  const { data: user, isLoading } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className={`flex ${SHELL_HEIGHT} items-center justify-center`}>
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
      {/*
        `h-dvh` with `h-screen` kept ahead of it as the fallback: on iOS Safari
        100vh is the *large* viewport height, so the shell's last ~60–90px sat
        behind the collapsing toolbar with no way to scroll it into view.
      */}
      <div className={`flex ${SHELL_HEIGHT} w-full`}>
        <nav aria-label="Primary">
          <AppSidebar user={user as any} />
        </nav>
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 px-2 py-1.5 border-b bg-background sticky top-0 z-50">
            <SidebarTrigger
              data-testid="button-sidebar-toggle"
              className="[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            />
            <ThemeToggle />
          </header>
          {/*
            `tabIndex={-1}` makes the landmark programmatically focusable, which
            is what the route-change focus move targets (see `Router`). It does
            not enter the tab order.
          */}
          <main id="main-content" tabIndex={-1} className="flex-1 overflow-hidden">
            <Suspense fallback={<RouteFallback />}>
              <Router />
            </Suspense>
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
