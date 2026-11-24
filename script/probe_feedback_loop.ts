/**
 * run47 · the feedback loop has never run, and the log line says otherwise.
 *
 * Executes the app's REAL refreshXAnalytics() against the live database and
 * counts what it actually did, rather than reading the code and inferring.
 *
 * The claim under test: `console.log("refreshed N posts")` reports the number of
 * posts it *selected*, not the number it *synced*. syncPostAnalyticsFromX()
 * returns silently (no throw, no counter) when the analytics endpoint is unset,
 * so a week with 6 eligible posts logs "refreshed 6 posts" having made zero
 * network calls and written zero rows.
 */
import { refreshXAnalytics } from "../server/social/x";

let fetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (...args: any[]) => {
  fetchCalls++;
  return (realFetch as any)(...args);
}) as any;

async function main() {
  const env = process.env;
  console.log("=== environment the app actually runs with (values not printed) ===");
  console.log("XQUIK_API_KEY set:            ", Boolean(env.XQUIK_API_KEY?.trim()));
  console.log("XQUIK_ANALYTICS_ENDPOINT set: ", Boolean(env.XQUIK_ANALYTICS_ENDPOINT?.trim()));

  // Find the real owner id that holds the posted rows.
  const { storage } = await import("../server/storage");
  const owners: number[] = [];
  for (const id of [1, 2, 3]) {
    const posts = await storage.getPosts(id).catch(() => []);
    const posted = (posts as any[]).filter((p: any) => p.status === "posted");
    if (posted.length) owners.push(id);
  }
  console.log("owner ids holding posted rows:", JSON.stringify(owners));

  for (const ownerId of owners) {
    const filled = (await storage.getPosts(ownerId) as any[]).filter(
      (p: any) => p.status === "posted" && p.externalIds?.x?.length > 0,
    ).length;

    const before = fetchCalls;
    // 400 days: every posted row this owner has ever had qualifies, so the
    // "selected" count is the whole population, not a 14-day slice.
    await refreshXAnalytics(400, ownerId);
    const after = fetchCalls;

    console.log(`\nowner=${ownerId}`);
    console.log(`  posted rows with an x id : ${filled}`);
    console.log(`  fetch() calls attempted  : ${after - before}`);
    console.log(`  => the log line above claimed "refreshed" a number, but network calls = ${after - before}`);
  }

  globalThis.fetch = realFetch;
}
main().catch((e) => { console.error("PROBE ERROR:", e); process.exit(3); });
