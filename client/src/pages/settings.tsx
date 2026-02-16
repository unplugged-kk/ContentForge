import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Cpu, Zap, Globe, Loader2, Trash2, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { SiX, SiThreads } from "react-icons/si";
import { CONTENT_PILLARS } from "@/lib/constants";
import type { ConnectedAccount } from "@shared/schema";

export default function SettingsPage() {
  const { toast } = useToast();
  const [connectDialog, setConnectDialog] = useState<{ platform: string; label: string } | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [username, setUsername] = useState("");

  const { data: accounts = [], isLoading: accountsLoading } = useQuery<ConnectedAccount[]>({ queryKey: ["/api/accounts"] });

  const xAccount = accounts.find((a) => a.platform === "x");
  const threadsAccount = accounts.find((a) => a.platform === "threads");

  const connectMutation = useMutation({
    mutationFn: async ({ platform, username, accessToken }: { platform: string; username: string; accessToken: string }) => {
      const res = await apiRequest("POST", "/api/accounts/connect", { platform, username, accessToken });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setConnectDialog(null);
      setAccessToken("");
      setUsername("");
      const warning = data.warning;
      toast({
        title: warning ? "Account saved with warning" : "Account connected!",
        description: warning || `Connected as @${data.username}`,
        variant: warning ? "default" : "default",
      });
    },
    onError: (err: any) => {
      toast({ title: "Connection failed", description: String(err?.message || err), variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Account disconnected" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/accounts/${id}/test`, {});
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "Connection verified!", description: data.username ? `Authenticated as @${data.username}` : data.note });
      } else {
        toast({ title: "Connection issue", description: data.error, variant: "destructive" });
      }
    },
  });

  function AccountCard({
    platform,
    label,
    description,
    icon: Icon,
    account,
    helpUrl,
    helpText,
  }: {
    platform: string;
    label: string;
    description: string;
    icon: any;
    account: ConnectedAccount | undefined;
    helpUrl: string;
    helpText: string;
  }) {
    return (
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-foreground/5 flex items-center justify-center">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-medium">{label}</h3>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {account ? (
              <>
                <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
                </Badge>
              </>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={() => setConnectDialog({ platform, label })}
                data-testid={`button-connect-${platform}`}
              >
                Connect
              </Button>
            )}
          </div>
        </div>

        {account && (
          <div className="bg-muted/50 rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Username</span>
              <span className="text-xs font-medium">@{account.username}</span>
            </div>
            {account.displayName && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Display Name</span>
                <span className="text-xs font-medium">{account.displayName}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Token</span>
              <span className="text-xs font-medium font-mono">{account.accessToken || "Not set"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Status</span>
              <span className="text-xs font-medium text-green-500">{account.isActive ? "Active" : "Inactive"}</span>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => testMutation.mutate(account.id)}
                disabled={testMutation.isPending}
                data-testid={`button-test-${platform}`}
              >
                {testMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                Test Connection
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConnectDialog({ platform, label })}
                data-testid={`button-reconnect-${platform}`}
              >
                Update Token
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => disconnectMutation.mutate(account.id)}
                disabled={disconnectMutation.isPending}
                data-testid={`button-disconnect-${platform}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {!account && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-muted/30">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-[11px] text-muted-foreground">{helpText}</p>
              <a href={helpUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary flex items-center gap-1 mt-1" data-testid={`link-help-${platform}`}>
                <ExternalLink className="h-3 w-3" /> Get API credentials
              </a>
            </div>
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <h1 className="text-lg font-semibold" data-testid="text-settings-title">Settings</h1>
        <p className="text-xs text-muted-foreground">Configure your ContentForge workspace</p>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="accounts">
          <TabsList>
            <TabsTrigger value="accounts" data-testid="tab-accounts">
              <Globe className="h-3.5 w-3.5 mr-1.5" />
              Connected Accounts
            </TabsTrigger>
            <TabsTrigger value="ai" data-testid="tab-ai-providers">
              <Cpu className="h-3.5 w-3.5 mr-1.5" />
              AI Provider
            </TabsTrigger>
            <TabsTrigger value="pillars" data-testid="tab-pillars-settings">
              <Zap className="h-3.5 w-3.5 mr-1.5" />
              Content Pillars
            </TabsTrigger>
          </TabsList>

          <TabsContent value="accounts" className="mt-4 space-y-4">
            {accountsLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <>
                <AccountCard
                  platform="x"
                  label="X (Twitter)"
                  description="Connect to publish directly to X"
                  icon={SiX}
                  account={xAccount}
                  helpUrl="https://developer.x.com/en/portal/dashboard"
                  helpText="You need a Bearer Token from the X Developer Portal. Create a project and app, then generate a Bearer Token under 'Keys and tokens'."
                />
                <AccountCard
                  platform="threads"
                  label="Threads"
                  description="Connect to publish directly to Threads"
                  icon={SiThreads}
                  account={threadsAccount}
                  helpUrl="https://developers.facebook.com/docs/threads/"
                  helpText="You need an access token from Meta's Threads API. Create a Meta app, add the Threads product, and generate a long-lived access token."
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="ai" className="mt-4 space-y-4">
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
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

      <Dialog open={!!connectDialog} onOpenChange={(open) => { if (!open) { setConnectDialog(null); setAccessToken(""); setUsername(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect {connectDialog?.label}</DialogTitle>
            <DialogDescription>
              Enter your API credentials to connect your {connectDialog?.label} account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Username</label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={connectDialog?.platform === "x" ? "@yourusername" : "Your username"}
                data-testid="input-connect-username"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {connectDialog?.platform === "x" ? "Bearer Token" : "Access Token"}
              </label>
              <Input
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Paste your token here"
                type="password"
                data-testid="input-connect-token"
              />
              <p className="text-[10px] text-muted-foreground">
                {connectDialog?.platform === "x"
                  ? "Get this from the X Developer Portal: developer.x.com > Your App > Keys and Tokens > Bearer Token"
                  : "Get this from Meta Developer Portal: developers.facebook.com > Your App > Threads > Access Token"}
              </p>
            </div>
            <Button
              onClick={() => {
                if (connectDialog) {
                  connectMutation.mutate({ platform: connectDialog.platform, username: username.replace(/^@/, ""), accessToken });
                }
              }}
              disabled={!accessToken || connectMutation.isPending}
              className="w-full"
              data-testid="button-confirm-connect"
            >
              {connectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Connect Account
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
