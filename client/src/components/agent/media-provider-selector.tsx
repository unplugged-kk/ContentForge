import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";

export type MediaProviderView = {
  id: string;
  configured: boolean;
  reachable: boolean;
  capable: boolean;
  processing_ready: boolean;
  reason: string | null;
  models: Array<{ id: string; displayName?: string }>;
  voices: Array<{ providerVoiceId: string; displayName: string; locale?: string }>;
};

export function MediaProviderSelector({
  modality,
  providerId,
  modelId,
  voiceId,
  onProvider,
  onModel,
  onVoice,
}: {
  modality: "video" | "audio";
  providerId: string;
  modelId?: string;
  voiceId?: string;
  onProvider: (id: string) => void;
  onModel?: (id: string) => void;
  onVoice?: (id: string) => void;
}) {
  const query = useQuery({
    queryKey: ["/api/media/providers", modality],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/media/providers?modality=${modality}`);
      return response.json() as Promise<{ providers: MediaProviderView[] }>;
    },
  });
  const providers = (query.data?.providers ?? []).filter((provider) =>
    provider.configured && provider.capable && provider.processing_ready,
  );
  const selected = providers.find((provider) => provider.id === providerId) ?? providers[0];

  useEffect(() => {
    if (!providerId && selected) onProvider(selected.id);
  }, [onProvider, providerId, selected]);

  useEffect(() => {
    if (selected && modelId == null && selected.models[0] && onModel) onModel(selected.models[0].id);
  }, [modelId, onModel, selected]);

  useEffect(() => {
    if (selected && voiceId == null && selected.voices[0] && onVoice) onVoice(selected.voices[0].providerVoiceId);
  }, [onVoice, selected, voiceId]);

  if (providers.length === 0) {
    return <p className="text-xs text-muted-foreground" data-testid={`text-${modality}-provider-unavailable`}>No processing-ready {modality} provider.</p>;
  }

  return (
    <div className="grid gap-2">
      <Select value={selected?.id ?? ""} onValueChange={onProvider}>
        <SelectTrigger data-testid={`select-${modality}-provider`}>
          <SelectValue placeholder="Provider" />
        </SelectTrigger>
        <SelectContent>
          {providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.id}</SelectItem>)}
        </SelectContent>
      </Select>
      {selected && selected.models.length > 0 && onModel ? (
        <Select value={modelId ?? selected.models[0]?.id ?? ""} onValueChange={onModel}>
          <SelectTrigger data-testid={`select-${modality}-model`}><SelectValue placeholder="Model" /></SelectTrigger>
          <SelectContent>
            {selected.models.map((model) => (
              <SelectItem key={model.id} value={model.id}>{model.displayName ?? model.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {selected && selected.voices.length > 0 && onVoice ? (
        <Select value={voiceId ?? selected.voices[0]?.providerVoiceId ?? ""} onValueChange={onVoice}>
          <SelectTrigger data-testid={`select-${modality}-voice`}><SelectValue placeholder="Voice" /></SelectTrigger>
          <SelectContent>
            {selected.voices.map((voice) => (
              <SelectItem key={voice.providerVoiceId} value={voice.providerVoiceId}>
                {voice.displayName}{voice.locale ? ` · ${voice.locale}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
