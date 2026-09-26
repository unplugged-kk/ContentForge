import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Link2 } from "lucide-react";
import { useLocation } from "wouter";
import { useAnnouncer } from "@/components/ui-shared/announcer";

export function QuickCapture() {
  const { toast } = useToast();
  const { announce } = useAnnouncer();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
  }, []);

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
      // The toast is visual. A screen reader user gets nothing from it, so the
      // same outcome is announced on the live region.
      announce(`Captured ${ref.title || "the page"} and added it to your library.`, "success");
      navigate("/ingest");
    },
    onError: (err: any) => {
      toast({ title: "Capture failed", description: err.message, variant: "destructive" });
      announce(`Capture failed. ${err.message || "The link could not be analyzed."}`, "error");
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

  // Lets other surfaces (e.g. Today's Quick Actions) open this same dialog
  // without lifting its state or duplicating the capture flow.
  useEffect(() => {
    const openCapture = () => setOpen(true);
    window.addEventListener("contentforge:open-quick-capture", openCapture);
    return () => window.removeEventListener("contentforge:open-quick-capture", openCapture);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  return (
    <>
      <Button
        size="icon"
        className="fixed z-50 rounded-full h-12 w-12 shadow-lg bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-[calc(1.5rem+env(safe-area-inset-right))]"
        onClick={() => setOpen(true)}
        aria-label="Quick capture"
        data-testid="button-quick-capture"
      >
        <Plus className="h-5 w-5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="dialog-quick-capture">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Quick Capture
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label htmlFor="quick-capture-url" className="sr-only">
              URL to capture
            </label>
            <p className="text-xs text-muted-foreground">Paste any URL to instantly analyze and save to your library.</p>
            <div className="flex gap-2">
              <Input
                id="quick-capture-url"
                ref={inputRef}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                aria-describedby="quick-capture-url-hint"
                onKeyDown={(e) => { if (e.key === "Enter" && url) ingestMutation.mutate({ url }); }}
                data-testid="input-quick-capture-url"
              />
              <Button onClick={() => ingestMutation.mutate({ url })} disabled={!url || ingestMutation.isPending} data-testid="button-quick-capture-submit">
                {ingestMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Capture"}
              </Button>
            </div>
            <p id="quick-capture-url-hint" className="text-xs text-muted-foreground text-center">
              Keyboard shortcut: {isMac ? "⌘⇧I" : "Ctrl+Shift+I"}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
