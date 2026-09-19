import { Link } from "wouter";
import { PageHeader } from "@/components/ui-shared/page-header";
import GeneratePage from "@/pages/generate";
import { Sparkles, Zap, LayoutGrid, Image, FileText, LayoutTemplate, CaseSensitive, Quote, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

const CREATE_MODES = [
  { name: "Post & Thread", path: "/create", icon: Sparkles, active: true },
  { name: "Hooks", path: "/hooks", icon: Zap, active: false },
  { name: "Carousel", path: "/carousel", icon: LayoutGrid, active: false },
  { name: "Images", path: "/images", icon: Image, active: false },
  { name: "Articles", path: "/articles", icon: FileText, active: false },
  { name: "Templates", path: "/templates", icon: LayoutTemplate, active: false },
  { name: "Formatter", path: "/formatter", icon: CaseSensitive, active: false },
  { name: "Canned Responses", path: "/canned-responses", icon: Quote, active: false },
  { name: "Chat → Post", path: "/chat", icon: MessageSquare, active: false },
];

export default function CreatePage() {
  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="page-create">
      <PageHeader
        title="Create"
        description="Create content from a story, source, or direct idea"
        testId="page-header-create"
        titleTestId="text-page-title"
      />

      {/* Creation Modes Bar */}
      <div className="border-b bg-muted/40 px-4 py-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar" data-testid="nav-create-modes">
        <span className="text-[11px] font-medium text-muted-foreground mr-1 shrink-0">Mode:</span>
        {CREATE_MODES.map((mode) => (
          <Link
            key={mode.name}
            href={mode.path}
            data-testid={`link-create-mode-${mode.name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-")}`}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
              mode.active
                ? "bg-background text-foreground shadow-xs border"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            <mode.icon className="h-3.5 w-3.5" />
            <span>{mode.name}</span>
          </Link>
        ))}
      </div>

      {/* Default Creation Canvas (Post & Thread) */}
      <div className="flex-1 overflow-hidden">
        <GeneratePage hideHeader={true} />
      </div>
    </div>
  );
}
