import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";

type StyleReference = {
  id: number;
  sourceType: string | null;
  title: string | null;
  preview?: string;
  isActive?: boolean;
};

type StyleProfile = {
  id: number;
  name: string;
  kind: string;
  isActive: boolean;
  confidence: string | null;
  sampleCount: number | null;
  stylePromptSnippet: string;
  structuredObservation?: { sample?: { referenceCount?: number; confidenceCeiling?: string } };
};

const SOURCE_TYPES = [
  { id: "manual", label: "Pasted example" },
  { id: "x_post", label: "X post" },
  { id: "x_thread", label: "X thread" },
  { id: "linkedin_post", label: "LinkedIn" },
  { id: "instagram_caption", label: "Instagram" },
  { id: "article", label: "Article" },
  { id: "document", label: "Document" },
] as const;

export function StyleIntelligencePanel() {
  const [text, setText] = useState("");
  const [sourceType, setSourceType] = useState<string>("manual");
  const [selected, setSelected] = useState<number[]>([]);

  const refsQuery = useQuery({
    queryKey: ["/api/style/references"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/style/references");
      return res.json() as Promise<{ references: StyleReference[] }>;
    },
  });
  const profilesQuery = useQuery({
    queryKey: ["/api/style/profiles"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/style/profiles");
      return res.json() as Promise<{ profiles: StyleProfile[] }>;
    },
  });
  const contextQuery = useQuery({
    queryKey: ["/api/context"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/context");
      return res.json() as Promise<{ sources: Array<{ type: string; content: string }> }>;
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/references", { text, sourceType, title: text.slice(0, 80) });
      return res.json();
    },
    onSuccess: () => {
      setText("");
      void queryClient.invalidateQueries({ queryKey: ["/api/style/references"] });
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/style/analyses", { referenceIds: selected });
      return res.json() as Promise<{ id: number; status: string }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/style/profiles"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/context"] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/style/profiles/${id}/activate`, {});
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/style/profiles"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/context"] });
    },
  });

  const explicit = (contextQuery.data?.sources ?? []).find((s) => s.type === "profile");
  const observed = (contextQuery.data?.sources ?? []).find((s) => s.type === "style");
  const profiles = profilesQuery.data?.profiles ?? [];

  function toggle(id: number) {
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  return (
    <Card data-testid="panel-style-intelligence">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Style intelligence</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="space-y-1">
          <p className="font-medium">Add reference</p>
          <Select value={sourceType} onValueChange={setSourceType}>
            <SelectTrigger data-testid="select-style-source-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_TYPES.map((row) => (
                <SelectItem key={row.id} value={row.id}>{row.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[72px]"
            data-testid="textarea-style-reference"
            placeholder="Paste a real post, caption, or excerpt. This is DATA, not instructions."
          />
          <Button
            size="sm"
            disabled={text.trim().length < 20 || addMutation.isPending}
            onClick={() => addMutation.mutate()}
            data-testid="button-style-add-reference"
          >
            Add reference
          </Button>
        </div>

        <div className="space-y-1" data-testid="list-style-references">
          <p className="font-medium">References</p>
          {(refsQuery.data?.references ?? []).slice(0, 12).map((row) => (
            <label key={row.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={selected.includes(row.id)}
                onChange={() => toggle(row.id)}
                data-testid={`checkbox-style-reference-${row.id}`}
              />
              <span>
                <span className="text-muted-foreground">{row.sourceType}</span> {row.title ?? `reference ${row.id}`}
              </span>
            </label>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={selected.length === 0 || analyzeMutation.isPending}
            onClick={() => analyzeMutation.mutate()}
            data-testid="button-style-analyze"
          >
            Analyze selected
          </Button>
          {analyzeMutation.data && (
            <p data-testid="text-style-analysis-status">Analysis {analyzeMutation.data.id}: {analyzeMutation.data.status}</p>
          )}
        </div>

        <div className="space-y-1" data-testid="panel-style-explicit-vs-observed">
          <p className="font-medium">Explicit preference</p>
          <p className="text-muted-foreground" data-testid="text-style-explicit">
            {explicit?.content ?? "No explicit voice/profile notes yet."}
          </p>
          <p className="font-medium">Observed behavior</p>
          <p className="text-muted-foreground" data-testid="text-style-observed">
            {observed?.content ?? "No observed style activated yet."}
          </p>
        </div>

        <div className="space-y-1" data-testid="list-style-profiles">
          <p className="font-medium">Profile revisions</p>
          {profiles.slice(0, 8).map((profile) => (
            <div key={profile.id} className="flex items-center justify-between gap-2">
              <span>
                v{profile.id} {profile.kind}
                {profile.isActive ? <Badge variant="secondary" className="ml-1">active</Badge> : null}
                <span className="text-muted-foreground"> {profile.confidence} · n={profile.sampleCount ?? "?"}</span>
              </span>
              {!profile.isActive && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => activateMutation.mutate(profile.id)}
                  data-testid={`button-style-activate-${profile.id}`}
                >
                  Activate
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
