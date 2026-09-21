import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StatusBadge } from "@/components/ui-shared/status-badge";
import { ErrorState } from "@/components/ui-shared/error-state";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  resolveContentTypes,
  resolveFormatForOpportunity,
  type ContentType,
  type CapabilityFormat,
} from "@/lib/create-workflow";
import {
  Sparkles,
  Layers,
  ChevronDown,
  BookOpen,
  Lightbulb,
  Globe,
  PenTool,
  Loader2,
  AlertCircle,
  Check,
} from "lucide-react";
import { SiX, SiLinkedin, SiInstagram, SiYoutube, SiThreads } from "react-icons/si";

export interface CreateStudioProps {
  onGenerationComplete: (artifactId: number) => void;
  initialType?: ContentType;
  initialStoryId?: number;
  initialIdeaId?: number;
}

type StartWithSource = "story" | "idea" | "source" | "blank";

interface StoryItem {
  id: number;
  title: string;
  insightBody: string;
  provenance: string;
  angles?: string[];
}

interface IdeaItem {
  id: number;
  title: string;
  notes: string | null;
  pillarId: number | null;
}

interface VoiceItem {
  id: number;
  name: string;
  tone: string | null;
  description: string | null;
}

interface TemplateItem {
  id: number;
  name: string;
  description: string | null;
  supportedFormats?: string[];
}

function ChannelIcon({ channel }: { channel: string }) {
  switch (channel.toLowerCase()) {
    case "x":
      return <SiX className="h-3.5 w-3.5" />;
    case "linkedin":
      return <SiLinkedin className="h-3.5 w-3.5 text-[#0A66C2]" />;
    case "instagram":
      return <SiInstagram className="h-3.5 w-3.5 text-[#E4405F]" />;
    case "youtube":
      return <SiYoutube className="h-3.5 w-3.5 text-[#FF0000]" />;
    case "threads":
      return <SiThreads className="h-3.5 w-3.5" />;
    default:
      return <Layers className="h-3.5 w-3.5" />;
  }
}

export function CreateStudio({
  onGenerationComplete,
  initialType = "post",
  initialStoryId,
  initialIdeaId,
}: CreateStudioProps) {
  const { toast } = useToast();

  // Queries
  const capabilitiesQuery = useQuery<{ formats: CapabilityFormat[] }>({
    queryKey: ["/api/repurposing/capabilities"],
  });

  const channelsQuery = useQuery<{ channels: string[] }>({
    queryKey: ["/api/channels"],
  });

  const storiesQuery = useQuery<StoryItem[]>({
    queryKey: ["/api/stories"],
  });

  const ideasQuery = useQuery<IdeaItem[]>({
    queryKey: ["/api/ideas"],
  });

  const voicesQuery = useQuery<VoiceItem[]>({
    queryKey: ["/api/voices"],
  });

  const templatesQuery = useQuery<TemplateItem[]>({
    queryKey: ["/api/templates"],
  });

  // State
  const [contentType, setContentType] = useState<ContentType>(initialType);
  const [startWith, setStartWith] = useState<StartWithSource>(
    initialStoryId ? "story" : initialIdeaId ? "idea" : "blank",
  );

  const [selectedStoryId, setSelectedStoryId] = useState<number | null>(initialStoryId ?? null);
  const [selectedIdeaId, setSelectedIdeaId] = useState<number | null>(initialIdeaId ?? null);
  const [selectedVoiceId, setSelectedVoiceId] = useState<number | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);

  const [channel, setChannel] = useState<string>("x");
  const [concept, setConcept] = useState<string>("");
  const [objective, setObjective] = useState<string>("Educate and share a concrete insight");
  const [audience, setAudience] = useState<string>("Platform & software engineers");
  const [angle, setAngle] = useState<string>("");
  const [constraints, setConstraints] = useState<string>("");
  const [model, setModel] = useState<string>("");

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Available types from capabilities
  const contentTypes = resolveContentTypes(
    capabilitiesQuery.data?.formats,
    channelsQuery.data?.channels,
  );
  const activeTypeDesc = contentTypes.find((t) => t.type === contentType) || contentTypes[0];

  // Update default channel when content type changes
  useEffect(() => {
    if (activeTypeDesc && !activeTypeDesc.supportedChannels.includes(channel)) {
      setChannel(activeTypeDesc.defaultChannel);
    }
  }, [contentType, activeTypeDesc]);

  // When story selected, prefill concept/objective/audience
  const handleSelectStory = (story: StoryItem) => {
    setSelectedStoryId(story.id);
    setConcept(story.insightBody || story.title);
    if (story.angles && story.angles.length > 0) {
      setAngle(story.angles[0]);
    }
  };

  // When idea selected, prefill concept
  const handleSelectIdea = (idea: IdeaItem) => {
    setSelectedIdeaId(idea.id);
    setConcept(idea.title + (idea.notes ? `\n\nNotes: ${idea.notes}` : ""));
  };

  // Generation Mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      setIsGenerating(true);
      setGenerationError(null);

      const targetFormat = resolveFormatForOpportunity(contentType, channel);

      let storyId = selectedStoryId;

      // If no pre-existing story selected, create a human story row
      if (!storyId) {
        const storyRes = await apiRequest("POST", "/api/stories", {
          title: concept.trim().slice(0, 100) || "Direct content concept",
          insightBody: concept.trim() || "Direct generation concept",
          provenance: "human",
          status: "ready",
          angles: angle ? [angle] : [],
        });
        const createdStory = await storyRes.json();
        storyId = createdStory.id;
      }

      // Step 2: Create Opportunity from Story
      const oppRes = await apiRequest("POST", "/api/opportunities", {
        storyId,
        format: targetFormat,
        channel,
        concept: concept.trim() || "Content generation",
        objective: objective.trim() || "Engage audience",
        ...(audience ? { audience: audience.trim() } : {}),
        ...(angle ? { angle: angle.trim() } : {}),
        proposer: "human",
      });
      const opportunity = await oppRes.json();

      // Step 3: Create GenerationJob
      const jobRes = await apiRequest("POST", "/api/generation-jobs", {
        opportunityId: opportunity.id,
        ...(selectedVoiceId ? { voiceId: selectedVoiceId } : {}),
        ...(selectedTemplateId ? { templateId: selectedTemplateId } : {}),
        ...(model ? { model } : {}),
        ...(constraints ? { constraints: { userInstructions: constraints } } : {}),
      });
      const job = await jobRes.json();

      // Step 4: Execute immediately via run endpoint
      const runRes = await apiRequest("POST", `/api/generation-jobs/${job.id}/run`, {});
      const runResult = await runRes.json();

      if (runResult.status === "failed") {
        throw new Error(runResult.failureMessage || "Generation did not complete successfully.");
      }

      let artifactId = runResult.artifactId;
      if (!artifactId) {
        // Fallback check on opportunity artifacts
        const artifactsRes = await apiRequest("GET", `/api/opportunities/${opportunity.id}/artifacts`);
        const artifacts = await artifactsRes.json();
        if (artifacts.length > 0) {
          artifactId = artifacts[artifacts.length - 1].id;
        }
      }

      if (!artifactId) {
        throw new Error("Generation succeeded but no artifact was produced.");
      }

      return artifactId as number;
    },
    onSuccess: (artifactId) => {
      setIsGenerating(false);
      toast({ title: "Generated successfully", description: "Content ready for review." });
      onGenerationComplete(artifactId);
    },
    onError: (err: any) => {
      setIsGenerating(false);
      const msg = err.message || "Failed to generate content. Please try again.";
      setGenerationError(msg);
      toast({ title: "Generation failed", description: msg, variant: "destructive" });
    },
  });

  const selectedVoice = voicesQuery.data?.find((v) => v.id === selectedVoiceId);

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 md:p-6 max-w-5xl mx-auto gap-6" data-testid="create-studio-container">
      {/* 1. What are you creating? (Content Type Selector) */}
      <div className="space-y-2.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
          What are you creating?
        </label>
        <div className="flex flex-wrap gap-2" data-testid="group-content-types">
          {contentTypes.map((item) => {
            const isSelected = contentType === item.type;
            return (
              <Button
                key={item.type}
                type="button"
                size="sm"
                variant={isSelected ? "default" : "outline"}
                className={`h-8 text-xs font-medium gap-1.5 transition-all ${
                  isSelected ? "shadow-xs" : "text-muted-foreground"
                }`}
                onClick={() => setContentType(item.type)}
                data-testid={`button-type-${item.type}`}
              >
                {item.label}
              </Button>
            );
          })}
        </div>

        {/* Notice for unsupported types like Audio */}
        {!activeTypeDesc.supported && (
          <div
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2 mt-2"
            data-testid="banner-type-unsupported"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">{activeTypeDesc.label} Capability Notice</p>
              <p className="mt-0.5">{activeTypeDesc.unsupportedReason}</p>
            </div>
          </div>
        )}
      </div>

      {/* 2. Start With (Entry Points) */}
      <div className="space-y-2.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
          Start with:
        </label>
        <div className="flex flex-wrap gap-2" data-testid="group-start-with">
          {[
            { id: "story", label: "Story", icon: BookOpen },
            { id: "idea", label: "Idea", icon: Lightbulb },
            { id: "source", label: "Source", icon: Globe },
            { id: "blank", label: "Blank canvas", icon: PenTool },
          ].map((entry) => {
            const isSelected = startWith === entry.id;
            return (
              <Button
                key={entry.id}
                type="button"
                size="sm"
                variant={isSelected ? "secondary" : "outline"}
                className={`h-8 text-xs font-medium gap-1.5 ${
                  isSelected ? "border-foreground/30 shadow-2xs font-semibold" : "text-muted-foreground"
                }`}
                onClick={() => setStartWith(entry.id as StartWithSource)}
                data-testid={`button-start-with-${entry.id}`}
              >
                <entry.icon className="h-3.5 w-3.5" />
                {entry.label}
              </Button>
            );
          })}
        </div>

        {/* Context Picker Drawer based on startWith */}
        {startWith === "story" && (
          <Card className="p-3 bg-muted/20 border-dashed space-y-2" data-testid="card-picker-story">
            <span className="text-xs font-medium text-muted-foreground">Select an existing Story:</span>
            {storiesQuery.data && storiesQuery.data.length > 0 ? (
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {storiesQuery.data.map((story) => (
                  <div
                    key={story.id}
                    onClick={() => handleSelectStory(story)}
                    className={`p-2 rounded-md border text-xs cursor-pointer transition-colors ${
                      selectedStoryId === story.id
                        ? "bg-primary/10 border-primary font-medium"
                        : "bg-background hover:bg-muted/50"
                    }`}
                    data-testid={`item-story-${story.id}`}
                  >
                    <p className="font-semibold text-foreground">{story.title}</p>
                    <p className="text-muted-foreground line-clamp-1 mt-0.5">{story.insightBody}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic py-2">
                No research stories yet. Type a topic below to author a direct story.
              </p>
            )}
          </Card>
        )}

        {startWith === "idea" && (
          <Card className="p-3 bg-muted/20 border-dashed space-y-2" data-testid="card-picker-idea">
            <span className="text-xs font-medium text-muted-foreground">Select from your Ideas Bank:</span>
            {ideasQuery.data && ideasQuery.data.length > 0 ? (
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {ideasQuery.data.map((idea) => (
                  <div
                    key={idea.id}
                    onClick={() => handleSelectIdea(idea)}
                    className={`p-2 rounded-md border text-xs cursor-pointer transition-colors ${
                      selectedIdeaId === idea.id
                        ? "bg-primary/10 border-primary font-medium"
                        : "bg-background hover:bg-muted/50"
                    }`}
                    data-testid={`item-idea-${idea.id}`}
                  >
                    <p className="font-semibold text-foreground">{idea.title}</p>
                    {idea.notes && <p className="text-muted-foreground line-clamp-1 mt-0.5">{idea.notes}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic py-2">
                Ideas Bank is empty. You can write your idea directly below.
              </p>
            )}
          </Card>
        )}
      </div>

      <hr className="border-border" />

      {/* 3. Content Setup Form */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Content Setup</h3>

        {/* Channel selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="select-channel">
            Target Channel
          </label>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger id="select-channel" className="w-full md:w-72" data-testid="select-channel">
              <SelectValue placeholder="Select channel" />
            </SelectTrigger>
            <SelectContent>
              {activeTypeDesc.supportedChannels.map((ch) => (
                <SelectItem key={ch} value={ch} data-testid={`option-channel-${ch}`}>
                  <div className="flex items-center gap-2 capitalize">
                    <ChannelIcon channel={ch} />
                    <span>{ch}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Concept / Topic */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="input-concept">
            Topic or Concept
          </label>
          <Textarea
            id="input-concept"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder="What is this content about? (e.g. Lessons learned from migrating Postgres schemas in production)"
            rows={3}
            className="text-sm leading-relaxed"
            data-testid="input-create-concept"
          />
        </div>

        {/* Objective & Audience (2-col on desktop) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="input-objective">
              Objective
            </label>
            <Input
              id="input-objective"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="e.g. Educate and explain trade-off"
              className="text-xs h-9"
              data-testid="input-create-objective"
            />
            <div className="flex flex-wrap gap-1 mt-1">
              {["Educate & explain", "Spark discussion", "Share breakdown", "Actionable tips"].map((p) => (
                <button
                  type="button"
                  key={p}
                  className="text-[10px] text-muted-foreground hover:text-foreground bg-muted/50 px-1.5 py-0.5 rounded"
                  onClick={() => setObjective(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="input-audience">
              Audience
            </label>
            <Input
              id="input-audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="e.g. Senior engineers & tech founders"
              className="text-xs h-9"
              data-testid="input-create-audience"
            />
            <div className="flex flex-wrap gap-1 mt-1">
              {["Software engineers", "Tech leaders & founders", "DevOps practitioners"].map((p) => (
                <button
                  type="button"
                  key={p}
                  className="text-[10px] text-muted-foreground hover:text-foreground bg-muted/50 px-1.5 py-0.5 rounded"
                  onClick={() => setAudience(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Voice & Template (2-col on desktop) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="select-voice">
              Brand Voice
            </label>
            <Select
              value={selectedVoiceId ? String(selectedVoiceId) : "none"}
              onValueChange={(val) => setSelectedVoiceId(val === "none" ? null : Number(val))}
            >
              <SelectTrigger id="select-voice" data-testid="select-voice">
                <SelectValue placeholder="Default brand voice" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Default voice</SelectItem>
                {voicesQuery.data?.map((voice) => (
                  <SelectItem key={voice.id} value={String(voice.id)} data-testid={`option-voice-${voice.id}`}>
                    {voice.name} {voice.tone ? `(${voice.tone})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="select-template">
              Content Template
            </label>
            <Select
              value={selectedTemplateId ? String(selectedTemplateId) : "none"}
              onValueChange={(val) => setSelectedTemplateId(val === "none" ? null : Number(val))}
            >
              <SelectTrigger id="select-template" data-testid="select-template">
                <SelectValue placeholder="None / Free-form" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None / Free-form</SelectItem>
                {templatesQuery.data?.map((tmpl) => (
                  <SelectItem key={tmpl.id} value={String(tmpl.id)} data-testid={`option-template-${tmpl.id}`}>
                    {tmpl.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 4. Progressive Disclosure: Advanced Options */}
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="border rounded-md p-3">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-between p-0 h-auto font-medium text-xs text-muted-foreground hover:text-foreground"
              data-testid="button-toggle-advanced"
            >
              <span>Advanced options (Model, hook framing, constraints)</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="input-angle">
                Specific Hook or Framing Angle
              </label>
              <Input
                id="input-angle"
                value={angle}
                onChange={(e) => setAngle(e.target.value)}
                placeholder="e.g. Why conventional wisdom fails when scaling past 100k requests"
                className="text-xs h-8"
                data-testid="input-create-angle"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="input-constraints">
                Style & Constraint Instructions
              </label>
              <Input
                id="input-constraints"
                value={constraints}
                onChange={(e) => setConstraints(e.target.value)}
                placeholder="e.g. Keep sentences short, avoid buzzwords, include code snippet if possible"
                className="text-xs h-8"
                data-testid="input-create-constraints"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="input-model">
                AI Model Preference
              </label>
              <Input
                id="input-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Default (system configured)"
                className="text-xs h-8"
                data-testid="input-create-model"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* 5. Generation Summary Box */}
      <Card className="p-4 bg-muted/30 border-muted" data-testid="card-generation-summary">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Generation Summary
        </h4>
        <div className="text-xs space-y-1 text-foreground">
          <p>
            <span className="text-muted-foreground">Target: </span>
            <span className="font-medium capitalize">{channel}</span> · {activeTypeDesc.label}
          </p>
          <p>
            <span className="text-muted-foreground">Source: </span>
            <span className="font-medium">
              {selectedStoryId ? `Story #${selectedStoryId}` : selectedIdeaId ? `Idea #${selectedIdeaId}` : "Direct draft"}
            </span>
          </p>
          {selectedVoice && (
            <p>
              <span className="text-muted-foreground">Voice: </span>
              <span className="font-medium">{selectedVoice.name}</span>
            </p>
          )}
          <p>
            <span className="text-muted-foreground">Goal: </span>
            <span className="font-medium">{objective}</span>
          </p>
        </div>
      </Card>

      {/* Generation Error Display */}
      {generationError && (
        <ErrorState
          title="Couldn't generate this content"
          description={generationError}
          onRetry={() => generateMutation.mutate()}
        />
      )}

      {/* Primary Action Button */}
      <div className="pt-2 pb-6">
        <Button
          className="w-full md:w-auto px-8 gap-2"
          size="lg"
          onClick={() => generateMutation.mutate()}
          disabled={isGenerating || !activeTypeDesc.supported || !concept.trim()}
          data-testid="button-generate-content"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating content…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Generate Content
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
