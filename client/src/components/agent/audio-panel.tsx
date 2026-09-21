import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { MediaProviderSelector } from "./media-provider-selector";

type AudioGenerationView = {
  id: number;
  status: string;
  providerId?: string | null;
  audioAssetId?: number | null;
  assets?: Array<{
    id: number;
    mime: string;
    byteSize?: number | null;
    durationMs?: number | null;
    sampleRate?: number | null;
    channels?: number | null;
  }>;
};

export function AudioPanel() {
  const [text, setText] = useState("ContentForge can now generate provider-neutral speech.");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState<string>();
  const [voiceId, setVoiceId] = useState<string>();
  const [generationId, setGenerationId] = useState<number | null>(null);

  const generationQuery = useQuery({
    queryKey: ["/api/audio/generations", generationId],
    enabled: generationId != null,
    refetchInterval: (query) => {
      const status = (query.state.data as AudioGenerationView | undefined)?.status;
      return status === "requested" || status === "generating" ? 1500 : false;
    },
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/audio/generations/${generationId}`);
      return response.json() as Promise<AudioGenerationView>;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const trimmed = text.trim();
      if (!trimmed) throw new Error("Enter narration text");
      if (!providerId) throw new Error("Choose a processing-ready audio provider");
      const response = await apiRequest("POST", "/api/audio/generations", {
        providerId,
        ...(modelId ? { model: modelId } : {}),
        intent: {
          subject: trimmed,
          text: trimmed,
          language: "en",
          ...(voiceId ? {
            voice: { providerId, providerVoiceId: voiceId, displayName: voiceId },
          } : {}),
        },
      });
      return response.json() as Promise<{ id: number }>;
    },
    onSuccess: (body) => {
      setGenerationId(body.id);
      void queryClient.invalidateQueries({ queryKey: ["/api/audio/generations", body.id] });
    },
  });

  const generation = generationQuery.data;
  const asset = generation?.assets?.[0];
  return (
    <Card data-testid="panel-audio">
      <CardHeader className="pb-2"><CardTitle className="text-sm">Audio production</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <MediaProviderSelector
          modality="audio"
          providerId={providerId}
          modelId={modelId}
          voiceId={voiceId}
          onProvider={setProviderId}
          onModel={setModelId}
          onVoice={setVoiceId}
        />
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          data-testid="input-audio-text"
          placeholder="Narration text"
        />
        <Button
          size="sm"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || !providerId}
          data-testid="button-audio-generate"
        >
          Create audio
        </Button>
        {generation ? (
          <div className="space-y-1 text-xs" data-testid="card-audio-generation">
            <p>AudioGeneration {generation.id} · {generation.status}</p>
            <Badge variant="secondary">{generation.providerId ?? "provider"}</Badge>
            {asset ? (
              <p className="text-muted-foreground" data-testid={`card-audio-asset-${asset.id}`}>
                AudioAsset {asset.id} · {asset.mime}
                {asset.durationMs ? ` · ${asset.durationMs}ms` : ""}
                {asset.sampleRate ? ` · ${asset.sampleRate}Hz` : ""}
                {asset.channels ? ` · ${asset.channels}ch` : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
