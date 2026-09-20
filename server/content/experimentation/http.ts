import { Router } from "express";
import { createExperimentRouter, createPolicyCandidateRouter } from "./routes";
import { DatabaseExperimentStorage } from "./store";

export async function createDefaultExperimentRouter(): Promise<Router> {
  const { db } = await import("../../db");
  const store = new DatabaseExperimentStorage(db);
  return createExperimentRouter({
    store,
    database: db,
  });
}

export async function createDefaultPolicyCandidateRouter(): Promise<Router> {
  const { db } = await import("../../db");
  const store = new DatabaseExperimentStorage(db);
  return createPolicyCandidateRouter({
    store,
    database: db,
  });
}
