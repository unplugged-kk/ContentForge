import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Send, Loader2, Copy, Save, Sparkles, ArrowRight, RotateCcw } from "lucide-react";
import { SiX, SiThreads, SiLinkedin } from "react-icons/si";
import { CONTENT_PILLARS, PLATFORMS } from "@/lib/constants";

interface Message {
  role: "user" | "assistant";
  content: string;
  postContent?: string;
  hasPost?: boolean;
}

const STARTERS = [
  "Help me write a thread about the hidden costs of running Kubernetes in production",
  "I want to share my experience reducing cloud costs by 60%. Help me structure it.",
  "Draft a hot take about why most companies don't need a data lake",
  "Let's create a post about the 3 signs your MLOps pipeline is a mess",
  "Help me write about career mistakes I see junior engineers make",
  "Create a post reacting to the latest AI model release from my perspective",
];

function PlatformIcon({ platform }: { platform: string }) {
  if (platform === "x") return <SiX className="h-3.5 w-3.5" />;
  if (platform === "threads") return <SiThreads className="h-3.5 w-3.5" />;
  if (platform === "linkedin") return <SiLinkedin className="h-3.5 w-3.5" />;
  return <SiX className="h-3.5 w-3.5" />;
}

export default function ChatPage() {
  const { toast } = useToast();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [platform, setPlatform] = useState("x");
  const [pillarId, setPillarId] = useState("");
  const [postType, setPostType] = useState("thread");
  const [finalPost, setFinalPost] = useState<string | null>(null);
  const [refineInput, setRefineInput] = useState("");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const chatMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      const newMessages = [...messages, { role: "user" as const, content: userMessage }];
      const res = await apiRequest("POST", "/api/chat/message", {
        messages: newMessages,
        pillarId: pillarId ? parseInt(pillarId) : undefined,
        platform,
        postType,
      });
      return res.json();
    },
    onSuccess: (data, userMessage) => {
      const assistantMsg: Message = {
        role: "assistant",
        content: data.content,
        postContent: data.postContent,
        hasPost: data.hasPost,
      };
      setMessages(prev => [...prev, { role: "user", content: userMessage }, assistantMsg]);
      if (data.hasPost && data.postContent) {
        setFinalPost(data.postContent);
      }
      setInput("");
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const refineMutation = useMutation({
    mutationFn: async (instruction: string) => {
      const res = await apiRequest("POST", "/api/chat/refine-post", {
        postContent: finalPost,
        instruction,
        platform,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setFinalPost(data.content);
      setRefineInput("");
      toast({ title: "Post refined!" });
    },
    onError: (err: any) => toast({ title: "Refinement failed", description: err.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/posts", {
        pillarId: pillarId ? parseInt(pillarId) : null,
        postType,
        targetPlatform: platform,
        status: "draft",
        tweets: finalPost!.split("\n\n").filter(t => t.trim()).map(content => ({ content: content.trim() })),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
      toast({ title: "Saved as draft!" });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const send = () => {
    if (!input.trim() || chatMutation.isPending) return;
    chatMutation.mutate(input.trim());
  };

  const reset = () => {
    setMessages([]);
    setFinalPost(null);
    setInput("");
    setRefineInput("");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2" data-testid="text-chat-title">
            <MessageSquare className="h-5 w-5 text-primary" />Chat → Post
          </h1>
          <p className="text-xs text-muted-foreground">Brainstorm with AI, then turn the conversation into a polished post</p>
        </div>
        <Button variant="ghost" size="sm" onClick={reset} disabled={!messages.length}>
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />New Chat
        </Button>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <MessageSquare className="h-7 w-7 text-primary" />
                </div>
                <div>
                  <p className="font-semibold">Start a conversation</p>
                  <p className="text-sm text-muted-foreground mt-1">Describe your idea and I'll help you refine it into a post.<br/>When ready, ask me to "write the post" or "make it a thread".</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 w-full max-w-2xl">
                  {STARTERS.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(s)}
                      className="text-left text-xs p-3 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors"
                      data-testid={`button-chat-starter-${i}`}
                    >
                      <ArrowRight className="inline h-3 w-3 mr-1 text-muted-foreground" />{s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      {msg.hasPost && msg.postContent && (
                        <div className="mt-3 pt-3 border-t border-border/40">
                          <p className="text-xs font-medium mb-2 flex items-center gap-1"><Sparkles className="h-3 w-3" />Generated Post:</p>
                          <pre className="text-xs whitespace-pre-wrap font-sans bg-background/20 rounded p-2">{msg.postContent}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {chatMutation.isPending && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-2xl px-4 py-3 flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Thinking...</span>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          <div className="p-4 border-t space-y-2">
            <div className="flex gap-2">
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-chat-platform">
                  <PlatformIcon platform={platform} />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={postType} onValueChange={setPostType}>
                <SelectTrigger className="w-28 h-8 text-xs" data-testid="select-chat-posttype"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tweet">Tweet</SelectItem>
                  <SelectItem value="thread">Thread</SelectItem>
                  <SelectItem value="linkedin_post">LinkedIn</SelectItem>
                </SelectContent>
              </Select>
              <Select value={pillarId} onValueChange={setPillarId}>
                <SelectTrigger className="flex-1 h-8 text-xs" data-testid="select-chat-pillar"><SelectValue placeholder="Pillar (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">No pillar</SelectItem>
                  {CONTENT_PILLARS.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Describe your idea, ask for help, or say 'write the post'... (Shift+Enter for newline)"
                className="resize-none text-sm min-h-[60px] max-h-[120px]"
                data-testid="textarea-chat-input"
              />
              <Button onClick={send} disabled={!input.trim() || chatMutation.isPending} className="self-end" data-testid="button-chat-send">
                {chatMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        {finalPost && (
          <div className="w-80 border-l flex flex-col bg-muted/20">
            <div className="p-3 border-b flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-primary" />Generated Post</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(finalPost); toast({ title: "Copied!" }); }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-chat-post">
                  {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{finalPost}</pre>
            </div>
            <div className="p-3 border-t space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Refine this post:</p>
              <div className="flex gap-2">
                <Textarea
                  value={refineInput}
                  onChange={e => setRefineInput(e.target.value)}
                  placeholder="Make it shorter, more technical..."
                  className="resize-none text-xs min-h-[60px]"
                  data-testid="textarea-refine-post"
                />
                <Button size="sm" onClick={() => refineMutation.mutate(refineInput)} disabled={!refineInput || refineMutation.isPending} className="self-end">
                  {refineMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {["Make it shorter", "Add a hook", "More technical", "Add CTA", "Thread format"].map(r => (
                  <button key={r} onClick={() => refineMutation.mutate(r)} className="text-[10px] px-2 py-0.5 rounded-full border hover:bg-primary/10 hover:border-primary/40 transition-colors">
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
