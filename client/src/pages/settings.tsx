import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings as SettingsIcon, Cpu, Zap, Globe } from "lucide-react";
import { SiX, SiThreads } from "react-icons/si";
import { CONTENT_PILLARS } from "@/lib/constants";

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <h1 className="text-lg font-semibold" data-testid="text-settings-title">Settings</h1>
        <p className="text-xs text-muted-foreground">Configure your ContentForge workspace</p>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="ai">
          <TabsList>
            <TabsTrigger value="ai" data-testid="tab-ai-providers">
              <Cpu className="h-3.5 w-3.5 mr-1.5" />
              AI Provider
            </TabsTrigger>
            <TabsTrigger value="accounts" data-testid="tab-accounts">
              <Globe className="h-3.5 w-3.5 mr-1.5" />
              Connected Accounts
            </TabsTrigger>
            <TabsTrigger value="pillars" data-testid="tab-pillars-settings">
              <Zap className="h-3.5 w-3.5 mr-1.5" />
              Content Pillars
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ai" className="mt-4 space-y-4">
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">Active AI Provider</h3>
                  <p className="text-xs text-muted-foreground">Powered by Replit AI Integrations (OpenAI-compatible)</p>
                </div>
                <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Connected</Badge>
              </div>
              <div className="bg-muted/50 rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Provider</span>
                  <span className="text-xs font-medium">OpenAI (via Replit)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Model</span>
                  <span className="text-xs font-medium">gpt-4o-mini</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Status</span>
                  <span className="text-xs font-medium text-green-500">Active</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                ContentForge uses Replit's built-in AI integration. No API key required. Usage is billed to your Replit credits.
              </p>
            </Card>
          </TabsContent>

          <TabsContent value="accounts" className="mt-4 space-y-4">
            <Card className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-foreground/5 flex items-center justify-center">
                    <SiX className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium">X (Twitter)</h3>
                    <p className="text-xs text-muted-foreground">Connect to publish directly to X</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" disabled data-testid="button-connect-x">
                  Connect
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-3">
                OAuth integration requires X Developer API credentials. Configure in a future update.
              </p>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-foreground/5 flex items-center justify-center">
                    <SiThreads className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium">Threads</h3>
                    <p className="text-xs text-muted-foreground">Connect to publish directly to Threads</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" disabled data-testid="button-connect-threads">
                  Connect
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-3">
                Meta Threads API integration. Requires app review. Configure in a future update.
              </p>
            </Card>
          </TabsContent>

          <TabsContent value="pillars" className="mt-4 space-y-3">
            {CONTENT_PILLARS.map((pillar) => (
              <Card key={pillar.id} className="p-3">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: pillar.color }} />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium">{pillar.name}</h3>
                    <p className="text-xs text-muted-foreground">{pillar.description}</p>
                  </div>
                </div>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
