import { Router } from "express";
import { createLearningRouter } from "./routes";

export async function createDefaultLearningRouter(): Promise<Router> {
  const [{ contentStorage, learningStorage, registerContentJobs, enqueueAnalyticsRefreshJob }, { db }] =
    await Promise.all([import("../service"), import("../../db")]);
  registerContentJobs();
  return createLearningRouter({
    content: contentStorage,
    learning: learningStorage,
    database: db,
    enqueueRefresh: enqueueAnalyticsRefreshJob,
  });
}
