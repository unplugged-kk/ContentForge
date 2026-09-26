import { CalendarCheck, Sparkles, Database, Bot, Calendar, BarChart3, Settings, LogOut } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export interface NavItem {
  title: string;
  url: string;
  icon: typeof CalendarCheck;
}

export const CANONICAL_NAV_ITEMS: NavItem[] = [
  { title: "Today", url: "/today", icon: CalendarCheck },
  { title: "Create", url: "/create", icon: Sparkles },
  { title: "Sources", url: "/sources", icon: Database },
  { title: "Agent", url: "/agent", icon: Bot },
  { title: "Schedule", url: "/schedule", icon: Calendar },
  { title: "Insights", url: "/insights", icon: BarChart3 },
  { title: "Settings", url: "/settings", icon: Settings },
];

/**
 * Route-aware active navigation helper.
 * Activates canonical destinations for exact, nested, and compatibility routes.
 */
export function isRouteActive(itemUrl: string, currentPath: string): boolean {
  if (itemUrl === "/today") {
    return currentPath === "/" || currentPath === "/today" || currentPath.startsWith("/today/");
  }
  if (itemUrl === "/create") {
    if (currentPath === "/create" || currentPath.startsWith("/create/")) return true;
    const legacyCreateRoutes = [
      "/generate",
      "/formatter",
      "/hooks",
      "/carousel",
      "/images",
      "/articles",
      "/templates",
      "/canned-responses",
      "/chat",
    ];
    return legacyCreateRoutes.some((route) => currentPath === route || currentPath.startsWith(route + "/"));
  }
  if (itemUrl === "/sources") {
    if (currentPath === "/sources" || currentPath.startsWith("/sources/")) return true;
    const legacySourcesRoutes = [
      "/ingest",
      "/discover",
      "/ideas",
      "/vault",
      "/references",
      "/youtube",
    ];
    return legacySourcesRoutes.some((route) => currentPath === route || currentPath.startsWith(route + "/"));
  }
  if (itemUrl === "/agent") {
    return currentPath === "/agent" || currentPath.startsWith("/agent/");
  }
  if (itemUrl === "/schedule") {
    if (currentPath === "/schedule" || currentPath.startsWith("/schedule/")) return true;
    const legacyScheduleRoutes = ["/queue", "/calendar"];
    return legacyScheduleRoutes.some((route) => currentPath === route || currentPath.startsWith(route + "/"));
  }
  if (itemUrl === "/insights") {
    if (currentPath === "/insights" || currentPath.startsWith("/insights/")) return true;
    const legacyInsightsRoutes = ["/analytics", "/ai-usage"];
    return legacyInsightsRoutes.some((route) => currentPath === route || currentPath.startsWith(route + "/"));
  }
  if (itemUrl === "/settings") {
    return currentPath === "/settings" || currentPath.startsWith("/settings/");
  }
  return false;
}

interface SidebarUser {
  id: number;
  name: string;
  email: string;
  title?: string;
  avatar?: string;
}

export function AppSidebar({ user }: { user?: SidebarUser }) {
  const [location] = useLocation();
  const { toast } = useToast();

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout", {});
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.clear();
    },
    onError: () => {
      toast({ title: "Logout failed", variant: "destructive" });
    },
  });

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "KK";

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/today" className="flex items-center gap-2" data-testid="link-app-home">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary shrink-0">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold tracking-tight truncate" data-testid="text-app-title">
              ContentForge
            </span>
            <span className="text-xs text-muted-foreground leading-none truncate">
              Content Operating System
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {CANONICAL_NAV_ITEMS.map((item) => {
                const isActive = isRouteActive(item.url, location);
                const testId = `link-nav-${item.title.toLowerCase()}`;
                return (
                  <SidebarMenuItem key={item.title}>
                    {/*
                      G1(c): on a coarse pointer the row is raised from the
                      desktop-dense 32px to the 44px floor. Deliberately bounded
                      to the shell's highest-traffic controls — this is not a
                      tap-target sweep of the chrome.
                    */}
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      className="[@media(pointer:coarse)]:h-11"
                    >
                      <Link
                        href={item.url}
                        data-testid={testId}
                        aria-label={item.title}
                        aria-current={isActive ? "page" : undefined}
                      >
                        <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3 border-t">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary shrink-0 overflow-hidden">
            {user?.avatar ? (
              <img src={user.avatar} alt={user.name} className="h-8 w-8 rounded-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-xs font-medium truncate" data-testid="text-user-name">
              {user?.name || "Kishore Kumar"}
            </span>
            <span className="text-xs text-muted-foreground truncate" data-testid="text-user-title">
              {user?.title || "Infra Engineering Lead"}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            data-testid="button-logout"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
