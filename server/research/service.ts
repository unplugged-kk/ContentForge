/**
 * Research composition root.
 *
 * Wires the engine to the real database, the provider executor, and structured
 * logging. Kept separate from the request/job wiring so the HTTP layer and the
 * queue worker share exactly one engine instance.
 */

import { db } from "../db";
import type { LogSink } from "../jobs/logger";
import { decide } from "../decision/engine";
import { decisionTypeEnabled } from "../decision/policies";
import type { ResearchDepthDecision } from "../decision/schemas";
import { ResearchEngine, type ResearchDepthPort } from "./engine";
import { ProviderExecutor } from "./registry";
import { DatabaseResearchStorage } from "./storage";
import { createSeoProvider, type SeoCapability } from "./seo";
import { createJevTriageGate } from "./triageGate";

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

// Opt-in triage gate. Wired only when this boundary is genuinely ENABLED —
// `decisionTypeEnabled` requires both the master switch and JEV_RESEARCH_GATE —
// so the gate's presence always means it will actually decide. Wiring it on a
// flag alone would leave a boundary that looks active but silently returns the
// engine's fail-open fallback.
const triage = decisionTypeEnabled("research_triage") ? createJevTriageGate() : undefined;

// Opt-in depth decision, on its OWN flag so it never activates as a side effect
// of the triage gate. Asked only when a request does not specify a depth, and
// fail-open to "standard".
const depth: ResearchDepthPort | undefined = decisionTypeEnabled("research_depth")
  ? {
      choose: async (ctx) => {
        const result = await decide<ResearchDepthDecision>({
          type: "research_depth",
          state: { topic: { query: ctx.query } },
        });
        return (result.decision as ResearchDepthDecision).depth;
      },
    }
  : undefined;

export const researchEngine = new ResearchEngine({
  executor: providerExecutor,
  storage: researchStorage,
  logSink,
  seo: seoPort,
  ...(triage ? { triage } : {}),
  ...(depth ? { depth } : {}),
});
