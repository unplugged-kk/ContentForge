import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/ui-shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type PublicProvider = {
  id: number;
  name: string;
  type: string;
  baseUrl: string;
  hasSecret: boolean;
  transport: string;
  detectedTransport: string | null;
  defaultModel: string;
  models: string[];
  enabled: boolean;
  isDefault: boolean;
  capabilities: Record<string, boolean>;
  lastHealthAt: string | null;
  lastHealthOk: boolean | null;
  lastHealthError: string | null;
};

type RouteRow = {
  id: number;
  purpose: string;
  providerId: number;
  model: string | null;
  allowFallback: boolean;
  fallbackProviderId: number | null;
};

const emptyForm = {
  name: "",
  type: "openai-compatible",
  baseUrl: "",
  apiKey: "",
  model: "",
  organization: "",
  project: "",
  transport: "auto",
};

export default function AiProvidersPage() {
  const [form, setForm] = useState(emptyForm);
  const [purpose, setPurpose] = useState("agent");
  const [allowFallback, setAllowFallback] = useState(false);
  const [fallbackId, setFallbackId] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const list = useQuery<{ providers: PublicProvider[]; routes: RouteRow[] }>({
    queryKey: ["/api/ai/providers"],
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/providers", {
        name: form.name,
        type: form.type,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey || undefined,
        model: form.model,
        organization: form.organization || undefined,
        project: form.project || undefined,
        transport: form.transport,
      });
      return res.json();
    },
    onSuccess: () => {
      setForm(emptyForm);
      setMessage(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ai/providers"] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const test = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/ai/providers/${id}/test`);
      return res.json() as Promise<{ ok: boolean; error: string | null; transport: string }>;
    },
    onSuccess: (result) => {
      setMessage(result.ok ? `Connection ok via ${result.transport}` : result.error);
      queryClient.invalidateQueries({ queryKey: ["/api/ai/providers"] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const toggle = useMutation({
    mutationFn: async (provider: PublicProvider) => {
      await apiRequest("PATCH", `/api/ai/providers/${provider.id}`, { enabled: !provider.enabled });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/ai/providers"] }),
  });

  const makeDefault = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/ai/providers/${id}/default`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/ai/providers"] }),
  });

  const remove = useMutation({
    mutationFn: async (provider: PublicProvider) => {
      const confirmName = window.prompt(`Type ${provider.name} to delete this provider`);
      if (confirmName == null) return;
      await apiRequest("DELETE", `/api/ai/providers/${provider.id}`, { confirmName });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/ai/providers"] }),
    onError: (error: Error) => setMessage(error.message),
  });

  const addRoute = useMutation({
    mutationFn: async (providerId: number) => {
      await apiRequest("POST", "/api/ai/routes", {
        purpose,
        providerId,
        allowFallback,
        fallbackProviderId: fallbackId ? Number(fallbackId) : null,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/ai/providers"] }),
    onError: (error: Error) => setMessage(error.message),
  });

  const providers = list.data?.providers ?? [];

  return (
    <div className="min-h-full bg-background flex flex-col" data-testid="page-ai-providers">
      <PageHeader
        title="Providers"
        description="Model endpoints used by the agent. Keys stay on the server."
        testId="page-header-providers"
        action={
          <Link href="/agent" className="text-sm underline" data-testid="link-back-agent">
            Back to Agent
          </Link>
        }
      />
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl">
        {message ? (
          <p className="text-sm" data-testid="text-provider-message">
            {message}
          </p>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add provider</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Label htmlFor="provider-name">Name</Label>
            <Input id="provider-name" data-testid="input-provider-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <Label htmlFor="provider-type">Type</Label>
            <Input id="provider-type" data-testid="input-provider-type" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} />
            <Label htmlFor="provider-base">Base URL</Label>
            <Input id="provider-base" data-testid="input-provider-base" placeholder="https://api.openai.com/v1" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
            <Label htmlFor="provider-key">API key</Label>
            <Input id="provider-key" data-testid="input-provider-key" type="password" autoComplete="off" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} />
            <Label htmlFor="provider-model">Model</Label>
            <Input id="provider-model" data-testid="input-provider-model" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
            <Label htmlFor="provider-org">Organization</Label>
            <Input id="provider-org" data-testid="input-provider-org" value={form.organization} onChange={(event) => setForm({ ...form, organization: event.target.value })} />
            <Label htmlFor="provider-project">Project</Label>
            <Input id="provider-project" data-testid="input-provider-project" value={form.project} onChange={(event) => setForm({ ...form, project: event.target.value })} />
            <Label htmlFor="provider-transport">Transport</Label>
            <select
              id="provider-transport"
              data-testid="select-provider-transport"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={form.transport}
              onChange={(event) => setForm({ ...form, transport: event.target.value })}
            >
              <option value="auto">Auto detect</option>
              <option value="chat_completions">Chat completions</option>
              <option value="responses">Responses</option>
            </select>
            <Button data-testid="button-provider-create" disabled={create.isPending || !form.name || !form.baseUrl || !form.model} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save provider"}
            </Button>
          </CardContent>
        </Card>

        {list.isLoading ? <p className="text-sm text-muted-foreground">Loading providers…</p> : null}
        {list.isError ? (
          <p className="text-sm" data-testid="text-provider-error">
            {(list.error as Error).message}
          </p>
        ) : null}
        {providers.map((provider) => (
          <Card key={provider.id} data-testid={`card-provider-${provider.id}`}>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {provider.name}
                {provider.isDefault ? <Badge>Default</Badge> : null}
                <Badge variant={provider.enabled ? "outline" : "destructive"}>{provider.enabled ? "Enabled" : "Disabled"}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p data-testid={`text-provider-url-${provider.id}`}>{provider.baseUrl}</p>
              <p>
                {provider.type} · model {provider.defaultModel} · transport {provider.detectedTransport ?? provider.transport}
              </p>
              <p>Secret stored: {provider.hasSecret ? "yes" : "no"}</p>
              <p>
                Health: {provider.lastHealthOk == null ? "not tested" : provider.lastHealthOk ? "ok" : "failed"}
                {provider.lastHealthAt ? ` · ${provider.lastHealthAt}` : ""}
              </p>
              {provider.lastHealthError ? <p data-testid={`text-provider-health-${provider.id}`}>{provider.lastHealthError}</p> : null}
              <p>
                Capabilities: chat {String(Boolean(provider.capabilities.chatCompletions))} · responses {String(Boolean(provider.capabilities.responses))} · tools {String(Boolean(provider.capabilities.tools))} · stream {String(Boolean(provider.capabilities.streaming))}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" data-testid={`button-provider-test-${provider.id}`} onClick={() => test.mutate(provider.id)}>
                  Test connection
                </Button>
                <Button size="sm" variant="outline" data-testid={`button-provider-toggle-${provider.id}`} onClick={() => toggle.mutate(provider)}>
                  {provider.enabled ? "Disable" : "Enable"}
                </Button>
                <Button size="sm" variant="outline" data-testid={`button-provider-default-${provider.id}`} onClick={() => makeDefault.mutate(provider.id)}>
                  Set default
                </Button>
                <Button size="sm" variant="outline" data-testid={`button-provider-delete-${provider.id}`} onClick={() => remove.mutate(provider)}>
                  Delete
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-2 pt-2">
                <div>
                  <Label htmlFor={`purpose-${provider.id}`}>Purpose</Label>
                  <Input id={`purpose-${provider.id}`} data-testid={`input-route-purpose-${provider.id}`} value={purpose} onChange={(event) => setPurpose(event.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={allowFallback} onChange={(event) => setAllowFallback(event.target.checked)} data-testid={`check-route-fallback-${provider.id}`} />
                  Allow fallback
                </label>
                <Input className="w-28" placeholder="Fallback id" value={fallbackId} onChange={(event) => setFallbackId(event.target.value)} data-testid={`input-route-fallback-${provider.id}`} />
                <Button size="sm" data-testid={`button-route-add-${provider.id}`} onClick={() => addRoute.mutate(provider.id)}>
                  Add route
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {(list.data?.routes ?? []).map((route) => (
          <p key={route.id} className="text-xs text-muted-foreground" data-testid={`text-route-${route.id}`}>
            {route.purpose} → provider {route.providerId}
            {route.model ? ` / ${route.model}` : ""}
            {route.allowFallback ? ` · fallback ${route.fallbackProviderId}` : " · no fallback"}
          </p>
        ))}
      </div>
    </div>
  );
}
