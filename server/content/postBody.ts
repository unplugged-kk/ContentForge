/**
 * Run 60 / B83 — PUT /api/posts/:id cannot accept a scheduledAt at all.
 *
 * Measured on the live image (evidence/run60/probe_put_scheduledat.py):
 *
 *   PUT {status:"scheduled", scheduledAt:"<iso>"}  -> 500
 *   {"message":"value.toISOString is not a function"}
 *
 * The route passes `req.body` straight to `storage.updatePost`, which spreads it
 * into `db.update(posts).set({...})`. Drizzle's timestamp column expects a Date
 * and calls `.toISOString()` on what it is given; `req.body.scheduledAt` is a
 * string, so the driver throws and the whole update is lost. F3/F4 controls show
 * the route is otherwise alive (a string-only field saves fine) and that PATCH
 * normalises the same value correctly — the two routes simply disagree about
 * whether a date arrives as a string.
 *
 * This is the same class as run 58's B78: two paths that should agree, one of
 * them wrong. The fix normalises at the route boundary, where the untrusted JSON
 * becomes a typed value, rather than teaching storage to accept two shapes.
 *
 * Pure module: no db, no net, no clock.
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
 * Convert the ISO-string date fields of an untrusted request body into Date
 * objects, leaving every other field untouched.
 *
 * Absent, null and empty-string fields are passed through as-is: the caller's
 * intent ("clear this"/"leave this alone") is the storage layer's business, and
 * coercing null into a date would invent one.
 *
 * A field that is present but unparseable is reported in `bad` and left out of
 * `value`, so the route can answer 400 instead of letting the driver throw a 500.
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
