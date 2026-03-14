import { Sparkles, Calendar, Lightbulb, LayoutTemplate, BarChart3, Settings, FileText, Search, Compass, Zap, Globe, Image, LogOut, User } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const createItems = [
  { title: "Generate", url: "/", icon: Sparkles },
  { title: "AI Images", url: "/images", icon: Image },
  { title: "Articles", url: "/articles", icon: FileText },
  { title: "Templates", url: "/templates", icon: LayoutTemplate },
];

const discoverItems = [
  { title: "Ingest", url: "/ingest", icon: Globe },
  { title: "Discover", url: "/discover", icon: Compass },
  { title: "References", url: "/references", icon: Search },
  { title: "Ideas", url: "/ideas", icon: Lightbulb },
];

const manageItems = [
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Settings", url: "/settings", icon: Settings },
];

function NavGroup({ label, items }: { label: string; items: typeof createItems }) {
  const [location] = useLocation();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive = item.url === "/"
              ? location === "/"
              : location.startsWith(item.url);
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild isActive={isActive}>
                  <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(" ", "-")}`}>
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

interface SidebarUser {
  id: number;
  name: string;
  email: string;
  title?: string;
  avatar?: string;
}

export function AppSidebar({ user }: { user?: SidebarUser }) {
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
    ? user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "KK";

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight" data-testid="text-app-title">ContentForge</span>
            <span className="text-[10px] text-muted-foreground leading-none">Content Creation Hub</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Create" items={createItems} />
        <NavGroup label="Discover" items={discoverItems} />
        <NavGroup label="Manage" items={manageItems} />
      </SidebarContent>
      <SidebarFooter className="p-3 border-t">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
            {user?.avatar
              ? <img src={user.avatar} alt={user.name} className="h-8 w-8 rounded-full object-cover" />
              : initials}
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-xs font-medium truncate" data-testid="text-user-name">{user?.name || "Kishore Kumar"}</span>
            <span className="text-[10px] text-muted-foreground truncate" data-testid="text-user-title">{user?.title || "Infra Engineering Lead"}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            data-testid="button-logout"
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
