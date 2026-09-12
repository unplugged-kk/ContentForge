/**
 * Job failure classification.
 *
 * Mirrors the four retry classes locked in Ticket 06 §9 so that queue behaviour
 * is decided by a class, not by inspecting error text.
 */

import { z } from "zod";

export const failureClassSchema = z.enum([
  "transient",
  "rate_limited",
  "permanent",
  "policy_human",
]);

export type FailureClass = z.infer<typeof failureClassSchema>;

/**
 * Thrown by a handler to declare how the queue should treat the failure.
 * Anything else thrown is treated as `transient` (retryable).
 */
export class JobFailure extends Error {
  readonly failureClass: FailureClass;
  readonly retryAfterMs?: number;
  readonly details?: unknown;

  constructor(
    failureClass: FailureClass,
    message: string,
    options: { retryAfterMs?: number; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobFailure";
    this.failureClass = failureClass;
    this.retryAfterMs = options.retryAfterMs;
    this.details = options.details;
  }

  static transient(message: string, options?: { cause?: unknown }): JobFailure {
    return new JobFailure("transient", message, options);
  }

  static rateLimited(message: string, retryAfterMs?: number): JobFailure {
    return new JobFailure("rate_limited", message, { retryAfterMs });
  }

  static permanent(message: string, details?: unknown): JobFailure {
    return new JobFailure("permanent", message, { details });
  }

  static policyHuman(message: string, details?: unknown): JobFailure {
    return new JobFailure("policy_human", message, { details });
  }
}

/** How the queue should react to a failure. */
export type RetryDisposition = "retry" | "reschedule" | "terminal";

export function dispositionFor(failureClass: FailureClass): RetryDisposition {
  switch (failureClass) {
    case "transient":
      return "retry";
    case "rate_limited":
      return "reschedule";
    case "permanent":
    case "policy_human":
      return "terminal";
  }
}

export function classifyError(error: unknown): FailureClass {
  return error instanceof JobFailure ? error.failureClass : "transient";
}

/** Extract a message without leaking a stack or non-Error payloads. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "unknown error";
  }
}
