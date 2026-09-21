import { Router } from "express";
import { createPolicyActivationRouter, createPolicyHistoryRouter } from "./routes";

export async function createDefaultPolicyActivationRouter(): Promise<Router> {
  const { db } = await import("../../db");
  return createPolicyActivationRouter({ database: db });
}

export async function createDefaultPolicyHistoryRouter(): Promise<Router> {
  const { db } = await import("../../db");
  return createPolicyHistoryRouter({ database: db });
}
