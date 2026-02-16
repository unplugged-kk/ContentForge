import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Link2 } from "lucide-react";
import { useLocation } from "wouter";

export function QuickCapture() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  const ingestMutation = useMutation({
    mutationFn: async (data: { url: string }) => {
      const res = await apiRequest("POST", "/api/ingest", data);
      return res.json();
    },
    onSuccess: (ref) => {
      queryClient.invalidateQueries({ queryKey: ["/api/references"] });
      setOpen(false);
      setUrl("");
      toast({ title: "Content captured", description: ref.title?.substring(0, 60) });
      navigate("/ingest");
    },
    onError: (err: any) => {
      toast({ title: "Capture failed", description: err.message, variant: "destructive" });
    },
  });

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "i" || e.key === "I")) {
      e.preventDefault();
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  return (
    <>
      <Button
        size="icon"
        className="fixed bottom-6 right-6 z-50 rounded-full h-12 w-12 shadow-lg"
        onClick={() => setOpen(true)}
        data-testid="button-quick-capture"
      >
        <Plus className="h-5 w-5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Quick Capture
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Paste any URL to instantly analyze and save to your library.</p>
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste URL here..."
                onKeyDown={(e) => { if (e.key === "Enter" && url) ingestMutation.mutate({ url }); }}
                data-testid="input-quick-capture-url"
              />
              <Button onClick={() => ingestMutation.mutate({ url })} disabled={!url || ingestMutation.isPending} data-testid="button-quick-capture-submit">
                {ingestMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Capture"}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">Keyboard shortcut: Cmd+Shift+I</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
