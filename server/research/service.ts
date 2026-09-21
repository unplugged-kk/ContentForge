/**
 * Research composition root.
 *
 * Wires the engine to the real database, the provider executor, and structured
 * logging. Kept separate from the request/job wiring so the HTTP layer and the
 * queue worker share exactly one engine instance.
 */

import { db } from "../db";
import type { LogSink } from "../jobs/logger";
import { ResearchEngine } from "./engine";
import { ProviderExecutor } from "./registry";
import { DatabaseResearchStorage } from "./storage";
import { createSeoProvider, type SeoCapability } from "./seo";

const logSink: LogSink = (line) => {
  // eslint-disable-next-line no-console
  console.log(line);
};

const seoPort = {
  health: async () => (await createSeoProvider()).health(),
  research: async (topic: string, capabilities?: readonly SeoCapability[]) =>
    (await createSeoProvider()).research(topic, capabilities),
};

export const researchStorage = new DatabaseResearchStorage(db);
export const providerExecutor = new ProviderExecutor({ logSink });
export const researchEngine = new ResearchEngine({
  executor: providerExecutor,
  storage: researchStorage,
  logSink,
  seo: seoPort,
});
