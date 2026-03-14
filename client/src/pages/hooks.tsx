import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Zap, Copy, Loader2, TrendingUp, RefreshCw, ArrowRight } from "lucide-react";
import { CONTENT_PILLARS } from "@/lib/constants";

interface Hook {
  text: string;
  type: string;
  viralScore: number;
  why: string;
}

const HOOK_TYPES = [
  "Contrarian/Hot take",
  "Stat-based",
  "Story opener",
  "Question hook",
  "List hook",
  "Confession",
  "Bold claim",
  "FOMO",
];

const SAMPLE_TOPICS = [
  "Why Kubernetes is overkill for most startups",
  "The biggest mistake data teams make with MLOps",
  "How I reduced cloud costs by 60%",
  "The truth about AI replacing DevOps engineers",
  "Why your data pipeline fails in production",
  "What senior engineers know that juniors don't",
  "The hidden cost of microservices architecture",
  "Why most ML models never reach production",
];

function ViralScoreBadge({ score }: { score: number }) {
  const color = score >= 8 ? "bg-green-500/10 text-green-500 border-green-500/20"
    : score >= 6 ? "bg-blue-500/10 text-blue-500 border-blue-500/20"
    : "bg-muted text-muted-foreground";
  return (
    <Badge className={`text-[10px] px-1.5 border ${color}`}>
      <TrendingUp className="h-3 w-3 mr-1" />{score}/10
    </Badge>
  );
}

export default function HooksPage() {
  const { toast } = useToast();
  const [topic, setTopic] = useState("");
  const [pillarId, setPillarId] = useState("");
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/hooks/generate", { topic, pillarId: pillarId ? parseInt(pillarId) : undefined, count: 8, includeViralScore: true });
      return res.json();
    },
    onSuccess: (data) => {
      setHooks(data.hooks || []);
      if (!data.hooks?.length) toast({ title: "No hooks generated", description: "Try a different topic.", variant: "destructive" });
    },
    onError: (err: any) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  const copy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    toast({ title: "Hook copied!" });
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const hookTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      "Contrarian/Hot take": "bg-red-500/10 text-red-500",
      "Stat-based": "bg-blue-500/10 text-blue-500",
      "Story opener": "bg-amber-500/10 text-amber-500",
      "Question hook": "bg-purple-500/10 text-purple-500",
      "List hook": "bg-green-500/10 text-green-500",
      "Confession": "bg-pink-500/10 text-pink-500",
      "Bold claim": "bg-orange-500/10 text-orange-500",
      "FOMO": "bg-cyan-500/10 text-cyan-500",
    };
    return colors[type] || "bg-muted text-muted-foreground";
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <h1 className="text-lg font-semibold flex items-center gap-2" data-testid="text-hooks-title">
          <Zap className="h-5 w-5 text-primary" />Hook Generator
        </h1>
        <p className="text-xs text-muted-foreground">Generate viral hooks and openers that stop the scroll</p>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          <Card className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Your Topic</label>
                <Input
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  placeholder="e.g. Why most ML models fail in production"
                  onKeyDown={e => e.key === "Enter" && topic && generateMutation.mutate()}
                  data-testid="input-hook-topic"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Content Pillar</label>
                <Select value={pillarId} onValueChange={setPillarId}>
                  <SelectTrigger data-testid="select-hook-pillar">
                    <SelectValue placeholder="Any pillar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Any pillar</SelectItem>
                    {CONTENT_PILLARS.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button className="w-full" onClick={() => generateMutation.mutate()} disabled={!topic || generateMutation.isPending} data-testid="button-generate-hooks">
              {generateMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Generating hooks...</>
                : <><Zap className="h-4 w-4 mr-2" />Generate 8 Viral Hooks</>}
            </Button>

            {hooks.length === 0 && (
              <div className="pt-2">
                <p className="text-xs font-medium text-muted-foreground mb-2">Try one of these:</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {SAMPLE_TOPICS.map((t, i) => (
                    <button key={i} onClick={() => setTopic(t)} className="text-left text-xs p-2 rounded border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors" data-testid={`button-sample-topic-${i}`}>
                      <ArrowRight className="inline h-3 w-3 mr-1 text-muted-foreground" />{t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {hooks.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{hooks.length} Hooks Generated</h2>
                <Button variant="ghost" size="sm" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Regenerate
                </Button>
              </div>
              {hooks.map((hook, i) => (
                <Card key={i} className="p-4 group" data-testid={`card-hook-${i}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`text-[10px] px-1.5 ${hookTypeColor(hook.type)}`}>{hook.type}</Badge>
                        {hook.viralScore && <ViralScoreBadge score={hook.viralScore} />}
                      </div>
                      <p className="text-sm font-medium leading-snug">{hook.text}</p>
                      {hook.why && <p className="text-xs text-muted-foreground italic">{hook.why}</p>}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copy(hook.text, i)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      data-testid={`button-copy-hook-${i}`}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
