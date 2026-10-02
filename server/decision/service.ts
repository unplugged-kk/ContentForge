/**
 * Decision layer composition root.
 *
 * One ledger instance shared by the HTTP surface and (from phase 3) the workers,
 * mirroring `research/service.ts` and `content/service.ts`.
 */

import { db } from "../db";
import { DatabaseDecisionLedger } from "./ledgerStore";

export const decisionLedger = new DatabaseDecisionLedger(db);
