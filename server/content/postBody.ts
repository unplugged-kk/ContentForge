/**
 * Boundary normaliser for untrusted JSON post update bodies (run60 / B83).
 *
 * Converts declared ISO timestamp strings into `Date` objects so Drizzle's
 * timestamp columns do not throw `value.toISOString is not a function`, and
 * reports unparseable fields so routes can answer 400 cleanly.
 *
 * Pure module: no db, no network, no clock.
 */

/** Post columns that hold a timestamp and therefore need a Date, not a string. */
export const POST_DATE_FIELDS = ["scheduledAt", "postedAt", "lastRetryAt"] as const;

export type NormalisedBody = {
  /** The body with every present date field converted to a Date. */
  value: Record<string, unknown>;
  /** Fields that were present but could not be parsed. */
  bad: string[];
};

/**
 * Convert ISO-string date fields of an untrusted request body into Date objects,
 * leaving other fields untouched. Absent, null, and empty-string fields pass through.
 */
export function normalisePostBody(body: unknown): NormalisedBody {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { value: {}, bad: [] };
  }
  const value: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  const bad: string[] = [];

  for (const field of POST_DATE_FIELDS) {
    if (!(field in value)) continue;
    const raw = value[field];
    if (raw === null || raw === undefined || raw === "") continue;
    if (raw instanceof Date) continue;
    if (typeof raw === "string") {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        bad.push(field);
        delete value[field];
      } else {
        value[field] = d;
      }
      continue;
    }
    bad.push(field);
    delete value[field];
  }

  return { value, bad };
}
