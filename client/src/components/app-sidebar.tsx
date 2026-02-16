import { Sparkles, Calendar, Lightbulb, LayoutTemplate, BarChart3, Settings, FileText, Search, Compass, Zap, Globe } from "lucide-react";
import { useLocation, Link } from "wouter";
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

const createItems = [
  { title: "Generate", url: "/", icon: Sparkles },
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
                  <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase()}`}>
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

export function AppSidebar() {
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
      <SidebarFooter className="p-4">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium text-primary">
            KB
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium">Kishore Kumar</span>
            <span className="text-[10px] text-muted-foreground">Infra Engineering Lead</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
