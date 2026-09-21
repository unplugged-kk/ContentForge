import { Heart, MessageCircle, Repeat2, Bookmark, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface XPostPreviewProps {
  tweets: string[];
  displayName?: string;
  handle?: string;
  avatarUrl?: string;
}

function renderTweetBody(text: string) {
  const lines = text.split("\n");
  return lines.map((line, li) => (
    <span key={li}>
      {li > 0 ? <br /> : null}
      {line.split(/(\s+)/).map((part, pi) => {
        if (part.startsWith("@")) {
          return (
            <span key={pi} className="text-sky-400">
              {part}
            </span>
          );
        }
        if (part.startsWith("#")) {
          return (
            <span key={pi} className="text-sky-400">
              {part}
            </span>
          );
        }
        return <span key={pi}>{part}</span>;
      })}
    </span>
  ));
}

function charBadgeClass(n: number): string {
  if (n > 270) return "bg-red-500/20 text-red-300";
  if (n > 240) return "bg-amber-500/20 text-amber-200";
  return "bg-emerald-500/20 text-emerald-200";
}

export function XPostPreview({ tweets, displayName = "You", handle = "preview", avatarUrl }: XPostPreviewProps) {
  const list = tweets.length ? tweets : [""];

  return (
    <div className="rounded-xl border border-border bg-[#15202B] text-[#e7e9ea] p-3 space-y-0" data-testid="x-post-preview">
      {list.map((tweet, i) => (
        <div key={i} className="flex gap-3 pb-4 last:pb-0 relative">
          {i < list.length - 1 ? (
            <div className="absolute left-[19px] top-10 bottom-0 w-0.5 bg-slate-600" aria-hidden />
          ) : null}
          <div className="relative shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-slate-600 flex items-center justify-center text-xs font-semibold">
                {displayName.slice(0, 1)}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 space-y-2" data-testid={`x-preview-tweet-${i}`}>
            <div className="flex flex-wrap items-center gap-x-1 text-sm">
              <span className="font-bold truncate">{displayName}</span>
              <span className="text-slate-400 truncate">
                @{handle} · just now
              </span>
              <span
                className={cn("ml-auto text-[10px] px-2 py-0.5 rounded-full tabular-nums", charBadgeClass(tweet.length))}
                data-testid={`x-preview-char-count-${i}`}
              >
                {tweet.length}
              </span>
            </div>
            <div className="text-[15px] leading-snug whitespace-pre-wrap break-words">{renderTweetBody(tweet)}</div>
            <div className="flex items-center gap-6 text-slate-400 pt-1">
              <MessageCircle className="h-4 w-4" />
              <Repeat2 className="h-4 w-4" />
              <Heart className="h-4 w-4" />
              <Bookmark className="h-4 w-4" />
              <BarChart2 className="h-4 w-4" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
