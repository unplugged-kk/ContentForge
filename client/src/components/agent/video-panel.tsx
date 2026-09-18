import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";

type GenerationView = {
  id: number;
  status: string;
  providerId?: string | null;
  visualAssetId?: number | null;
  assets?: Array<{ id: number; durationMs?: number | null; width?: number | null; height?: number | null; status?: string }>;
};

type RepurposeView = {
  id: number;
  status: string;
  clipCount?: number;
  providerId?: string | null;
  assetIds?: Array<number | null>;
  outputs?: Array<{ position: number; status: string; visualAssetId?: number | null; title?: string | null }>;
};

export function VideoPanel({
  generationId,
  onGeneration,
}: {
  generationId?: number | null;
  onGeneration?: (id: number) => void;
}) {
  const [subject, setSubject] = useState("Short explainer");
  const [activeId, setActiveId] = useState<number | null>(generationId ?? null);
  const [repurposeId, setRepurposeId] = useState<number | null>(null);

  useEffect(() => {
    if (generationId && generationId > 0) setActiveId(generationId);
  }, [generationId]);

  const generationQuery = useQuery({
    queryKey: ["/api/video-generations", activeId],
    enabled: activeId != null,
    refetchInterval: (query) => {
      const status = (query.state.data as GenerationView | undefined)?.status;
      if (status === "requested" || status === "generating") return 1500;
      return false;
    },
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/video-generations/${activeId}`);
      return res.json() as Promise<GenerationView>;
    },
  });

  const repurposeQuery = useQuery({
    queryKey: ["/api/video/repurposing", repurposeId],
    enabled: repurposeId != null,
    refetchInterval: (query) => {
      const status = (query.state.data as RepurposeView | undefined)?.status;
      if (status === "requested" || status === "accepted" || status === "queued" || status === "processing") return 1500;
      return false;
    },
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/video/repurposing/${repurposeId}`);
      return res.json() as Promise<RepurposeView>;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const trimmed = subject.trim();
      if (!trimmed) throw new Error("Enter a subject");
      const res = await apiRequest("POST", "/api/video-generations", {
        kind: "video",
        providerId: "local-video-fixture",
        intent: { subject: trimmed, title: trimmed, aspectRatio: "9:16" },
        durationMs: 3000,
      });
      return res.json() as Promise<{ id: number; status: string }>;
    },
    onSuccess: (body) => {
      setActiveId(body.id);
      onGeneration?.(body.id);
      void queryClient.invalidateQueries({ queryKey: ["/api/video-generations", body.id] });
    },
  });

  const clipMutation = useMutation({
    mutationFn: async (sourceVisualAssetId: number) => {
      const res = await apiRequest("POST", "/api/video/repurposing", {
        sourceVisualAssetId,
        clipCount: 3,
        providerId: "local-video-repurpose-fixture",
      });
      return res.json() as Promise<{ id: number }>;
    },
    onSuccess: (body) => {
      setRepurposeId(body.id);
      void queryClient.invalidateQueries({ queryKey: ["/api/video/repurposing", body.id] });
    },
  });

  const generation = generationQuery.data;
  const asset = generation?.assets?.[0];
  const clips = repurposeQuery.data?.outputs ?? [];

  return (
    <Card data-testid="panel-video">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Video production</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Video subject"
          data-testid="input-video-subject"
        />
        <Button
          size="sm"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          data-testid="button-video-generate"
        >
          Create video
        </Button>
        {generation ? (
          <div className="space-y-1" data-testid="card-video-generation">
            <p className="text-xs" data-testid="text-video-progress">
              Generation {generation.id} · {generation.status}
            </p>
            <Badge variant="secondary">{generation.providerId ?? "provider"}</Badge>
            {asset ? (
              <div className="text-xs text-muted-foreground" data-testid={`card-video-asset-${asset.id}`}>
                VideoAsset {asset.id}
                {asset.durationMs != null ? ` · ${asset.durationMs}ms` : ""}
                {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
              </div>
            ) : null}
            {generation.visualAssetId ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => clipMutation.mutate(generation.visualAssetId!)}
                disabled={clipMutation.isPending}
                data-testid="button-video-repurpose"
              >
                Make 3 clips
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Identity and status only — binaries stay in storage.</p>
        )}
        {repurposeQuery.data ? (
          <div className="space-y-1" data-testid="card-video-repurposing">
            <p className="text-xs" data-testid="text-video-repurpose-status">
              Job {repurposeQuery.data.id} · {repurposeQuery.data.status}
            </p>
            <p className="text-xs text-muted-foreground" data-testid="text-video-repurpose-source">
              Source VideoAsset {generation?.visualAssetId ?? "—"}
            </p>
            <p className="text-xs text-muted-foreground" data-testid="text-video-repurpose-clip-count">
              Clips {clips.filter((clip) => clip.status === "ready").length}/{repurposeQuery.data.clipCount ?? clips.length}
            </p>
            {clips.map((clip) => (
              <div
                key={`${clip.position}-${clip.visualAssetId ?? "pending"}`}
                className="text-xs text-muted-foreground"
                data-testid={`card-clip-${clip.visualAssetId ?? clip.position}`}
              >
                Clip {clip.position + 1}: {clip.status}
                {clip.visualAssetId ? ` → VideoAsset ${clip.visualAssetId}` : ""}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
