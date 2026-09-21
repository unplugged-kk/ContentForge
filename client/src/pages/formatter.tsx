import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { CHAR_LIMITS } from "@/lib/constants";
import { FORMATS, type FormatKey } from "@/lib/unicode-formatter";
import { Copy, Type } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function FormatterPage() {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [formatted, setFormatted] = useState("");

  const counts = useMemo(() => ({ len: input.length }), [input]);

  const applyFormat = (key: FormatKey) => {
    const fn = FORMATS[key];
    const next = fn(input || "");
    setFormatted(next);
    toast({ title: "Formatted", description: key });
  };

  const copyFormatted = async () => {
    const text = formatted || input;
    await navigator.clipboard.writeText(text);
    toast({ title: "Copied" });
  };

  return (
    <div className="flex flex-col h-full overflow-auto p-4 gap-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-lg font-semibold flex items-center gap-2" data-testid="text-formatter-title">
          <Type className="h-5 w-5 text-primary" />
          Post Formatter
        </h1>
        <p className="text-xs text-muted-foreground mt-1">Unicode styles + live character counts</p>
      </div>

      <Card className="p-4 space-y-3">
        <Textarea
          data-testid="textarea-formatter-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={6}
          className="font-mono text-sm"
          placeholder="Paste or write post text…"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" data-testid="button-format-bold" onClick={() => applyFormat("bold")}>
            Bold
          </Button>
          <Button size="sm" variant="secondary" data-testid="button-format-italic" onClick={() => applyFormat("italic")}>
            Italic
          </Button>
          <Button size="sm" variant="secondary" data-testid="button-format-mono" onClick={() => applyFormat("monospace")}>
            Mono
          </Button>
          <Button size="sm" variant="secondary" data-testid="button-format-strike" onClick={() => applyFormat("strikethrough")}>
            Strike
          </Button>
          <Button size="sm" data-testid="button-copy-formatted" onClick={() => void copyFormatted()}>
            <Copy className="h-3.5 w-3.5 mr-1" />
            Copy output
          </Button>
        </div>
        <div className="rounded-md border bg-muted/40 p-3 min-h-[4rem]">
          <p className="text-[10px] text-muted-foreground mb-1">Preview</p>
          <div data-testid="text-formatter-preview" className="text-sm font-mono whitespace-pre-wrap break-all">
            {formatted || "—"}
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <h2 className="text-sm font-medium">Character Counter</h2>
        <div className="space-y-3">
          <CounterRow label="X (Twitter)" value={counts.len} limit={CHAR_LIMITS.x} testId="text-char-count-x" />
          <CounterRow label="Threads" value={counts.len} limit={CHAR_LIMITS.threads} testId="text-char-count-threads" />
          <CounterRow label="LinkedIn" value={counts.len} limit={CHAR_LIMITS.linkedin} testId="text-char-count-linkedin" />
        </div>
      </Card>
    </div>
  );
}

function CounterRow({ label, value, limit, testId }: { label: string; value: number; limit: number; testId: string }) {
  const pct = Math.min(100, Math.round((value / limit) * 100));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span data-testid={testId} className="tabular-nums">
          {value} / {limit}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
