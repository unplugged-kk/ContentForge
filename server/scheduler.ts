import cron from "node-cron";
import { storage } from "./storage";
import { tryPublishPostById, refreshXAnalytics } from "./social/x";
import { runDiscoverRefresh } from "./discoverRefresh";
import { runMorningBriefing, autofillCalendar, generateWeekendContent } from "./autopilot";

// Exponential backoff delays (minutes) for failed posts
const RETRY_DELAYS_MINUTES = [5, 30, 120];
const MAX_RETRIES = 3;

function isDue(scheduledAt: Date | null): boolean {
  if (!scheduledAt) return false;
  return new Date(scheduledAt) <= new Date();
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

export function startSchedulers() {
  if (process.env.DISABLE_CRON === "1") {
    console.log("[scheduler] Crons disabled (DISABLE_CRON=1)");
    return;
  }

  // Use IST for all scheduling
  const tz = process.env.CRON_TZ || "Asia/Kolkata";

  // Every minute: publish scheduled posts + retry failed posts with backoff
  cron.schedule(
    "* * * * *",
    async () => {
      const all = await storage.getPosts();

      for (const p of all) {
        // Publish due scheduled posts
        if (p.status === "scheduled" && isDue(p.scheduledAt as Date | null)) {
          try {
            await tryPublishPostById(p.id, { invokedBy: "scheduler" });
          } catch (e) {
            console.error(`[scheduler] Publish failed post=${p.id}:`, e);
          }
          continue;
        }

        // Retry failed posts with exponential backoff
        if (p.status === "failed") {
          const retryCount = (p as any).retryCount ?? 0;
          if (retryCount >= MAX_RETRIES) continue;

          const delayMinutes = RETRY_DELAYS_MINUTES[retryCount] ?? 120;
          const lastRetry = (p as any).lastRetryAt ? new Date((p as any).lastRetryAt) : null;
          const lastAttempt = lastRetry || new Date(p.updatedAt);

          if (lastAttempt > minutesAgo(delayMinutes)) continue;

          console.log(`[scheduler] Retrying post=${p.id} attempt=${retryCount + 1}/${MAX_RETRIES}`);
          try {
            await storage.updatePost(p.id, {
              status: "scheduled",
              retryCount: retryCount + 1,
              lastRetryAt: new Date(),
            } as any);
            await tryPublishPostById(p.id, { invokedBy: "scheduler" });
          } catch (e) {
            console.error(`[scheduler] Retry failed post=${p.id}:`, e);
          }
        }
      }
    },
    { timezone: tz },
  );

  // 05:30 IST (00:00 UTC) — daily auto-post: discover + generate + schedule 3 posts for today
  if (process.env.DISABLE_MORNING_BRIEFING !== "1") {
    cron.schedule(
      "30 5 * * *",
      async () => {
        console.log("[scheduler] Daily auto-post starting...");
        try {
          const result = await runMorningBriefing();
          console.log(
            `[scheduler] Daily auto-post done: ideas=${result.newIdeas} posts=${result.postsScheduled} errors=${result.errors.length}`,
          );
        } catch (e) {
          console.error("[scheduler] Daily auto-post failed:", e);
        }
      },
      { timezone: tz },
    );
  }

  // 06:30 IST (01:00 UTC) — daily autofill: fill any empty slots for today
  if (process.env.DISABLE_AUTOFILL !== "1") {
    cron.schedule(
      "30 6 * * *",
      async () => {
        console.log("[scheduler] Daily autofill starting...");
        try {
          const r = await autofillCalendar(1);
          console.log(`[scheduler] Daily autofill done: drafts=${r.draftsCreated} errors=${r.errors.length}`);
        } catch (e) {
          console.error("[scheduler] Daily autofill failed:", e);
        }
      },
      { timezone: tz },
    );
  }

  // Daily discover refresh at 06:00 IST (00:30 UTC)
  if (process.env.DISABLE_DISCOVER_CRON !== "1") {
    const discoverCron = process.env.DISCOVER_CRON || "0 6 * * *";
    cron.schedule(
      discoverCron,
      async () => {
        try {
          const r = await runDiscoverRefresh();
          console.log(`[scheduler] Discover refresh OK batch=${r.batchId} ideas=${r.newIdeasCount}`);
        } catch (e) {
          console.error("[scheduler] Discover refresh failed:", e);
        }
      },
      { timezone: tz },
    );
    console.log(`[scheduler] Discover cron: ${discoverCron}`);
  }

  // Saturday 13:00 IST — deep-dive article thread
  if (process.env.DISABLE_WEEKEND_CONTENT !== "1") {
    cron.schedule(
      "0 13 * * 6",
      async () => {
        console.log("[scheduler] Saturday article thread generating...");
        try {
          const r = await generateWeekendContent("article_thread");
          console.log(`[scheduler] Sat article done: "${r.ideaTitle.substring(0, 60)}" tweets=${r.tweetCount}${r.error ? " err=" + r.error : ""}`);
        } catch (e) {
          console.error("[scheduler] Saturday article failed:", e);
        }
      },
      { timezone: tz },
    );

    // Sunday 19:30 IST — weekly recap thread
    cron.schedule(
      "30 19 * * 0",
      async () => {
        console.log("[scheduler] Sunday weekly recap generating...");
        try {
          const r = await generateWeekendContent("weekly_recap");
          console.log(`[scheduler] Sun recap done: tweets=${r.tweetCount}${r.error ? " err=" + r.error : ""}`);
        } catch (e) {
          console.error("[scheduler] Sunday recap failed:", e);
        }
      },
      { timezone: tz },
    );
  }

  // Weekly Sunday 08:30 IST — refresh X analytics for posts in last 14 days
  if (process.env.DISABLE_X_ANALYTICS !== "1") {
    cron.schedule(
      "30 8 * * 0",
      async () => {
        try {
          await refreshXAnalytics(14);
        } catch (e) {
          console.error("[scheduler] X analytics refresh failed:", e);
        }
      },
      { timezone: tz },
    );
  }

  console.log(`[scheduler] Started — publish/retry * * * * *, auto-post 05:30 IST, autofill 06:30 IST, discover 06:00 IST, sat article 13:00 IST, sun recap 19:30 IST, analytics 08:30 IST (timezone: ${tz})`);
}
