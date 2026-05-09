import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Loader2, Youtube } from "lucide-react";
import { SiThreads, SiX } from "react-icons/si";
import { CONTENT_PILLARS, PLATFORMS, POST_TYPES, TONES, CHAR_LIMITS } from "@/lib/constants";
import type { YoutubeChannel } from "@shared/schema";

type ExtractResponse = {
  videoId: string;
  title: string;
  author: string;
  thumbnailUrl: string;
};

function defaultScheduleLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PlatformIcon({ platform }: { platform: string }) {
  if (platform === "threads") return <SiThreads className="h-3.5 w-3.5" />;
  return <SiX className="h-3.5 w-3.5" />;
}

const PLATFORM_OPTIONS = PLATFORMS.filter((p) => p.value === "x" || p.value === "threads");
const POST_OPTIONS = POST_TYPES.filter((p) => p.value === "tweet" || p.value === "thread");

function YoutubeChannelsPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [channelUrl, setChannelUrl] = useState("");
  const { data: channels = [], isLoading } = useQuery<YoutubeChannel[]>({
    queryKey: ["/api/youtube/channels"],
  });

  const connectMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/youtube/channels", { channelUrl: channelUrl.trim() });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/youtube/channels"] });
      setChannelUrl("");
      toast({ title: "Channel connected" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const checkMut = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/youtube/channels/${id}/check-now`, {}),
    onSuccess: () => toast({ title: "Channel checked" }),
    onError: (e: Error) => toast({ title: "Check failed", description: e.message, variant: "destructive" }),
  });

  const delMut = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/youtube/channels/${id}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/youtube/channels"] });
      toast({ title: "Removed" });
    },
  });

  const patchMut = useMutation({
    mutationFn: async ({ id, requireApproval }: { id: number; requireApproval: boolean }) => {
      await apiRequest("PATCH", `/api/youtube/channels/${id}`, { requireApproval });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/youtube/channels"] }),
  });

  return (
    <div className="space-y-4 max-w-3xl">
      <Card className="p-4 space-y-3">
        <Label htmlFor="ch-url">Channel URL</Label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            id="ch-url"
            data-testid="input-channel-url"
            value={channelUrl}
            onChange={(e) => setChannelUrl(e.target.value)}
            placeholder="https://www.youtube.com/@handle or /channel/UC…"
          />
          <Button
            data-testid="button-connect-channel"
            disabled={!channelUrl.trim() || connectMut.isPending}
            onClick={() => connectMut.mutate()}
          >
            {connectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect"}
          </Button>
        </div>
      </Card>
      {isLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : null}
      <div className="space-y-3">
        {channels.map((ch) => (
          <Card key={ch.id} data-testid={`card-channel-${ch.id}`} className="p-4 space-y-3">
            <div className="flex justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{ch.channelName || ch.channelId}</p>
                <p className="text-xs text-muted-foreground break-all">{ch.channelUrl}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`button-check-now-${ch.id}`}
                  onClick={() => checkMut.mutate(ch.id)}
                >
                  Check now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid={`button-remove-channel-${ch.id}`}
                  onClick={() => delMut.mutate(ch.id)}
                >
                  Remove
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Require draft approval</span>
              <Switch
                checked={ch.requireApproval !== false}
                data-testid={`toggle-require-approval-${ch.id}`}
                onCheckedChange={(v) => patchMut.mutate({ id: ch.id, requireApproval: v })}
              />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function YoutubePage() {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [extracted, setExtracted] = useState<ExtractResponse | null>(null);
  const [thumbFallback, setThumbFallback] = useState(false);
  const [tweetBodies, setTweetBodies] = useState<string[]>([]);
  const [pillarId, setPillarId] = useState("");
  const [platform, setPlatform] = useState("x");
  const [postType, setPostType] = useState("thread");
  const [tone, setTone] = useState("educational");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleLocal);

  const thumbSrc = useMemo(() => {
    if (!extracted) return "";
    return thumbFallback
      ? `https://img.youtube.com/vi/${extracted.videoId}/hqdefault.jpg`
      : extracted.thumbnailUrl;
  }, [extracted, thumbFallback]);

  const extractMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/youtube/extract", { url: url.trim() });
      return res.json() as Promise<ExtractResponse>;
    },
    onSuccess: (data) => {
      setExtracted(data);
      setThumbFallback(false);
      setTweetBodies([]);
      toast({ title: "Video loaded" });
    },
    onError: (err: Error) =>
      toast({ title: "Extract failed", description: err.message, variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!extracted) throw new Error("No video");
      const res = await apiRequest("POST", "/api/youtube/generate-post", {
        videoId: extracted.videoId,
        title: extracted.title,
        author: extracted.author,
        pillarId: pillarId ? parseInt(pillarId, 10) : undefined,
        platform,
        tone,
        postType,
      });
      return res.json() as Promise<{ tweets: { content: string; charCount: number }[] }>;
    },
    onSuccess: (data) => {
      setTweetBodies(data.tweets.map((t) => t.content));
      toast({ title: "Post generated" });
    },
    onError: (err: Error) =>
      toast({ title: "Generate failed", description: err.message, variant: "destructive" }),
  });

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/posts", {
        pillarId: pillarId ? parseInt(pillarId, 10) : null,
        postType,
        tone,
        targetPlatform: platform,
        status: "draft",
        tweets: tweetBodies.map((content, i) => ({
          content,
          position: i,
          charCount: content.length,
        })),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
      toast({ title: "Saved as draft" });
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const saveScheduleMutation = useMutation({
    mutationFn: async () => {
      const iso = new Date(scheduleAt).toISOString();
      const res = await apiRequest("POST", "/api/posts", {
        pillarId: pillarId ? parseInt(pillarId, 10) : null,
        postType,
        tone,
        targetPlatform: platform,
        status: "scheduled",
        scheduledAt: iso,
        tweets: tweetBodies.map((content, i) => ({
          content,
          position: i,
          charCount: content.length,
        })),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
      setScheduleOpen(false);
      toast({ title: "Scheduled" });
    },
    onError: (err: Error) =>
      toast({ title: "Schedule failed", description: err.message, variant: "destructive" }),
  });

  const canGenerate = !!extracted && !generateMutation.isPending;
  const canSave = tweetBodies.length > 0 && !saveDraftMutation.isPending;

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="p-4 border-b">
        <h1
          className="text-lg font-semibold flex items-center gap-2"
          data-testid="text-youtube-title"
        >
          <Youtube className="h-5 w-5 text-primary" />
          YouTube → X Post
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Extract a video, generate a thread or tweet, or monitor channels for new uploads
        </p>
      </div>

      <Tabs defaultValue="video" className="flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-2 border-b border-border/60">
          <TabsList>
            <TabsTrigger value="video">Video → Post</TabsTrigger>
            <TabsTrigger value="channels">Channel connector</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="video" className="flex-1 overflow-auto mt-0">
      <div className="p-4 space-y-6 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Video URL</CardTitle>
            <CardDescription>Paste a YouTube watch or youtu.be link</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                data-testid="input-youtube-url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Button
                data-testid="button-extract-video"
                disabled={!url.trim() || extractMutation.isPending}
                onClick={() => extractMutation.mutate()}
              >
                {extractMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Extract"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {extracted && (
          <Card data-testid="card-video-preview">
            <CardHeader>
              <CardTitle className="text-base line-clamp-2">{extracted.title}</CardTitle>
              <CardDescription>{extracted.author}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="aspect-video w-full max-w-md rounded-md overflow-hidden bg-muted">
                <img
                  src={thumbSrc}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={() => setThumbFallback(true)}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Pillar</Label>
                  <Select value={pillarId} onValueChange={setPillarId}>
                    <SelectTrigger data-testid="select-youtube-pillar">
                      <SelectValue placeholder="Optional pillar" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTENT_PILLARS.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Platform</Label>
                  <Select value={platform} onValueChange={setPlatform}>
                    <SelectTrigger data-testid="select-youtube-platform">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORM_OPTIONS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          <span className="flex items-center gap-2">
                            <PlatformIcon platform={p.value} />
                            {p.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Post type</Label>
                  <Select value={postType} onValueChange={setPostType}>
                    <SelectTrigger data-testid="select-youtube-post-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {POST_OPTIONS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Tone</Label>
                  <Select value={tone} onValueChange={setTone}>
                    <SelectTrigger data-testid="select-youtube-tone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TONES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                data-testid="button-generate-post"
                disabled={!canGenerate}
                onClick={() => generateMutation.mutate()}
              >
                {generateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Generating…
                  </>
                ) : (
                  "Generate post"
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {tweetBodies.length > 0 && (
          <Card data-testid="card-generated-tweets">
            <CardHeader>
              <CardTitle className="text-base">Generated tweets</CardTitle>
              <CardDescription>Edit before saving — {tweetBodies.length} segment(s)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {tweetBodies.map((body, i) => (
                <div key={i} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Tweet {i + 1} · {body.length} /{" "}
                    {platform === "threads" ? CHAR_LIMITS.threads : CHAR_LIMITS.x}
                  </Label>
                  <Textarea
                    data-testid={`textarea-youtube-tweet-${i}`}
                    value={body}
                    onChange={(e) => {
                      const next = [...tweetBodies];
                      next[i] = e.target.value;
                      setTweetBodies(next);
                    }}
                    rows={Math.min(12, 3 + Math.ceil(body.length / 80))}
                    className="font-mono text-sm"
                  />
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  data-testid="button-save-draft"
                  variant="secondary"
                  disabled={!canSave}
                  onClick={() => saveDraftMutation.mutate()}
                >
                  {saveDraftMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Save as draft"
                  )}
                </Button>
                <Button
                  data-testid="button-save-schedule"
                  disabled={!canSave}
                  onClick={() => {
                    setScheduleAt(defaultScheduleLocal());
                    setScheduleOpen(true);
                  }}
                >
                  Save & schedule
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
        </TabsContent>
        <TabsContent value="channels" className="flex-1 overflow-auto mt-0 p-4">
          <YoutubeChannelsPanel />
        </TabsContent>
      </Tabs>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent data-testid="dialog-youtube-schedule">
          <DialogHeader>
            <DialogTitle>Pick a time</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="schedule-at">Publish time (local)</Label>
            <Input
              id="schedule-at"
              type="datetime-local"
              data-testid="input-youtube-schedule-at"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid="button-confirm-schedule"
              disabled={saveScheduleMutation.isPending}
              onClick={() => saveScheduleMutation.mutate()}
            >
              {saveScheduleMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Confirm schedule"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
