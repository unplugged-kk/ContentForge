import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CONTENT_PILLARS, POST_STATUSES } from "@/lib/constants";
import { ChevronLeft, ChevronRight, Clock, Calendar as CalendarIcon } from "lucide-react";
import { SiX, SiThreads } from "react-icons/si";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from "date-fns";
import type { Post, Tweet } from "@shared/schema";

interface PostWithTweets extends Post {
  tweets: Tweet[];
}

function PlatformBadge({ platform }: { platform: string }) {
  if (platform === "x") return <Badge variant="secondary" className="text-[10px] gap-1"><SiX className="h-2.5 w-2.5" />X</Badge>;
  if (platform === "threads") return <Badge variant="secondary" className="text-[10px] gap-1"><SiThreads className="h-2.5 w-2.5" />Threads</Badge>;
  return (
    <Badge variant="secondary" className="text-[10px] gap-1">
      <SiX className="h-2.5 w-2.5" />
      <SiThreads className="h-2.5 w-2.5" />
    </Badge>
  );
}

export default function CalendarPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedPost, setSelectedPost] = useState<PostWithTweets | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("08:00");

  const { data: posts = [], isLoading } = useQuery<PostWithTweets[]>({
    queryKey: ["/api/posts"],
  });

  const scheduleMutation = useMutation({
    mutationFn: async ({ id, scheduledAt }: { id: number; scheduledAt: string }) => {
      const res = await apiRequest("PATCH", `/api/posts/${id}/status`, {
        status: "scheduled",
        scheduledAt,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Post scheduled" });
      queryClient.invalidateQueries({ queryKey: ["/api/posts"] });
      setSelectedPost(null);
    },
  });

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getPostsForDay = (day: Date) =>
    posts.filter((p) => {
      const date = p.scheduledAt ? new Date(p.scheduledAt) : new Date(p.createdAt);
      return isSameDay(date, day);
    });

  const getPillarColor = (pillarId: number | null) => {
    if (!pillarId) return "#6B7280";
    return CONTENT_PILLARS.find((p) => p.id === pillarId)?.color || "#6B7280";
  };

  const getStatusStyle = (status: string | null) => {
    switch (status) {
      case "draft": return "bg-muted text-muted-foreground";
      case "ready": return "bg-blue-500/10 text-blue-500 dark:bg-blue-500/20";
      case "scheduled": return "bg-amber-500/10 text-amber-500 dark:bg-amber-500/20";
      case "posted": return "bg-green-500/10 text-green-500 dark:bg-green-500/20";
      case "failed": return "bg-red-500/10 text-red-500 dark:bg-red-500/20";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h1 className="text-lg font-semibold" data-testid="text-calendar-title">Content Calendar</h1>
          <p className="text-xs text-muted-foreground">Plan and schedule your content</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} data-testid="button-prev-month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[140px] text-center" data-testid="text-current-month">
            {format(currentMonth, "MMMM yyyy")}
          </span>
          <Button size="icon" variant="ghost" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} data-testid="button-next-month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day} className="text-center text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-1">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((day) => {
                const dayPosts = getPostsForDay(day);
                const isToday = isSameDay(day, new Date());
                const isCurrentMonth = isSameMonth(day, currentMonth);
                return (
                  <div
                    key={day.toISOString()}
                    className={`min-h-[90px] rounded-md p-1.5 border transition-colors ${
                      isCurrentMonth ? "bg-card" : "bg-background opacity-40"
                    } ${isToday ? "border-primary/40" : "border-transparent"}`}
                  >
                    <div className={`text-xs mb-1 ${isToday ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                      {format(day, "d")}
                    </div>
                    <div className="space-y-0.5">
                      {dayPosts.slice(0, 3).map((post) => (
                        <button
                          key={post.id}
                          onClick={() => setSelectedPost(post)}
                          className={`w-full text-left rounded px-1 py-0.5 text-[10px] truncate ${getStatusStyle(post.status)}`}
                          style={{ borderLeft: `2px solid ${getPillarColor(post.pillarId)}` }}
                          data-testid={`button-calendar-post-${post.id}`}
                        >
                          {post.tweets?.[0]?.content?.substring(0, 30) || post.postType}
                        </button>
                      ))}
                      {dayPosts.length > 3 && (
                        <span className="text-[10px] text-muted-foreground pl-1">
                          +{dayPosts.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <Dialog open={!!selectedPost} onOpenChange={() => setSelectedPost(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-sm">Post Details</DialogTitle>
          </DialogHeader>
          {selectedPost && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className={getStatusStyle(selectedPost.status)}>
                  {selectedPost.status}
                </Badge>
                <PlatformBadge platform={selectedPost.targetPlatform || "both"} />
                <Badge variant="outline" className="text-[10px]">{selectedPost.postType}</Badge>
              </div>
              <div className="space-y-2">
                {selectedPost.tweets?.map((tweet, i) => (
                  <Card key={tweet.id} className="p-2">
                    <p className="text-xs text-muted-foreground mb-0.5">
                      {selectedPost.postType === "thread" ? `Tweet ${i + 1}` : "Content"}
                    </p>
                    <p className="text-sm">{tweet.content}</p>
                  </Card>
                ))}
              </div>
              {selectedPost.status === "ready" && (
                <div className="space-y-2 pt-2 border-t">
                  <p className="text-xs font-medium">Schedule this post</p>
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="flex-1"
                      data-testid="input-schedule-date"
                    />
                    <Input
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="w-28"
                      data-testid="input-schedule-time"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => {
                      if (scheduleDate) {
                        scheduleMutation.mutate({
                          id: selectedPost.id,
                          scheduledAt: `${scheduleDate}T${scheduleTime}:00`,
                        });
                      }
                    }}
                    disabled={!scheduleDate || scheduleMutation.isPending}
                    data-testid="button-schedule"
                  >
                    <Clock className="h-4 w-4 mr-2" />
                    Schedule
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
