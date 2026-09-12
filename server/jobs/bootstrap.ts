/**
 * Job runtime lifecycle for the application.
 *
 * Owns the single JobRuntime instance, registers the built-in providers and job
 * types, and exposes start/stop for server startup and graceful shutdown. This
 * is lifecycle glue over the existing runtime — not a second queue abstraction.
 */

import { registerBuiltinProviders } from "../research/bootstrap";
import { registerResearchRunJob } from "../research/job";
import { researchEngine, researchStorage } from "../research/service";
import { registerContentJobs } from "../content/service";
import { JobRuntime } from "./runtime";

let runtime: JobRuntime | null = null;

export function getJobRuntime(): JobRuntime {
  if (!runtime) {
    throw new Error("Job runtime has not been started");
  }
  return runtime;
}

export function isJobRuntimeStarted(): boolean {
  return runtime !== null;
}

/** Register every job type the application offers. Idempotent. */
export function registerRuntimeJobs(): void {
  registerBuiltinProviders();
  registerResearchRunJob({ engine: researchEngine, storage: researchStorage });
  registerContentJobs();
}

export interface StartJobRuntimeOptions {
  connectionString?: string;
  schema?: string;
}

export async function startJobRuntime(
  options: StartJobRuntimeOptions = {},
): Promise<JobRuntime> {
  if (runtime) return runtime;

  registerRuntimeJobs();

  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to start the job runtime");
  }

  const created = new JobRuntime({
    connectionString,
    ...(options.schema ? { schema: options.schema } : {}),
  });
  await created.start();
  runtime = created;
  return runtime;
}

/** Stop workers, letting in-flight jobs finish (graceful, per runtime design). */
export async function stopJobRuntime(): Promise<void> {
  const current = runtime;
  runtime = null;
  if (!current) return;
  await current.stop();
}
