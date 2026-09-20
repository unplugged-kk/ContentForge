import { Router } from "express";
import { createAutonomyRouter } from "./routes";

export async function createDefaultAutonomyRouter(): Promise<Router> {
  const { db } = await import("../../db");
  return createAutonomyRouter({ database: db });
}
