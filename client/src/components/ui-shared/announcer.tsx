import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type AnnounceTone = "info" | "success" | "error";

interface AnnouncerValue {
  /**
   * Announce the completion of work the user started but did not watch.
   *
   * Every async surface in this product resolves silently: a publication
   * finishes, an artifact is generated, a run completes with warnings. To a
   * screen reader that is indistinguishable from the app hanging. This is the
   * only channel that says "that finished".
   *
   * The wording must be honest, per the product's truthfulness rules: name what
   * completed and what the outcome was, never imply success that did not happen.
   */
  announce: (message: string, tone?: AnnounceTone) => void;
}

const AnnouncerContext = createContext<AnnouncerValue>({ announce: () => {} });

export function AnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<{ text: string; tone: AnnounceTone } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((text: string, tone: AnnounceTone = "info") => {
    if (timer.current) clearTimeout(timer.current);
    setMessage({ text, tone });
    timer.current = setTimeout(() => setMessage(null), 6000);
  }, []);

  const value = useMemo(() => ({ announce }), [announce]);

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <LiveRegion message={message} />
    </AnnouncerContext.Provider>
  );
}

/**
 * A visually hidden live region, rendered next to the app so it is never
 * unmounted with the surface that triggered it.
 *
 * `polite` rather than `assertive`: a publication completing is worth reporting
 * but must not interrupt whatever the operator is reading right now. Reserve
 * `assertive` for errors the user must act on.
 */
function LiveRegion({ message }: { message: { text: string; tone: AnnounceTone } | null }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      data-testid="live-region"
      className={cn(
        "sr-only",
        message?.tone === "error" && "text-destructive",
        message?.tone === "success" && "text-foreground",
      )}
    >
      {message?.text ?? ""}
    </div>
  );
}

export const useAnnouncer = () => useContext(AnnouncerContext);
