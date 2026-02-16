import { Sparkles, Calendar, Lightbulb, LayoutTemplate, BarChart3, Settings } from "lucide-react";
import { useLocation, Link } from "wouter";
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

const navItems = [
  { title: "Generate", url: "/", icon: Sparkles },
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "Ideas", url: "/ideas", icon: Lightbulb },
  { title: "Templates", url: "/templates", icon: LayoutTemplate },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();

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
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
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
