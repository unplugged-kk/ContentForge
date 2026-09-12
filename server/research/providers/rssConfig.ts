/**
 * RSS provider config resolution.
 *
 * The RSS provider consumes the existing ContentForge `rss_sources`
 * configuration instead of introducing a second RSS config table. The default
 * loader imports the application database lazily so importing the provider (or
 * its bootstrap) never requires DATABASE_URL to be set — tests and pure modules
 * stay importable, and tests can inject their own database handle.
 */

import { and, eq, isNull, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import * as schema from "@shared/schema";
import { rssSources } from "@shared/schema";
import type { RssProviderConfig } from "./rss";

const feedUrlSchema = z.string().url();

export type RssConfigDatabase = NodePgDatabase<typeof schema>;

export interface RssConfigContext {
  userId?: number | null;
}

export type RssConfigLoader = (ctx: RssConfigContext) => Promise<RssProviderConfig>;

/**
 * Build a loader bound to a specific database handle. When a userId is
 * supplied, legacy rows with no user_id are included so pre-Phase-C sources
 * keep working until per-user isolation lands.
 */
export function createRssConfigLoader(database: RssConfigDatabase): RssConfigLoader {
  return async (ctx: RssConfigContext = {}) => {
    const userFilter =
      ctx.userId != null
        ? or(eq(rssSources.userId, ctx.userId), isNull(rssSources.userId))
        : undefined;

    const rows = await database
      .select({
        name: rssSources.name,
        feedUrl: rssSources.feedUrl,
        category: rssSources.category,
      })
      .from(rssSources)
      .where(and(eq(rssSources.isActive, true), userFilter));

    const feeds: RssProviderConfig["feeds"] = [];
    for (const row of rows) {
      if (!feedUrlSchema.safeParse(row.feedUrl).success) continue;
      feeds.push({
        name: row.name,
        url: row.feedUrl,
        ...(row.category ? { category: row.category } : {}),
      });
    }

    return { feeds, defaultLimit: 20 };
  };
}

/** Default loader bound to the application database. */
export async function loadRssProviderConfig(
  ctx: RssConfigContext = {},
): Promise<RssProviderConfig> {
  const { db } = await import("../../db");
  return createRssConfigLoader(db)(ctx);
}
