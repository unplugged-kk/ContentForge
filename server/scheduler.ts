import cron from "node-cron";
import { storage } from "./storage";
import { tryPublishPostById } from "./social/x";
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

  const tz = process.env.CRON_TZ || "UTC";

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

  // 05:00 UTC daily — morning briefing: discover + auto-generate 5 ready drafts for review
  if (process.env.DISABLE_MORNING_BRIEFING !== "1") {
    cron.schedule(
      "0 5 * * *",
      async () => {
        console.log("[scheduler] Morning briefing starting...");
        try {
          const result = await runMorningBriefing();
          console.log(
            `[scheduler] Morning briefing done: ideas=${result.newIdeas} drafts=${result.draftsGenerated} errors=${result.errors.length}`,
          );
        } catch (e) {
          console.error("[scheduler] Morning briefing failed:", e);
        }
      },
      { timezone: "UTC" },
    );
  }

  // Daily discover refresh (separate from morning briefing — just ideas, no auto-draft)
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

  // Saturday 09:00 UTC — deep-dive article thread (15-20 tweets)
  if (process.env.DISABLE_WEEKEND_CONTENT !== "1") {
    cron.schedule(
      "0 9 * * 6",
      async () => {
        console.log("[scheduler] Saturday article thread generating...");
        try {
          const r = await generateWeekendContent("article_thread");
          console.log(`[scheduler] Sat article done: "${r.ideaTitle.substring(0, 60)}" tweets=${r.tweetCount}${r.error ? " err=" + r.error : ""}`);
        } catch (e) {
          console.error("[scheduler] Saturday article failed:", e);
        }
      },
      { timezone: "UTC" },
    );

    // Sunday 10:00 UTC — weekly recap thread (12-15 tweets)
    cron.schedule(
      "0 10 * * 0",
      async () => {
        console.log("[scheduler] Sunday weekly recap generating...");
        try {
          const r = await generateWeekendContent("weekly_recap");
          console.log(`[scheduler] Sun recap done: tweets=${r.tweetCount}${r.error ? " err=" + r.error : ""}`);
        } catch (e) {
          console.error("[scheduler] Sunday recap failed:", e);
        }
      },
      { timezone: "UTC" },
    );
  }

  // Sunday 18:00 UTC — autofill calendar for the coming week (skips slots already filled)
  if (process.env.DISABLE_AUTOFILL !== "1") {
    cron.schedule(
      "0 18 * * 0",
      async () => {
        console.log("[scheduler] Weekly autofill starting...");
        try {
          const r = await autofillCalendar(7);
          console.log(`[scheduler] Autofill done: drafts=${r.draftsCreated} errors=${r.errors.length}`);
        } catch (e) {
          console.error("[scheduler] Autofill failed:", e);
        }
      },
      { timezone: "UTC" },
    );
  }

  console.log(`[scheduler] Started — publish/retry * * * * *, morning briefing 0 5 UTC, sat article 0 9 Sat UTC, sun recap 0 10 Sun UTC, autofill Sun 18:00 UTC`);
}
